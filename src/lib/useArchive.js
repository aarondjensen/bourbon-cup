// ══════════════════════════════════════════════════════════════════
//  useArchive — ten years of cup, for one request that never repeats.
// ══════════════════════════════════════════════════════════════════
//
// ── The loading mechanism, and why it is this one ─────────────────
// The question the Data tab asks is "all of it at once": career records,
// partnerships, head-to-heads, cup records. There are four ways to answer it
// and only one of them is cheap.
//
//   Subscribe to ten editions      ~10,000 documents, every time somebody
//                                  taps the tab. This is the one to beat.
//   Precompute into Firestore      one document per player, written by the
//                                  import. Cheaper — but still a read per
//                                  open, still needs rules deployed before it
//                                  works, and still a second copy of the
//                                  history living somewhere a console edit
//                                  can silently disagree with the cards.
//   Compute in a Cloud Function    a cold start in front of a tab.
//   Ship it with the app           ← this
//
// The years that are over cannot change. So they are built at build time
// (pipeline/archive.mjs) and imported as a module: Vite gives the chunk a
// content-hashed name, which makes it immutably cacheable — a phone downloads
// it once, ever, and gets a different file only when the bytes actually
// change. No Firestore read, no security rule, no deploy step of its own, and
// `git revert` genuinely undoes it.
//
// Three more things make it cheap in practice:
//
//   dynamic import()   the archive is not in the main bundle, and Vite gives
//                      it a chunk of its OWN rather than folding it into the
//                      screen that asks for it — which is the better split:
//                      restyling the tab does not invalidate ten years of
//                      cached history. A phone that never opens the tab
//                      downloads neither.
//   module-level cache the promise is kept, not the call. Ten taps on the
//                      tab is one fetch, and a component that mounts before
//                      the first one lands joins it rather than starting a
//                      second.
//   prefetch on menu   opening the More menu starts the fetch, so the tab is
//                      usually already loaded by the time it is tapped. It is
//                      a hint, not a dependency — dropping it costs a spinner.
//
// What is NOT cached is the fold: the running year is live, and a match that
// finishes has to move a career record on the next render. Folding 170
// matches and 630 cards is sub-millisecond arithmetic, so it is done on every
// change of the live rows and memoized on those.
import { useEffect, useMemo, useState } from "react";
import { foldArchive } from "./archiveFold";
import { liveFacts, mergeLive } from "./archiveLive";

let archivePromise = null;

// One fetch per session, shared by every caller. The promise is memoized
// rather than the result, so two components mounting in the same tick join
// the same request instead of racing two.
export const loadArchive = () => {
  archivePromise ||= import("../../data/bourbon-cup-archive.json")
    .then((m) => m.default || m)
    .catch((err) => {
      // Let a later open try again rather than caching a network blip
      // forever — this is a static asset, and the usual reason it fails is a
      // phone that went through a tunnel mid-fetch.
      archivePromise = null;
      throw err;
    });
  return archivePromise;
};

// Warm it. Deliberately swallows: a prefetch that throws is a prefetch that
// did not help, not an error anybody should see.
export const prefetchArchive = () => { loadArchive().catch(() => {}); };

// ── The hook ──────────────────────────────────────────────────────
// `input` is the running edition, straight off the app's own subscriptions —
// the same objects the leaderboard is drawn from. It is turned into archive
// rows HERE rather than by the caller, because that conversion needs the
// registry, and the registry is inside the file this hook is fetching.
//
// Two memos, and the split matters:
//
//   live   the running year as rows. Recomputed when the tournament changes,
//          which means it runs the scoring engine over this year's matches —
//          the expensive half, and the half that has to stay fresh.
//   data   the fold. Cheap arithmetic over 170 archived matches plus this
//          year's, so it simply follows.
export const useArchive = (input) => {
  const [archive, setArchive] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadArchive().then(
      (a) => { if (alive) setArchive(a); },
      (e) => { if (alive) setError(e); },
    );
    return () => { alive = false; };
  }, []);

  const live = useMemo(
    () => (archive && input ? liveFacts({ ...input, players: archive.players }) : null),
    [archive, input],
  );

  const data = useMemo(
    () => (archive ? foldArchive(mergeLive(archive, live)) : null),
    [archive, live],
  );

  return { data, live, loading: !archive && !error, error };
};

export { liveFacts };
