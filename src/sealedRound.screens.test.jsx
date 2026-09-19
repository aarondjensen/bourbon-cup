/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  EVERY SCORE IN, EVERY CARD SIGNED, AND NOT ONE WORD OF THE RESULT
// ══════════════════════════════════════════════════════════════════
//
// The state this pins is the one the closing round actually sits in for the
// hour before the room sits down, and it is the one nothing else tests:
//
//   • all eighteen holes posted, both sides, every man
//   • every card SIGNED
//   • every card ATTESTED
//   • the round NOT final — the countdown has not run
//
// Each of those three is a door somewhere else in the app: a complete card
// unlocks the Full Scorecard, a signed card promotes a panel, attestation is
// what the finalize gate counts. None of them may unlock the ROUND, and the
// cup points least of all — a leaderboard that has banked round 4 an hour
// early has given away the evening the whole tradition is built on.
//
// lib/reveal.test.js pins the arithmetic and reveal.surfaces.test.js pins the
// contract. Leaderboard.seal and FullScorecard.seal pin those two screens.
// This is the sweep ACROSS screens, in that state, asking one question of
// each: is the answer on it anywhere?
//
// WHAT IT ASSERTS AGAINST is computed, not typed. The round is scored twice —
// once off the raw map, which is what a leak would print, and once off the
// concealed map, which is what every read-only surface is handed — and the
// forbidden set is whatever the first one says and the second one does not.
// A test with the numbers written into it goes stale the day somebody edits
// the fixture; this one cannot.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("./lib/auth", () => ({
  PROVIDERS: { GOOGLE: "google.com", APPLE: "apple.com" },
  signIn: async () => ({ user: null, error: null }),
  signOutUser: async () => {},
  onAuthUser: () => () => {},
  consumeRedirectResult: async () => ({ user: null, error: null }),
  isCancelled: () => false,
  whenAuthReady: async () => {},
  providerLabel: () => "account",
}));

vi.mock("./firebase", () => ({
  db: { subscribe: () => () => {}, upsert: async () => null, delete: async () => null, get: async () => [] },
  TOURNAMENT_ID: "bc_test",
  editionDocId: (id) => id,
  getTournamentYear: () => 2026,
  writeFailure: () => "failed",
  writeTracker: { track: (p) => p, state: () => ({ pending: 0, kinds: {}, since: null, refused: 0, refusedKinds: {} }), subscribe: () => () => {} },
  firebaseApp: {},
  getMessagingInstance: async () => null,
  getActiveTournamentId: () => "bc_test",
  getDefaultEditionId: () => "bc_test",
  setActiveTournamentId: () => {},
  readUserSession: () => null,
  writeUserSession: () => {},
  readTournamentIdentity: () => null,
  writeTournamentIdentity: () => {},
  spectatorSession: () => null,
  BOOTSTRAP_DIRECTOR: "bootstrap_director",
  SPECTATOR_ID: "spectator",
}));

import { TeamLeaderboard } from "./components/Leaderboard";
import { SignCardSheet, SignedCardPanel } from "./components/CardSignature";
import { ScoreEntry } from "./App";
import { concealHoleData } from "./lib/reveal";
import { computeMatchResult } from "./scoring";

afterEach(cleanup);

// jsdom reports 1024×768. Both widths are exercised below — a phone and a
// television draw different trees, and a leak in one is a leak.
const setWidth = (w) => { window.innerWidth = w; window.dispatchEvent(new Event("resize")); };
const PHONE = 393;
const TV = 1280;
afterEach(() => setWidth(TV));

// ── The tournament ──────────────────────────────────────────────────
const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const A = Array.from({ length: 8 }, (_, i) => `a${i + 1}`);
const B = Array.from({ length: 8 }, (_, i) => `b${i + 1}`);

const courses = [{
  id: "c1", name: "Treetops", par: 72, hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tPlayers = [...A, ...B].map((pid, i) => ({
  player_id: pid, name: `${A.includes(pid) ? "Irons" : "Drivers"} ${i + 1}`,
  team: A.includes(pid) ? "A" : "B", handicap_index: 0,
  ...(pid === "a1" ? { auth_uid: "u1" } : {}),
}));
const teams = { A: { id: "A", name: "Irons", accent: "#1f8a4c" }, B: { id: "B", name: "Drivers", accent: "#0f7f8c" } };
const teamNames = { A: "Irons", B: "Drivers" };

// Round 4, sealed, worth real points, nothing turned over.
const round4 = {
  round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "points",
  hole_points: { front: 1, back: 1 },
  counting_scores: { holes: [...Array(9).fill(6), ...Array(9).fill(7)] },
  sealed: true, reveal_through: 0, final: false,
  date: "2026-07-19", tee_time: "8:00|8:10|8:20|8:30",
};
const tRounds = [round4];
const match4 = {
  id: "m4", round: 4, teamA: A, teamB: B,
  scoring_type: "points", hole_points: { front: 1, back: 1 }, tournament_id: "bc_test",
};
const matches = [match4];
// Waves of four, teammates together — what a team round's draw is.
const waves = [A.slice(0, 4), B.slice(0, 4), A.slice(4), B.slice(4)];

// EVERY hole, EVERY man, both sides. Drivers rout Irons by three a ball on
// all eighteen, which is precisely the answer the countdown exists to hold.
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  A.forEach((pid) => { holeData[`${pid}_4`] = { ...(holeData[`${pid}_4`] || {}), [h]: 6 }; });
  B.forEach((pid) => { holeData[`${pid}_4`] = { ...(holeData[`${pid}_4`] || {}), [h]: 3 }; });
});
const getScore = (pid, h) => holeData[`${pid}_4`]?.[h] || 0;

// Every card signed AND attested. Team Best Ball signs by tee wave, so there
// is one card a wave (lib/cardSigs).
const cardSigs = waves.map((pids, i) => ({
  id: `sig_${i}`, tournament_id: "bc_test", round_number: 4,
  match_id: "m4", card_key: `m4:w${i}`, wave_index: i, player_ids: pids,
  signed_by: pids[0], signed_at: "2026-07-19T18:00:00.000Z",
  attested_by: pids.slice(1), attested: true, attested_at: "2026-07-19T18:05:00.000Z",
}));

// ── What a leak would say, and what it may say instead ──────────────
// Scored twice through the app's own engine: once off the raw map (the
// answer) and once off the concealed map (what every read-only surface is
// handed). Nothing computed from the first may appear anywhere.
const scoreWith = (data) =>
  computeMatchResult(match4, data, courses, tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {});

const revealed = concealHoleData(holeData, tRounds);
const answer = scoreWith(holeData);
const blank = scoreWith(revealed);

// The points round 4 is worth to each side, which is the thing that must not
// land on any board an hour early.
const pts = (r) => ({ A: r.totalPts?.A ?? 0, B: r.totalPts?.B ?? 0 });

describe("the fixture really is the state in question", () => {
  it("has every hole posted by every man on both sides", () => {
    [...A, ...B].forEach((pid) => {
      expect(Object.keys(holeData[`${pid}_4`])).toHaveLength(18);
    });
  });

  it("has a real result behind the seal", () => {
    // If this ever computed to nothing the sweep below would pass for the
    // worst possible reason: there was no answer to leak.
    expect(pts(answer).B).toBeGreaterThan(0);
    expect(pts(answer).B).toBeGreaterThan(pts(answer).A);
  });

  it("has every card signed and attested", () => {
    expect(cardSigs).toHaveLength(4);
    cardSigs.forEach((s) => {
      expect(s.signed_by).toBeTruthy();
      expect(s.attested).toBe(true);
    });
  });

  it("scores as a round nobody played once the map is cut", () => {
    // The structural half, restated here because every assertion below rests
    // on it: the read-only surfaces are not trusted to withhold the answer,
    // they are handed a round that has no answer in it.
    expect(pts(blank)).toEqual({ A: 0, B: 0 });
    expect(Object.keys(revealed)).toHaveLength(0);
  });
});

// ── The sweep ───────────────────────────────────────────────────────
// One question per screen: with all of that true, does the round's result
// appear? `forbidden` is derived from the scored answer rather than typed,
// so editing the fixture cannot quietly empty it.
const forbidden = () => {
  const p = pts(answer);
  const out = [];
  // The points, in the shapes the app prints them.
  [p.A, p.B].forEach((v) => {
    if (v > 0) { out.push(`${v} PT`, `${v} PTS`, `${v} POINT`, `${v} POINTS`); }
  });
  // The side's total for a hole, which is a best-N sum and appears nowhere
  // else on a screen — 12 for Drivers' four best 3s, 24 for Irons' 6s.
  const h = answer.holes?.[0];
  if (h?.aScore != null) out.push(`${h.aScore}`);
  if (h?.bScore != null) out.push(`${h.bScore}`);
  return out;
};

// Text, with the things that are legitimately on screen taken out first: a
// handicap, a tee time and a hole number are digits too, and the point of
// this sweep is the ROUND'S result rather than every numeral in the app.
const verdictWords = [
  "IRONS WIN", "DRIVERS WIN", "IRONS TAKE", "DRIVERS TAKE",
  "UP THRU", " UP", " DN", "HALVED",
];

const saysNothing = (label, text) => {
  // The round's own verdict, in words.
  verdictWords.forEach((w) => {
    expect(text.toUpperCase().includes(w), `${label} says "${w.trim()}"`).toBe(false);
  });
  // And the points it is worth.
  forbidden().filter((f) => /PT|POINT/.test(f)).forEach((f) => {
    expect(text.toUpperCase().includes(f.toUpperCase()), `${label} says "${f}"`).toBe(false);
  });
};

describe("the Leaderboard", () => {
  const board = (viewer = "A") => render(
    <TeamLeaderboard
      matches={matches} holeData={revealed} ownHoleData={holeData}
      countdownHoleData={{}} courses={courses} tRounds={tRounds}
      tPlayers={tPlayers} teams={teams} hcpOverrides={{}} teeAssignments={{}}
      roundLocks={{}} viewer={viewer} cardSigs={cardSigs}
    />
  ).container.textContent;

  it("states nothing of the round, to either side", () => {
    saysNothing("leaderboard (A)", board("A"));
    cleanup();
    saysNothing("leaderboard (B)", board("B"));
  });

  // The cup bar is the number everybody reads first, and round 4 is the only
  // round in this fixture — so a board that has banked it reads the answer,
  // and one that has not reads nothing at all.
  it("banks none of its points in the cup total", () => {
    const t = board("A");
    expect(t).toContain("Irons");
    expect(t).toContain("Drivers");
    const p = pts(answer);
    // Not the winning side's points, in any of the shapes the app writes a
    // points total: bare, with a decimal, or labelled.
    [`${p.B}`, `${p.B}.0`, `${p.B} PT`, `${p.B} PTS`].forEach((shape) => {
      expect(t.toUpperCase().includes(shape.toUpperCase()),
        `cup bar says "${shape}"`).toBe(false);
    });
  });

  it("is the same board on a phone", () => {
    setWidth(PHONE);
    saysNothing("leaderboard (phone)", board("A"));
  });
});

describe("the Scoring tab, with every card signed and attested", () => {
  const scoring = (over = {}) => ({
    user: { ...tPlayers[0], isDirector: false },
    matches, holeData, onSaveHole: async () => {},
    tPlayers, courses, tRounds, notify: () => {},
    teams, hcpOverrides: {}, teeAssignments: {}, roundLocks: {},
    rounds: [4], currentRound: 4, groups: { 4: waves },
    ctpData: {}, onSetCtp: async () => {}, onConfirmCtp: async () => {},
    buyIns: {}, cardSigs, onSignCard: async () => {},
    onAttestCard: async () => {}, onUnsignCard: async () => {},
    ...over,
  });
  const text = (over) => render(<ScoreEntry {...scoring(over)} />).container.textContent;

  // The Scoring tab is the ONE screen handed the raw map, and it has to be:
  // a man standing on the 7th is entering four cards. What is concealed there
  // is what the entries ADD UP TO.
  it("states no result to a player whose card is signed and attested", () => {
    setWidth(PHONE);
    saysNothing("scoring (player)", text());
  });

  it("states none to the other side either", () => {
    setWidth(PHONE);
    saysNothing("scoring (other side)", text({ user: { ...tPlayers[8], isDirector: false } }));
  });

  // The director is the one person the seal cannot be enforced against — he
  // can unseal the round in two taps. What he must not get is the answer
  // handed to him by a screen he opened for another reason.
  it("states none to a director either", () => {
    setWidth(PHONE);
    saysNothing("scoring (director)", text({ user: { ...tPlayers[0], isDirector: true } }));
  });

  it("says the same on a television-width window", () => {
    setWidth(TV);
    saysNothing("scoring (wide)", text());
  });
});

describe("the card a man signed, and the card he attested", () => {
  const cardProps = (conceal) => ({
    card: { key: "m4:w0", match: match4, pids: waves[0], label: "8:00" },
    match: match4, result: answer, format: "team_best_ball",
    holePars: PARS, holeHcps: SI, course: courses[0],
    tPlayers, getScore, viewer: "A",
    conceal, ownSideOnly: true, waves: [{ label: "8:00", pids: waves[0] }],
    foursome: waves[0],
  });
  // What App hands them while the round conceals (see `conceal` in App.jsx).
  const sealed = { through: 0, side: "A" };

  it("shows no running match on the sheet he signs", () => {
    setWidth(PHONE);
    const t = render(
      <SignCardSheet
        cards={[{ key: "m4:w0", match: match4, result: answer }]}
        {...cardProps(sealed)}
        onSign={async () => {}} onClose={() => {}}
      />
    ).container.textContent;
    saysNothing("sign sheet", t);
  });

  it("shows none on the panel once it is signed and attested", () => {
    setWidth(PHONE);
    const t = render(
      <SignedCardPanel
        {...cardProps(sealed)}
        sig={cardSigs[0]} userPid="a1" onUnsign={async () => {}}
        onAttest={async () => {}} notify={() => {}}
      />
    ).container.textContent;
    saysNothing("signed panel", t);
  });
});

// ── The one that would be invisible ─────────────────────────────────
// Every assertion above is a screen somebody looks at. This one is a stored
// row: `bc_editions.result`, which App writes back so the Tournaments picker
// and the Data tab can state a year's score without opening it. A screen
// corrects itself when the reveal finishes; a row does not.
describe("nothing is archived while the round is held", () => {
  it("is gated on the identity of the concealed map, not on completeness", async () => {
    const { summarizeEdition } = await import("./lib/editionSummary");
    const summary = summarizeEdition({
      matches, holeData: revealed, courses, tRounds,
      tPlayers, hcpOverrides: {}, teeAssignments: {}, roundLocks: {},
      teamNames, location: "MI",
    });
    // App's gate is `revealedHoleData === holeData` — reference equality, and
    // it is exact. A sealed round makes a new object, so the write never
    // fires; this pins the input side of that.
    expect(revealed).not.toBe(holeData);
    // And even if it did fire, the summary it would store has no points in it
    // rather than half a cup.
    expect(summary.teamA?.points ?? 0).toBe(0);
    expect(summary.teamB?.points ?? 0).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
//  THE WIRING, READ OFF THE SOURCE
// ══════════════════════════════════════════════════════════════════
//
// Everything above mounts a screen. That can only ever cover the screens
// this file knows to mount — and the failure this whole area is exposed to
// is a screen NOBODY THOUGHT TO CHECK, wired to the raw map by somebody who
// had no idea the closing round was played in the dark. The Betting tab
// reached that way once (skins are settled hole by hole), and so did the
// round summary sheet, and so did the CTP pins.
//
// So this reads App.jsx and asks the structural question directly: what is
// every `holeData` prop in the tree handed? The answer must be the CONCEALED
// map, unless the reader is on the short list below and the list says why.
//
// It is a blunt instrument and it is deliberately blunt. A new tab wired to
// `holeData` fails here on the day it is written rather than on the one
// evening a year the difference shows — and the fix is either to hand it
// `revealedHoleData` or to add it here with a reason, which is a line a
// reviewer reads.
describe("AUDIT: what App hands each screen", () => {
  // The readers allowed the RAW map, and the reason each one is allowed it.
  // Anything not on this list gets `revealedHoleData`.
  const RAW_IS_FINE = {
    ScoreEntry:
      "The one screen a man scores FROM: he is standing on the 7th entering "
      + "four cards, two of which belong to the other side. What is concealed "
      + "there is what the entries ADD UP TO — see `conceal` in App.jsx — not "
      + "the numbers being typed.",
    AdminView:
      "The director's own console. He can unseal the round in two taps, so "
      + "withholding it from him buys nothing and would break the one screen "
      + "that has to be able to correct a hole.",
  };

  // Off the working directory rather than `import.meta.url`: this file runs
  // under jsdom, where that is an http: URL and `readFileSync` refuses it.
  const source = async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { resolve, dirname } = await import("node:path");
    // Resolved off THIS file rather than the working directory, so it does
    // not depend on where vitest was started from.
    const here = dirname(fileURLToPath(import.meta.url.replace(/^https?:\/\/[^/]+/, "file://")));
    return readFileSync(resolve(here, "App.jsx"), "utf8");
  };

  // Walk back from a `holeData={…}` prop to the JSX tag that owns it.
  const readerOf = (text, at) => {
    const open = text.lastIndexOf("<", at);
    const m = /^<([A-Za-z][\w.]*)/.exec(text.slice(open, at));
    return m ? m[1] : null;
  };

  it("hands every read-only screen the concealed map", async () => {
    const text = await source();
    const seen = [];
    const re = /holeData=\{([A-Za-z][\w.]*)\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      seen.push({ value: m[1], reader: readerOf(text, m.index) });
    }
    // If this ever finds nothing the test has stopped testing anything —
    // a rename, a refactor, a prop spread.
    expect(seen.length).toBeGreaterThanOrEqual(5);

    seen.forEach(({ value, reader }) => {
      if (value === "revealedHoleData") return;
      expect(
        Object.prototype.hasOwnProperty.call(RAW_IS_FINE, reader),
        `<${reader}> is handed \`${value}\`. Every screen gets `
        + "`revealedHoleData` — the round with a concealing round subtracted "
        + "WHOLE (see lib/reveal). If this reader genuinely needs the raw "
        + "holes, add it to RAW_IS_FINE with the reason, and make sure it "
        + "conceals what those holes ADD UP TO.",
      ).toBe(true);
    });
  });

  // The two exceptions, named — so removing one is a visible act rather than
  // a list quietly going empty.
  it("has exactly two exceptions and both are written down", () => {
    expect(Object.keys(RAW_IS_FINE).sort()).toEqual(["AdminView", "ScoreEntry"]);
    Object.values(RAW_IS_FINE).forEach((why) => expect(why.length).toBeGreaterThan(40));
  });

  // `ownHoleData` and `countdownHoleData` are the two deliberate carve-outs,
  // and each has exactly one reader. reveal.surfaces.test.js pins what they
  // contain; this pins that nothing else is handed them.
  it("keeps the two own-side maps to one reader each", async () => {
    const text = await source();
    // `\b` is load-bearing: "countdownHoleData" ENDS in "ownHoleData", so
    // the unanchored pattern counts the other map as well.
    expect(text.match(/\bownHoleData=\{/g) || []).toHaveLength(1);
    expect(text.match(/countdownHoleData=\{/g) || []).toHaveLength(1);
  });
});
