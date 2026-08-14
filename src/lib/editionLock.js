// ══════════════════════════════════════════════════════════════════
//  editionLock — freezing a tournament year against everybody but a
//  director.
// ══════════════════════════════════════════════════════════════════
//
// Ported from the WBC app, which solved this first and solved it better than
// the sketch that preceded it here. Deliberately the SAME mechanism, field
// name and defaults in both apps: two Firebase projects with two different
// answers to "is this year frozen" is two things to reason about at 6am on a
// tee box, and the second one is always the one nobody remembers.
//
// Pure: no Firebase, no React. `editions.js` does the write and
// `firestore.rules` does the enforcing; this file decides what the control
// means and what it says before it is tapped.
//
// ── Why `locked` is its own field and not `status === "archived"` ──
// Reusing status was the obvious move and it is the wrong one. A status is a
// FACT about a tournament — this one is finished, that one has not started —
// and the picker paints it. A lock is an INTENTION about it: "nobody may write
// here for now". Two years with identical contents can differ only in whether
// the director wants one of them touched, and there is nothing in the data to
// count that would reveal it.
//
// Conflating them costs both directions. An imported year that needs
// correcting would have to be un-archived — changing what the picker SAYS
// about 2019 in order to change who may write to it. And the year being played
// could never be frozen at all without labelling a live tournament "archived",
// which is exactly the case the store testers create.
//
// ── What it is for ──
// The immediate reason is the store review queues. Google Play's closed test
// wants a dozen people tapping around for two weeks, and a membership is NOT
// edition-scoped: firestore.rules gates writes on having presented the
// tournament password, full stop, and ☰ → Tournaments is offered to every
// member. So a tester can switch into the live 2026 and post a score in it.
// Hiding the picker would not help — the Firebase config ships in the bundle,
// so anybody can talk to Firestore directly.
//
// The lasting reason is that a finished tournament should stop moving. Until
// this existed, the confirm on opening an archived year SAID "it's finished,
// so it opens read-only — every card and result, nothing to change" and
// nothing whatsoever enforced it. What actually protected 2016–2024 was that
// the import writes every round already LOCKED and FINAL and the UI declines
// to draw edit controls for one — a real guard against a fat finger, and no
// guard at all against a phone left on the Scoring tab in the wrong year.
//
// ── What a lock does NOT do ──
// It does not hide the year and it does not stop reading. Every leaderboard,
// card, scorecard and photo in a locked edition stays visible to everybody,
// guests included — freezing a tournament is not the same as hiding it.
//
// A DIRECTOR IS EXEMPT, in the rules and here. Somebody has to be able to fix
// a locked year, and a flag that can strand a tournament nobody can correct is
// a worse bug than the one it fixes.

// Missing, false, null and "not an edition at all" are all UNLOCKED. The
// default has to fall that way: every edition document written before this
// field existed has no `locked` on it, and a default of true would freeze
// eleven years of tournaments the moment it deployed.
export const isEditionLocked = (edition) => edition?.locked === true;

// ── What the director is about to do, in words ─────────────────────
// Returned rather than written inline at the call site so the dangerous case
// can be tested, because it is the one that is easy to get wrong and expensive
// to discover: locking the year the app is CURRENTLY SHOWING stops scoring for
// everybody on it, immediately, and the person doing it is the one member who
// will not notice — a director is exempt, so their own writes keep working.
//
// Unlocking never asks. It only ever widens what is possible, and a control
// that interrogates you for undoing something makes people leave it alone.
export const lockVerdict = (edition, { isActive = false } = {}) => {
  const year = edition?.year ?? edition?.id ?? "this year";

  if (isEditionLocked(edition)) {
    return {
      next: false,
      confirm: null,
      label: "Unlock",
      title: `Unlock ${year} so members can write to it again`,
    };
  }

  return {
    next: true,
    label: "Lock",
    title: `Lock ${year} so only a director can change it`,
    confirm: {
      title: `Lock ${year}?`,
      body: isActive
        // The active edition is what every phone in the field is pointed at.
        ? `${year} is the tournament the app is showing right now. Locking it stops `
          + `scoring, card signing and side bets for everybody on it — their writes will `
          + `be refused, not queued. You won't see it happen: directors are exempt.`
        : `Nobody but a director will be able to post a score, sign a card or place a `
          + `bet in ${year}. Reading is unaffected — the leaderboard, the cards and the `
          + `photos stay visible to everyone.`,
      confirmLabel: "Lock it",
    },
  };
};

// ── Every year at once ─────────────────────────────────────────────
// Eleven editions is eleven taps, and the whole point of the padlock is a
// setup a director does once before handing the app to testers: freeze the
// history, leave the year being played open. Doing that one row at a time is
// the kind of chore that gets abandoned halfway, which leaves exactly the hole
// the lock was for.
//
// ONE BUTTON, and what it offers depends on where things stand: while any
// other year is open it locks them, and once they are all shut the same slot
// unlocks everything — because "lock all but the active year" with nothing
// left to lock is a dead control, and a dead control is worse than a different
// one.
//
// THE ACTIVE YEAR IS NEVER TOUCHED, in either direction. It is the tournament
// being played; freezing it is a thing a director might well want, but never
// as a side effect of tidying up the other ten. The single padlock on its own
// row is where that decision belongs, and it asks first.
//
// BOTH DIRECTIONS ASK HERE, which is where this parts company with the single
// toggle above. That one lets an unlock through without a question because
// tapping it again puts the year back exactly as it was. A bulk action has no
// such undo: it flattens whatever pattern of locks was there, and once "unlock
// all" has run, nothing remembers which years were frozen a moment ago.
// Re-locking is not an undo, it is a different arrangement.
//
// Null when there is nothing to offer — one edition, or none — so the caller
// renders no button rather than a disabled one.
export const bulkLockVerdict = (editions = [], activeId = null) => {
  const others = (editions || []).filter((e) => e?.id && e.id !== activeId);
  if (!others.length) return null;

  const activeYear = (editions || []).find((e) => e?.id === activeId)?.year ?? null;
  const open = others.filter((e) => !isEditionLocked(e));
  const n = (c) => `${c} ${c === 1 ? "year" : "years"}`;

  if (open.length) {
    return {
      next: true,
      ids: open.map((e) => e.id),
      label: activeYear ? `Lock all but ${activeYear}` : "Lock every other year",
      confirm: {
        title: `Lock ${n(open.length)}?`,
        body: `Only a director will be able to change ${open.length === 1 ? "it" : "them"}.`
          + (activeYear ? ` ${activeYear} stays open — it's the tournament being played.` : "")
          + ` Reading is unaffected: every leaderboard, card and photo stays visible to everyone.`,
        confirmLabel: `Lock ${n(open.length)}`,
      },
    };
  }

  return {
    next: false,
    ids: others.map((e) => e.id),
    label: "Unlock all",
    confirm: {
      title: `Unlock ${n(others.length)}?`,
      body: `Every member will be able to post scores, sign cards and place bets in `
        + `${others.length === 1 ? "it" : "all of them"} again. Nothing remembers which years `
        + `were locked, so this can't be undone by locking them back.`,
      confirmLabel: `Unlock ${n(others.length)}`,
    },
  };
};

// The one-word state for a row in the list. Null when there is nothing to say,
// so a caller can render nothing rather than an empty badge.
export const lockBadge = (edition) => (isEditionLocked(edition) ? "LOCKED" : null);

// Shown on the tournament itself, not in the picker: what a member should be
// told when the year they are looking at will not accept their writes. Null
// for an unlocked edition, and null for a director, who is exempt and would
// otherwise be warned about a wall that is not there for them.
export const lockNotice = (edition, { isDirector = false } = {}) => {
  if (!isEditionLocked(edition) || isDirector) return null;
  const year = edition?.year ?? edition?.id ?? "This tournament";
  return `${year} is locked. Scores, signatures and bets can't be changed — ask a director.`;
};
