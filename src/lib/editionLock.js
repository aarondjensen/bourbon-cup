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

// The id the seed writes. It lives HERE rather than in lib/demoSeed with the
// rest of the seed, for the same reason isDemoEdition does: demoSeed imports
// `editionDocId` from firebase.js, so anything firebase.js needs cannot come
// from there without a cycle. firebase.js reads this to decide where a store
// build starts. `demoSeed` re-exports it, so the seed and its tests carry on
// reading one constant.
//
// Note this is the ID, and `isDemoEdition` below is deliberately NOT a
// comparison against it — an edition is a demo because it says so, not
// because of what it is called. The next scratch edition will have a
// different id and still need the same treatment.
export const DEMO_EDITION_ID = "bc_demo";

// ── A demo is not a cup ────────────────────────────────────────────
// `bc_demo` is a whole invented tournament seeded for the store reviewers and
// the twelve Play testers (lib/demoSeed). It lives here, in the pure module,
// rather than in editions.js — which imports firebase.js and therefore cannot
// be imported by anything that wants to be unit-tested. `editions.js`
// re-exports it, so every call site reads the one predicate.
//
// It matters in three places, and the third is the one this file owns:
//
//   the Data tab   would fold the invented field into ten years of career
//                  records (see lib/archiveLive).
//   cloneEdition   would copy that roster into next year's real tournament.
//   bulkLockVerdict — below. "Lock all but 2026" means every OTHER year, and
//                  the demo is another year. Locking it is never what the
//                  director means: it silently stops the twelve testers
//                  posting scores, and the one member who cannot notice is
//                  the director, who is exempt from the lock they just set.
export const isDemoEdition = (edition) => edition?.is_demo === true;

// ── Who administers THIS edition ───────────────────────────────────
// A director anywhere, or any member inside a demo. The mirror of
// `canAdminEdition()` in firestore.rules, and it has to stay a mirror: the app
// must never draw an Admin tab whose every write the rules would refuse, which
// is the same rule that keeps the crown off the roster document.
//
// Why a member gets REAL admin in a demo rather than a read-only Admin drawn
// for them: App Review and a dozen Play testers need to see what the app is,
// and the roster, the draw, the courses and the rounds are half of it. An
// Admin that rendered and refused would be worse than either — AdminView
// auto-saves on edit and `db.upsert` swallows a rejection, so a reviewer would
// type a name, watch it appear, and find it gone on the next load.
//
// `isMember` and `isDirector` are passed in rather than derived, because
// this module is pure and both come from the bc_accounts document that only
// firebase.js can read. A GUEST is neither: no account, no membership, and
// no write the rules would take.
//
// What it deliberately does NOT cover is everything project-wide — the list of
// tournaments, the password, and the crown. Those are not scoped by any
// edition, so `demoOnlyAdmin` below is what the screens use to hide them.
export const canAdminEdition = ({ isDirector, isMember, edition } = {}) =>
  isDirector === true || (isMember === true && isDemoEdition(edition));

// The half of the above that is NOT a director — somebody administering a demo
// on a membership alone. The three cards that would be shown-and-refused are
// hidden for them, which is the same no-lying rule as everything else here.
export const demoOnlyAdmin = (args) =>
  args?.isDirector !== true && canAdminEdition(args);

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
  // Demo tournaments are not "other years" for this purpose — see
  // isDemoEdition above. A director on the real 2026 tapping "Lock all but
  // 2026" wants the finished cups frozen; sweeping the demo in with them
  // stops the closed test dead, and stops it invisibly, because the person
  // who set the lock is exempt from it.
  const others = (editions || []).filter((e) => e?.id && e.id !== activeId && !isDemoEdition(e));
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

// (There was a `lockBadge` here that returned the word "LOCKED" for a row in
// the picker. The picker draws the padlock glyph beside the name now — one
// line per edition, and the word was the second half of a two-line row that
// mostly restated itself. `isEditionLocked` is what the row asks.)

// Shown on the tournament itself, not in the picker: what a member should be
// told when the year they are looking at will not accept their writes. Null
// for an unlocked edition, and null for a director, who is exempt and would
// otherwise be warned about a wall that is not there for them.
export const lockNotice = (edition, { isDirector = false } = {}) => {
  if (!isEditionLocked(edition) || isDirector) return null;
  const year = edition?.year ?? edition?.id ?? "This tournament";
  return `${year} is locked. Scores, signatures and bets can't be changed — ask a director.`;
};

// ── What the picker draws on a row ─────────────────────────────────
// Three tiny decisions, here rather than in the component, because each one
// decides whether something appears at all — and "does this render?" is the
// class of bug a screenshot catches a week late and a test catches instantly.
//
// The row is YEAR-FIRST: a tabular numeral that is never truncated, then
// whatever these three say to add. That inversion is the whole fix. Every
// earlier layout made the name flexible and the controls rigid, so pressure
// fell on the one thing identifying the row — at 320pt with four director
// controls the name was down to "…p 2026".

// The name, but only when it says something the year does not.
//
// Every edition is called "The Bourbon Cup ####", so printing the name beside
// the year is printing the year twice and eleven rows read identically. A
// tournament somebody actually named — "DEMO — Testers", "2026 Test Copy" — is
// the case worth the space, and it is exactly the case this detects.
//
// An EXACT match against the app's own title, not "does the name end in the
// year". That looser rule was tried first and it is wrong in the direction
// that loses information: a director who names an edition "Bandon Dunes 2024"
// gets a row that says 2024 and nothing else. The title is passed in rather
// than imported because this module is pure and because WBC's cup is not
// called The Bourbon Cup — one helper, each app naming its own tournament.
//
// Compared case- and whitespace-insensitively: `createEdition` writes
// `${title} ${year}` itself, but a director who retypes it by hand should not
// get a second copy of the year for a stray double space.
const flat = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export const editionDisplayName = (edition, title = "") => {
  const name = String(edition?.name ?? "").trim();
  if (!name) return null;
  const year = String(edition?.year ?? "").trim();
  if (!year) return name;              // nothing to be redundant with
  if (flat(name) === flat(year)) return null;
  if (title && flat(name) === flat(`${title} ${year}`)) return null;
  return name;
};

// The status, but only when the status is news.
//
// Ten editions out of twelve are finished cups. ARCHIVED on ten rows is not a
// label, it is the background — repeated ten times — against which the one row
// that matters has to be found. Anything that is not a draft or a published
// year (including a status a later release invents and this one has never
// heard of) reads as a year that is over, which is what an edition in this
// list is unless it says otherwise.
export const editionStatusChip = (edition) => {
  const s = edition?.status;
  return s === "published" ? "PUBLISHED" : s === "draft" ? "DRAFT" : null;
};

// ── What the sheet offers ──────────────────────────────────────────
// Behind a tap on the row. Returned as data rather than written inline so the
// two rules that are easy to get wrong are pinned:
//
//   • You cannot OPEN the year you are already in — there is nowhere to go.
//   • You cannot DELETE it either, and that is not a UI nicety: `deleteEdition`
//     refuses the active edition outright, because the running app would lose
//     its data out from under it. Today that refusal shows up as a 🗑 that
//     quietly is not drawn, which tells a director nothing. The sheet says it.
//
// `canManage` is the same flag the picker takes and the same non-boundary:
// firestore.rules is what actually allows a bc_editions write, and this only
// decides what a person is offered so they are not handed a tap that comes
// back refused.
export const editionActions = ({ edition, isActive = false, canManage = false } = {}) => ({
  open: !isActive,
  rename: canManage,
  lock: canManage,
  status: canManage,
  // A demo is deletable like anything else; only being ACTIVE stops it.
  delete: canManage && !isActive,
  // Why the two that are missing are missing, in words, for the one case where
  // their absence would otherwise be silent.
  note: isActive
    ? "You're in this tournament, so there's nothing to open and it can't be deleted. Switch to another year first."
    : null,
  locked: isEditionLocked(edition),
});
