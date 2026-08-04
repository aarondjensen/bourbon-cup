// ══════════════════════════════════════════════════════════════════
//  useHoleAdvance — which hole a scoring screen is showing, and when it
//  moves on by itself.
// ══════════════════════════════════════════════════════════════════
//
// This state machine was once copied verbatim into every scoring screen the
// app had: the same arming rule, the same 1.8s pause, the same edge-skipping,
// the same cold-load safety net, down to the wording of the comments. Two
// copies of timing logic is the kind of duplication that does not stay
// identical, and that pair had already come apart in one place (see the
// deferred jump below).
//
// A caller's scores can live in any shape it likes — the seam is narrow on
// purpose: hand it the match's id, its players, and a way to read one score.
//
//     const { activeHole, goToHole, editing, toast } =
//       useHoleAdvance({ matchId: match?.id, pids, getScore });
//
// `getScore(pid, hole)` must return 0 (not undefined) for an unscored hole.
//
// `hold` freezes the advance where it is — for a screen that raises a
// question about the hole just finished (the CTP prompt) and needs the hole
// to still be there while it is answered.
import { useEffect, useRef, useState } from "react";

export const HOLES = 18;

// ── openingHole ────────────────────────────────────────────────────
// The first hole this group has not finished — where a screen should open.
//
//   hole         — the hole index (0-based) the screen should show
//   allComplete  — every player has every hole. The screen lands on the LAST
//                  hole rather than the first, because a finished card has no
//                  next hole to fast-forward to and hole 18 is what the group
//                  was actually looking at when they finished.
//   hasAnyScores — anything posted at all for this match
//   resolved     — false when there was nothing to decide FROM (no players, or
//                  not one score yet). See below.
//
// ── Why this returns a shape and not a number ───────────────────────
// It used to answer with a bare hole index, and callers read `edge > 0` as
// "we had real data to position from". That conflated three different
// situations that all legitimately answer hole 1: nothing has loaded yet, the
// card is genuinely untouched, and the live edge really is hole 1. It also
// forced a FINISHED match to answer 0 — so a completed card opened on hole 1
// instead of the 18 it ended on, which is the one case where the conflation
// was visible to a player.
//
// `resolved` says outright whether the answer came from data, so the cold-load
// safety net below can stay armed without the hole index having to carry that
// meaning as well. This is the same contract WBC's lib/holeAdvance.js exposes,
// so the two apps position a scoring screen identically.
//
// `score(pid, holeIdx)` must return a falsy value (0 or undefined) for a hole
// nobody has posted.
export function openingHole(pids, score, holes = HOLES) {
  const clean = (pids || []).filter(Boolean);
  if (clean.length === 0) {
    return { hole: 0, allComplete: false, hasAnyScores: false, resolved: false };
  }

  const at = (pid, h) => score(pid, h) || 0;
  const hasAnyScores = clean.some(pid => {
    for (let h = 0; h < holes; h++) if (at(pid, h) > 0) return true;
    return false;
  });
  // Nothing posted: start at the start. Flagged unresolved so a caller can
  // tell "the card is genuinely empty" from "the scores have not loaded" —
  // they look identical from here, and only the caller knows which it is.
  if (!hasAnyScores) {
    return { hole: 0, allComplete: false, hasAnyScores: false, resolved: false };
  }

  for (let h = 0; h < holes; h++) {
    if (!clean.every(pid => at(pid, h) > 0)) {
      return { hole: h, allComplete: false, hasAnyScores: true, resolved: true };
    }
  }
  return { hole: holes - 1, allComplete: true, hasAnyScores: true, resolved: true };
}

export function useHoleAdvance({ matchId, pids, getScore, hold = false }) {
  // Open on the live edge, resolved synchronously from the scores we already
  // have. Leaving the screen unmounts it, so returning mid-round used to
  // render hole 1 and jump forward 400ms later — a visible flash on every
  // single return. The deferred effect below still covers the cold-load case,
  // where nothing has arrived yet on the first render.
  //
  // Held in its own useState purely as a compute-once-on-mount: both the
  // starting hole and the ref below need this answer, and running the scan
  // again every render to get the second half of it would be waste.
  const [opening] = useState(() => openingHole(pids, getScore));
  const [activeHole, setActiveHole] = useState(opening.hole);
  // True when the user has navigated BACK to a finished hole to fix a score.
  // Auto-advance is suppressed while it is set, so a corrective tap doesn't
  // jump the screen away mid-edit.
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState(null);
  // Which match the opening hole has already been resolved for. Seeded with
  // the match positioned above so the effects stay idle when there is nothing
  // left to do; a different id re-arms them. Keyed on `resolved`, not on the
  // hole index — a match positioned on hole 1 from real scores is positioned,
  // and a finished match sitting on hole 18 is too.
  const positionedFor = useRef(opening.resolved ? (matchId ?? null) : null);
  // Auto-advance arming, keyed `matchId:hole`. A hole arms only once we have
  // seen it INCOMPLETE while mounted — see the auto-advance effect.
  const advanceArmed = useRef({});

  // Live reads for the effects. The deferred jump in particular must NOT
  // depend on the score data: depending on it made that effect re-fire on the
  // user's first score of the round, and the same-frame jump raced the
  // auto-advance effect and pre-empted its 1.8s toast. One screen had already
  // been fixed this way and the other had not; going through a ref is what
  // makes the fix true for both.
  //
  // Refreshed in an effect rather than assigned during render — a ref write
  // during render is a side effect, and React Compiler responds by skipping
  // the whole component's memoization. Everything that reads this reads it
  // from a timer or an event handler, long after the commit, so an effect is
  // early enough. It is declared first so it lands before any effect below
  // could want it.
  //
  // Only the READER goes in here. `pids` does not need to: a match's roster is
  // fixed for the life of that match, so the effects below close over the
  // render's copy and it is still correct whenever their timers fire. Keeping
  // it out matters — pids is derived from the caller's match object, and a
  // value derived from that object landing in a ref is enough for React
  // Compiler to stop memoizing the whole screen.
  const liveScore = useRef(getScore);
  useEffect(() => { liveScore.current = getScore; });

  const at = (pid, h) => getScore(pid, h) || 0;
  const holeComplete = pids.length > 0 && pids.every(pid => at(pid, activeHole) > 0);
  // Every player on every hole — the round is done, so don't advance off 18.
  const allComplete = pids.length > 0 && pids.every(pid => {
    for (let h = 0; h < 18; h++) if (!(at(pid, h) > 0)) return false;
    return true;
  });
  // Gates arming: on a cold load the score data is empty for a few frames, and
  // a hole that only looks incomplete because nothing has loaded must not arm
  // — otherwise the arriving snapshot "completes" hole 1 and fires the toast.
  const anyScores = pids.some(pid => {
    for (let h = 0; h < 18; h++) if (at(pid, h) > 0) return true;
    return false;
  });
  // Flips whenever ANY score on this hole changes, even if the hole stays
  // complete through the edit (correcting a 5 to a 4). As an effect dep it
  // makes an edit inside the 1.8s window restart the timer rather than letting
  // it lock in at the moment of first completion.
  const curHoleScoreSig = pids.map(pid => at(pid, activeHole)).join(",");

  // The first hole this group has not finished. Navigating anywhere before it
  // is editing; navigating to it is catching up.
  let liveEdge = 17;
  for (let h = 0; h < 18; h++) {
    if (!pids.every(pid => at(pid, h) > 0)) { liveEdge = h; break; }
  }
  // The only way to change hole. Calling setActiveHole directly leaks stale
  // editing state — fix hole 3, then tap hole 5 at the live edge, and editing
  // stays true so auto-advance never fires when hole 5 is finished.
  const goToHole = (h) => { setActiveHole(h); setEditing(h < liveEdge); };

  // Put the screen on a match's live edge in a SINGLE render. Used by a match
  // selector and by the match-change effect, so neither ever paints the
  // outgoing hole before correcting it.
  const positionOn = (id, ps = pids, gs = liveScore.current) => {
    const opened = id
      ? openingHole(ps, gs)
      : { hole: 0, resolved: false };
    // Only claim the match as positioned when there was real data to position
    // FROM. Landing on hole 1 because nothing has loaded is not an answer, and
    // must leave the deferred jump below armed.
    positionedFor.current = opened.resolved ? id : null;
    setActiveHole(opened.hole);
    setEditing(false);
  };

  // ── Auto-advance ──
  // When everyone has scored the active hole, show the toast for 1.8s and jump
  // to the next unscored one. Cleanup cancels on edit or navigation.
  //
  // The arming gate exists because these screens unmount when the user leaves
  // the tab and remount with activeHole back at 0. Come back mid-round and
  // hole 1 has long since been completed, so without the gate the effect fired
  // on the first render and flashed "Hole 1 saved — advancing..." every single
  // time. Arming a hole only after we have seen it incomplete means the toast
  // marks a hole we actually watched get finished, never one that was already
  // full when we arrived.
  useEffect(() => {
    if (!matchId) return;
    const armKey = `${matchId}:${activeHole}`;
    // Arm before the suppression checks — a hole the user is mid-edit on still
    // needs to arm so finishing it advances as usual.
    if (!holeComplete) { if (anyScores) advanceArmed.current[armKey] = true; return; }
    // Held: the screen is asking about THIS hole (the CTP prompt) and the
    // answer is about the shot that was just played on it. Sliding the hole
    // out from under that question — and the toast animating behind the
    // popup — is what the hold is for. The arm above still stands, so the
    // advance runs as usual the moment the question is answered.
    if (hold) return;
    if (activeHole >= 17 || editing || allComplete) return;
    if (!advanceArmed.current[armKey]) return;
    // Fire immediately so the wait reads as "saving — advancing", not dead time.
    setToast(`✓ Hole ${activeHole + 1} saved — advancing...`);
    const timer = setTimeout(() => {
      setToast(null);
      // Skip holes already fully scored — the user may have back-filled a gap
      // and the live edge has leapfrogged forward.
      const g = liveScore.current;
      let next = activeHole + 1;
      while (next < 17 && pids.every(pid => (g(pid, next) || 0) > 0)) next++;
      setActiveHole(next);
      setEditing(false);
    }, 1800);
    // Clears the toast whether the effect re-runs because of an edit (the next
    // pass sets it again) or because the user navigated off the finished hole.
    return () => { clearTimeout(timer); setToast(null); };
    // pids is fixed for a match, and the derived signals above already cover scores
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeComplete, activeHole, editing, allComplete, anyScores, curHoleScoreSig, matchId, hold]);

  // Safety net — clear the toast after 3s in case the cleanup misses an edge.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Reposition when the match changes out from under the player: finalizing a
  // round swaps the tournament screen to the next round's match, and a held
  // hole 14 would otherwise carry onto a card that hasn't teed off.
  //
  // The positionedFor guard makes this skip the mount pass, where the hole was
  // already resolved synchronously above — running it on mount would put the
  // screen back on hole 1 and reintroduce the flash it exists to avoid.
  useEffect(() => {
    if (positionedFor.current === (matchId ?? null)) return;
    positionOn(matchId);
    // positionOn is re-made each render; only a match change should reposition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Deferred opening-hole jump — the cold-load safety net. Opened straight
  // onto a scoring tab, the score data is still empty during the first render,
  // so the synchronous positioning has nothing to work with; this waits for
  // Firestore's cached snapshot and then jumps. On a tab return the data is
  // already present, positionedFor is pre-seeded, and this does nothing at
  // all — which is what keeps the screen still.
  useEffect(() => {
    if (!matchId || positionedFor.current === matchId) return;
    const t = setTimeout(() => {
      if (positionedFor.current === matchId) return;
      positionedFor.current = matchId;   // lock regardless of outcome
      const opened = openingHole(pids, liveScore.current);
      if (opened.resolved) setActiveHole(opened.hole);
    }, 400);
    return () => clearTimeout(t);
    // pids is fixed for a match; re-firing on score changes is the bug this avoids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  return {
    activeHole, setActiveHole, goToHole, liveEdge,
    editing, setEditing, toast,
    holeComplete, allComplete, positionOn,
  };
}
