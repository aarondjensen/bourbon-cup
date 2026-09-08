// ══════════════════════════════════════════════════════════════════
//  connection — whether this phone is actually talking to the server.
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC, where a played tournament is what turned this from a
// theory into a module. Why it exists, and it is the most golf-specific
// problem in the app:
//
//   Firestore's setDoc() does not FAIL when there is no signal. It does not
//   resolve either. The write goes into a local queue, the promise stays
//   pending for as long as it takes — minutes, a whole back nine — and lands
//   the moment a bar of signal comes back.
//
// That is exactly the behaviour you want on a golf course, and it is why the
// app can be scored through a dead patch at all. But it means every
// `try { await db.upsert(…) } catch` in this codebase is catching a case that
// nearly never happens (a rules denial) while the case that happens all the
// time — no signal — sails straight past as though it had succeeded. The score
// goes green on the screen, the group walks to the next tee, and nothing
// anywhere says the card is still sitting on that one phone.
//
// The tracker below counts writes that have been handed over and not yet
// acknowledged. It is deliberately not Firestore-aware: it counts promises,
// which is what makes it testable without a backend and true regardless of
// which SDK is underneath.

// ── The tracker ────────────────────────────────────────────────────
// One per app. `track` takes the promise a write returns and hands the SAME
// promise back, so it drops into a call site without changing what that call
// site does:
//
//   return writes.track(setDoc(…), "bc_hole_scores");
//
// `kind` is the collection, so the banner can say "3 scores waiting" rather
// than the useless "3 changes waiting" — on a tee box the only pending write
// anybody cares about is a hole.
//
// A rejected write decrements too. A write that FAILED is no longer waiting to
// send; it is a different problem — and it is the one that has no voice
// anywhere else, so this counts it separately as a REFUSAL.
//
// ── Refusals, and why they are worse than a queue ──────────────────
// The offline case above is the app working: the score is on the phone, it
// lands when signal does, and nothing is lost. A refusal is the opposite.
// Firestore answered, it said no, and the local copy of that write is ROLLED
// BACK — so the score is gone from the phone as well as absent from the board.
// It happens when the rules refuse the write: a session that did not survive,
// a membership that no longer exists, a locked edition, or rules that have not
// been deployed yet for a collection the app already writes.
//
// Every one of those looked, from the tee, exactly like scoring normally.
// `db.upsert` swallows the error into a console line, which is a message to
// nobody: the phone shows a card being filled in and the rest of the field
// sees nothing at all. That is the bug this half exists for.
//
// A refusal is STICKY. It does not retry itself and nothing drains it, so it
// stays counted until a write of the same kind succeeds — which is what
// happens the moment the account is sorted out and the score is typed again.
//
// `since` is the moment the queue last went from empty to non-empty, and null
// while it is empty. It is here rather than in the hook that reads it because
// "how long has this been outstanding" is a fact about the queue, and because
// a hook deriving it would have to set state inside an effect to keep it.
//
// It does NOT restart as further writes join a queue that is already backed
// up. The question the banner asks is "how long has this phone had something
// it could not send", and posting another hole into a queue that is already
// stuck does not make it less stuck.
export function createWriteTracker(now = () => Date.now()) {
  const byKind = new Map();
  const refusedByKind = new Map();
  const listeners = new Set();
  let since = null;

  const snapshot = () => {
    let total = 0;
    const kinds = {};
    byKind.forEach((n, k) => { total += n; if (n > 0) kinds[k] = n; });
    let refused = 0;
    const refusedKinds = {};
    refusedByKind.forEach((n, k) => { refused += n; if (n > 0) refusedKinds[k] = n; });
    return { pending: total, kinds, since, refused, refusedKinds };
  };

  const emit = () => {
    const s = snapshot();
    listeners.forEach(fn => fn(s));
  };

  // One settle is one emit, which is why the refusal is folded in here rather
  // than counted by a second call: a listener that saw the queue drain and the
  // refusal arrive as two states would paint the healthy one in between.
  const bump = (kind, delta, refused) => {
    const wasEmpty = byKind.size === 0;
    const next = (byKind.get(kind) || 0) + delta;
    if (next <= 0) byKind.delete(kind);
    else byKind.set(kind, next);
    if (byKind.size === 0) since = null;
    else if (wasEmpty) since = now();
    // A write that landed clears its collection's refusals: the same door
    // works again, so whatever it was is over and the count would be a stale
    // accusation. See the note above on why they are sticky until then.
    if (refused === true) refusedByKind.set(kind, (refusedByKind.get(kind) || 0) + 1);
    else if (refused === false) refusedByKind.delete(kind);
    emit();
  };

  return {
    // The outcome is read from the PROMISE rather than reported by the caller,
    // so every write in src/firebase.js is covered by having gone through this
    // door and anything written later inherits it. A caller that catches its
    // own error — and most of them do — never has to remember to say so.
    track(promise, kind = "other") {
      bump(kind, 1, null);
      let settled = false;
      const done = (refused) => { if (settled) return; settled = true; bump(kind, -1, refused); };
      Promise.resolve(promise).then(() => done(false), () => done(true));
      return promise;
    },
    state: snapshot,
    subscribe(fn) {
      listeners.add(fn);
      fn(snapshot());
      return () => listeners.delete(fn);
    },
  };
}

// The collections worth naming in the banner. Everything else is "changes":
// a director editing the draw wants to know a write is stuck, but does not
// need it called a pairing.
export const SCORE_KIND = "bc_hole_scores";

// ── What to say about it ───────────────────────────────────────────
// Pure, so the wording is testable and lives in one place.
//
// The rule this follows is that a status bar earns its space by being ABSENT
// most of the time. A strip that says "synced" all weekend is furniture
// nobody reads, and the one time it says something else it will not be read
// either. So there is no healthy state: this returns null when there is
// nothing wrong, and the app renders nothing.
//
// `stalled` is the caller's answer to "have these writes been outstanding
// long enough to be worth mentioning" — see useSyncStatus. Without it, every
// normal score would flash a bar for the 200ms it takes to land.
//
// `hint` is the trailing reassurance, and it is only ever present when this
// phone is HOLDING something. That is the case where somebody might otherwise
// stop and wait, and stopping is the wrong move — the queue drains itself. A
// phone that is merely out of range with nothing to send has nothing to be
// reassured about, and a spectator reading a stale board is not scoring
// anything, so both get the fact and no advice.
export function syncStatus({ online, pending = 0, kinds = {}, stalled = false, refused = 0, refusedKinds = {} }) {
  const scores = kinds[SCORE_KIND] || 0;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const holding = (key, label) => ({ key, tone: "warn", label, hint: "Keep scoring" });

  // A REFUSAL outranks everything below it, including no signal. Those say
  // "this phone is behind"; this one says "what you typed is gone", and it is
  // the only state here that needs the person to do something — every other
  // line in this function exists to tell them the opposite.
  //
  // The hint is where the answer nearly always is. A refusal on a tee box is
  // an account that stopped being signed in, and the way back is My Account —
  // so it says that rather than naming a rules predicate nobody in the field
  // has heard of. A locked edition already has its own notice.
  const refusedScores = refusedKinds[SCORE_KIND] || 0;
  if (refused > 0) {
    return refusedScores > 0
      ? { key: "refused-scores", tone: "bad", label: `${plural(refusedScores, "score", "scores")} did not save — nobody else has ${refusedScores === 1 ? "it" : "them"}`, hint: "Check you're signed in" }
      : { key: "refused", tone: "bad", label: `${plural(refused, "change", "changes")} did not save`, hint: "Check you're signed in" };
  }

  if (!online) {
    if (scores > 0) return holding("offline-scores", `No signal — ${plural(scores, "score", "scores")} still on this phone`);
    if (pending > 0) return holding("offline-pending", `No signal — ${plural(pending, "change", "changes")} still on this phone`);
    return { key: "offline", tone: "warn", label: "No signal — the board may be behind", hint: "" };
  }

  if (pending > 0 && stalled) {
    return scores > 0
      ? holding("stalled-scores", `Still sending ${plural(scores, "score", "scores")}…`)
      : holding("stalled", `Still sending ${plural(pending, "change", "changes")}…`);
  }

  return null;
}
