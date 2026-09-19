// ══════════════════════════════════════════════════════════════════
//  FullScorecard — the Scoring tab's "Full Scorecard" popup.
// ══════════════════════════════════════════════════════════════════
//
//  Framed on MNQ's expanded scorecard (mnq-golf-league,
//  src/components/SharedScorecard.jsx), which reads better than the
//  four-row team grid this replaced for one reason: it shows the CARD.
//  A player opening this on the 14th tee is looking for what they and
//  their partner actually wrote down, and the old view had no room for
//  it — it went straight from PAR to the two sides' net numbers, so the
//  gross scores the group is arguing about were nowhere on screen.
//
//  MNQ's block, per nine:
//
//    HOLE   1 2 3 4 5 6 7 8 9  OUT   ← accent band
//    PAR    4 4 3 5 …           36
//    HCP    7 1 15 …                 ← which holes give strokes
//    AJ 12  ⑤ 4 3 …             38   ← per-player GROSS, golf notation.
//    KJ  8  4 ④ 6 …             41     Initials in the team's color.
//    NET    4 3 3 …             33   ← the side's number for the hole
//    MATCH  ▲1 ▲2 AS …        2 UP   ← where the match stands
//    …                                 then Team B, same shape
//
//  What that buys, in order of how much it matters on a phone:
//
//    • THE CARD ITSELF — the gross numbers the group wrote down, one row
//      per player, which the four-row team grid this replaced had no room
//      for at all. MNQ boxes and circles them in golf notation; this card
//      does not, and "The box, and what it costs" below is why.
//    • STROKE DOTS on the cell that gets them, not in a legend. The dots
//      come from result.strokeMaps — the same allocation the match was
//      scored with — so the card cannot show a stroke the engine didn't
//      give.
//    • ONE ROW PER PLAYER, initials in their team's color, with the
//      side's scoring row directly beneath. How the side's number was
//      made is then visible rather than asserted. On a shared-ball format
//      (scramble, pinehurst) the side plays one ball, so it gets one row
//      for both partners instead of one each — see `shared` below.
//
//  Bourbon Cup differences from MNQ, all of them forced by this app
//  having formats MNQ does not:
//
//    • Two nines, not one. Each is its own block, and each block's OUT /
//      IN cell carries that nine's segment state — which is a real
//      result here, because the Nassau pays out on it. A NINES row under
//      the header states both again, together and in full: a Nassau card
//      settles three matches and signing it swears to all three at once,
//      which is not something to read off two chips sixteen rows apart.
//      See the block above `nine()`.
//    • The side's row is not always net strokes. It is whatever the
//      hole was SCORED in (scoring.js holeFormatFor) — net strokes for
//      most formats, dots on Double Dot, points on Stableford and Tilt —
//      and the row is labelled for it. Its numbers come straight off
//      result.holes, so this card cannot disagree with the leaderboard.
//    • Team colors instead of MNQ's single accent, and no
//      your-team-on-top swap: Team A stays on top, in the same order as
//      the player cards on the screen behind this popup.
//    • ONE currency of color, and it is the team's. A hole belongs to the
//      team that took it; the running match belongs to the team that is
//      ahead; a stated result — the overall status, a nine's status, a
//      clinch — names a winner. All three are painted in that team's color,
//      here and in the Scoring tab's status strip behind this popup (see
//      App.jsx, renderStatusCell).
//
//      The running match used to be the exception, painted green/red from
//      the reader's own side. Two reasons it is not: BC.teamA under BC.green
//      is two greens saying nearly the same thing in different hues, two
//      pixels apart; and "good news for me" is a question the card cannot
//      always answer — `viewer` falls back to a reader's roster team, so a
//      director reading somebody else's card was handed a side. WHOSE the
//      lead is, it can always answer.
//
//      What stays from the reader's side is the ▲ / ▼, which needed no
//      color to do it.
//
//  ── The box, and what it costs ─────────────────────────────────────
//  There is exactly ONE boxed number on this card and it means the side
//  TOOK THE HOLE. Not a bogey. The gross rows carry no golf notation at
//  all — no circles, no squares — and that is a deliberate trade, made
//  after the card was read on a phone.
//
//  Notation is the better language in the abstract and this card is the
//  wrong place for it, because the card has to say something notation
//  cannot: who won the hole. Both were drawn as a rounded outline, at the
//  same radius and the same 1.5px, in the SAME COLUMN two rows apart. On
//  the 14th that came out as a circled 4 with a boxed 3 directly beneath
//  it, which anybody who has ever held a scorecard reads as "birdie, then
//  bogey" — when what happened is a birdie that won the hole.
//
//  Trying to keep both by splitting the treatments (fill for the hole,
//  outline for the score) worked and was still two vocabularies to hold
//  on one 26px row. Dropping one is simpler, and the one to drop is the
//  one the card can afford: par is on screen, two rows up, in the PAR
//  row directly above the score it belongs to. Which side won the hole
//  is on screen nowhere else.
//
//  So:
//
//    a boxed number     the side took this hole (NET row), or took the
//                       match here (the clinch stamp). Team-coloured.
//    a washed chip      a STATED result: F9 / B9, OUT / IN.
//    a bare number      everything else, gross scores included.
//
//  `ScoreCell` still knows how to draw notation and still does on the
//  FIELD card (components/FieldCard), which has no won-hole row to
//  collide with and no other way to say par. This card passes
//  `notation={false}`.
//
//  Everything here is presentational. Every number is either a gross
//  score the group entered or something computeMatchResult already
//  worked out.
// ══════════════════════════════════════════════════════════════════

import { playerLookup, sideNames } from "../lib/players";
import { BC, FONT, ALPHA, FS, ON_AMBER, teamColor } from "../theme";
import {
  UNIT_DOTS, UNIT_POINTS, HANDICAP_MODE_LOW_MAN,
  formatIsSharedBall, isPointsPerHole, formatGroupsByTeam, getTeam,
} from "../constants";
import {
  fmtScore,
  higherIsBetter, totalUnit, holeFormatFor, settlesOnTotal,
  segmentState, statusText, segmentLeader, segmentOptsFor, nassauSegmentVisibility,
  sharedBallScore,
} from "../scoring";

// ── Grid geometry ────────────────────────────────────────────────
// The label and total columns are fixed so the nine hole columns are
// identical across every row and every nine; they flex into whatever is
// left. 42 + 34 leaves ~29px a hole on the narrowest phone this app
// supports, which is one pixel more than a 21px score cell needs.
const LABEL_W = 42;
const TOT_W = 34;
// Score-cell type size. MNQ runs 15 on a full-width card and 13 in its
// compact ones; 18 holes on a phone is the compact case.
const CELL = 13;

const gridLine = () => `1px solid ${BC.bdr}${ALPHA.hair}`;
const colBdr = () => `1px solid ${BC.bdr}${ALPHA.line}`;

// Row-label cell — the left column on every row below the band.
const labelCell = (h, extra) => ({
  width: LABEL_W, flexShrink: 0, height: h,
  fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.3, color: BC.t3,
  display: "flex", alignItems: "center", paddingLeft: 4,
  borderRight: colBdr(),
  ...extra,
});

const totCell = (h, extra) => ({
  width: TOT_W, flexShrink: 0, height: h,
  display: "flex", alignItems: "center", justifyContent: "center",
  borderLeft: colBdr(),
  ...extra,
});

// ── The TOTAL column ──────────────────────────────────────────────
// The eighteen-hole figure, and it only exists on the back block — a total
// under the front nine would be the nine's own number said twice, and there
// is no eighteen to total halfway through one.
//
// The column is drawn on BOTH blocks all the same, empty on the front. Two
// blocks of the same card with different column counts do not line up, and
// the eye reading down a card that is nine columns wide at the top and ten
// at the bottom stops trusting that the columns mean the same thing. It
// costs 34px of a phone once; it buys a card that reads as one grid.
const sumCell = (h, extra) => ({
  width: TOT_W, flexShrink: 0, height: h,
  display: "flex", alignItems: "center", justifyContent: "center",
  borderLeft: colBdr(),
  ...extra,
});

// Player initials from a full name — "Aaron Jensen" → "AJ".
const initials = (name) =>
  String(name || "?").trim().split(/\s+/).map((n) => n[0]?.toUpperCase() || "").join("") || "?";

// ══════════════════════════════════════════════════════════════════
//  ScoreCell — the gross score in golf-scorecard notation
// ══════════════════════════════════════════════════════════════════
//  Ported from MNQ's ScoreCell. Circle = birdie, double circle = eagle
//  or better, square = bogey, double square = double or worse, bare
//  number = par. Above the number sits one dot per handicap stroke the
//  player gets on the hole, so a net score never has to be printed
//  beside a gross one — the reader subtracts the dots.
//
//  `notation: false` keeps the digit and the dots and drops the rings. The
//  MATCH card passes it, because a boxed number there already means the
//  side won the hole and two meanings for one box is worse than one
//  meaning missing — see "The box, and what it costs" above. The FIELD
//  card leaves it on: nothing on it is boxed for any other reason.
//
//  An empty cell keeps the same height AND still draws its stroke dots:
//  a blank card at the turn is how a player checks where their shots
//  fall on the nine they are about to play.
//
//  `skin` fills the cell amber — the score took the hole outright. It is
//  used by the field card (components/FieldCard) and by nothing on a match
//  card, because a match card holds four of the field's players and cannot
//  know whether a low number here was low across the round.
//
//  The fill sits UNDER the notation rather than replacing it, and the ring
//  and the digit both switch to ON_AMBER: a skin is very often a birdie,
//  and a treatment that ate the ring would trade the card's oldest piece of
//  language for its newest.
export function ScoreCell({ score, par, strokes = 0, size = CELL, color, skin = false, notation = true }) {
  const s = size;
  const sh = s + 8;      // the ring/box is a little larger than the digit
  const dotH = 9;        // the stroke-dot lane above it
  const bc = skin ? ON_AMBER : (color || BC.t2);

  const dots = strokes > 0 && (
    <span style={{ color: BC.hcpBlue, fontSize: FS.micro, fontWeight: 800, letterSpacing: 1, lineHeight: 1 }}>
      {"•".repeat(strokes)}
    </span>
  );
  const lane = (
    <div style={{ height: dotH, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      {dots}
    </div>
  );

  if (!score || score <= 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: dotH + sh, justifyContent: "flex-end" }}>
        {lane}
        <div style={{ width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: `${BC.t3}${ALPHA.hair}`, fontSize: size, lineHeight: 1 }}>·</span>
        </div>
      </div>
    );
  }

  const diff = score - par;
  // The ring is centered on the CELL; the digit is not centered in its own
  // line box (lining figures sit high), so a geometrically-centered ring
  // reads about a pixel low against the number. Nudging the ring up by a
  // fraction of the type size centers it on the glyph instead. Tuned by eye
  // against Montserrat at both cell sizes.
  const ring = {
    position: "absolute", top: "50%", left: "50%",
    transform: `translate(-50%, calc(-50% - ${s * 0.07}px))`,
  };

  // `notation: false` draws the digit and its stroke dots and nothing else.
  // See the prop note above — the match card turns it off because it draws a
  // box of its own two rows down.
  let border = null;
  if (notation && diff <= -2) {
    border = (
      <div style={{ ...ring, width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 6, height: sh - 6, borderRadius: "50%", border: `1px solid ${bc}` }} />
      </div>
    );
  } else if (notation && diff === -1) {
    border = <div style={{ ...ring, width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}` }} />;
  } else if (notation && diff === 1) {
    border = <div style={{ ...ring, width: sh, height: sh, borderRadius: 3, border: `1.5px solid ${bc}` }} />;
  } else if (notation && diff >= 2) {
    border = (
      <div style={{ ...ring, width: sh, height: sh, borderRadius: 3, border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 6, height: sh - 6, borderRadius: 2, border: `1px solid ${bc}` }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: dotH + sh, justifyContent: "flex-end" }}>
      {lane}
      <div style={{ position: "relative", width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* Same `ring` placement as the notation, one pixel proud of it on
            every side. It has to carry the optical nudge too: `inset` would
            centre the fill on the CELL while the ring is centred on the
            GLYPH, and the ~1px between those two reads as a bogey square
            sitting low in its own highlight. */}
        {skin && <div style={{ ...ring, width: sh + 2, height: sh + 2, borderRadius: 4, background: BC.amber }} />}
        {border}
        <span style={{ position: "relative", fontSize: s, fontWeight: skin ? 800 : 700, color: skin ? ON_AMBER : (color || BC.t1) }}>{score}</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  FullScorecard
// ══════════════════════════════════════════════════════════════════
//  Props are the pieces the Scoring tab already has resolved for the
//  match it is entering scores into — nothing is re-derived here, so the
//  card cannot show a course, a stroke or a hole result that the screen
//  behind it isn't using.
//
//    getScore(pid, holeIdx) → gross, 0 when unentered
//    viewer                 — "A" | "B", the side the reader is on. Only
//                             the running MATCH row uses it; omitting it
//                             leaves that row on Team A's perspective.
//    showHeader             — the names-and-status line, and with it the
//                             NINES row under it. Both are the card stating
//                             its own results, and they travel together.
//                             On by default: in the Scoring popup it is the
//                             only place the four players are spelled out, so
//                             the initials in the rows below have nothing else
//                             to read against. The Leaderboard turns it off —
//                             its match row names the pair and states the
//                             match directly above this, F9 and B9 either
//                             side of it, and its segment pills say all three
//                             a second time.
//    conceal                — { through, side } on a SEALED round, null on
//                             every other one. See lib/reveal.js. Past hole
//                             `through` this card stops printing anything
//                             that COMPARES the two sides — the other side's
//                             row, the hole-won marks, the running line, the
//                             nine's result — and keeps the gross scores,
//                             because on a round whose match is one foursome
//                             the four men on this card walked it together
//                             and wrote all four of those rows between them.
//                             Hiding numbers they typed an hour ago is not
//                             what the blackout owes them; what it owes them
//                             is what those numbers ADD UP TO.
//    waves                  — [{ key, label, pids }] in tee order, when the
//                             match is played across more than one of them.
//                             A 2-man match is its own foursome and passes
//                             nothing; Team Best Ball's side is eight men who
//                             went off in twos, and a flat list of eight put
//                             the men who actually walked together four rows
//                             apart. The rows are grouped under each wave's
//                             tee time instead, in the order the Scoring tab
//                             draws that same wave — which is the order the
//                             card was kept in, and the only one a man
//                             reading it will recognise.
//
//                             Grouping only. Nothing about the scoring moves:
//                             the side's NET row is still the whole side's
//                             best N, summed across every wave, because that
//                             is the match.
//    ownSideOnly            — the other side's card is not on this sheet at
//                             all, sealed or not. The Scoring tab sets it for
//                             a match bigger than a foursome, which today is
//                             Team Best Ball: sixteen men across four tee
//                             waves, so the eight opposite are a different
//                             group on a different tee and nobody holding
//                             this phone wrote a stroke of their card.
//
//                             NOT tied to the reveal, and that is the point.
//                             A rule with no timing in it cannot be got wrong
//                             by a lock state arriving in the wrong order.
//                             The Scoring tab sets it unconditionally because
//                             that popup is a COURSE tool — the card the group
//                             keeps while they are playing — and the detailed
//                             result belongs on the Leaderboard.
//
//                             The LEADERBOARD now sets it too, and only until
//                             the round is final. Two taps on a team round's
//                             row was the shortest way in the app to the
//                             opposing eight's holes, and it stood open for
//                             the whole of a round being played. Which means
//                             "the other side is read off the board" is true
//                             of a round in the books and of nothing else.
//
//                             The reader's OWN side stays visible in full,
//                             other waves included: a team is never hidden
//                             from itself.
//    hiddenNote             — the line drawn where the withheld side's card
//                             would be, when nothing is sealed. It has to say
//                             where the rest of it IS, and that answer depends
//                             on which screen is asking: the Scoring tab sends
//                             you to the leaderboard, and the leaderboard —
//                             which now withholds it too, until the round is
//                             in the books — has to send you to the round
//                             being final instead. Printing the Scoring tab's
//                             line on the board would be the card telling a
//                             reader to go to the screen he is already on.
//                             A sealed round overrides it: SEALED UNTIL THE
//                             REVEAL is the truer answer and it outranks both.
//    course                 — no longer read. The card used to print a terms
//                             line under the header — course · format ·
//                             scoring · match play — and it restated things
//                             the screens around it already say: the Scoring
//                             tab carries a format badge over the status strip
//                             (App.jsx, the "Format / round badge" block,
//                             which also names a best-ball override), the
//                             Matches tab banners every round with its course
//                             and format, and the row labels on this card
//                             already say NET / DOTS / PTS and MATCH / LEAD.
//                             Every caller still passes it, so putting the
//                             line back is a render, not a rewiring job.
export function FullScorecard({
  match, result, format, holePars, holeHcps, tPlayers, getScore,
  viewer = "A", showHeader = true, conceal = null, ownSideOnly = false,
  waves = null, foursome = null, hiddenNote = "FULL CARD ON THE LEADERBOARD",
}) {
  if (!result) return null;

  // Current names off the roster, falling back to the ones stored on the
  // match for anybody the roster no longer has. See lib/players.sideNames —
  // this header used to read the stored names only, so a renamed player was
  // corrected on the leaderboard card and not inside the scorecard it opens.
  //
  // Through playerLookup rather than the hand-rolled `nameOf` that used to sit
  // further down this file — same find, same pid fallback, one copy.
  const { nameOf } = playerLookup(tPlayers);

  // One question, asked in six places below. `conceal.through` is a count of
  // holes, `h` a 0-based index, so hole `through` is the first sealed one.
  const sealedHole = (h) => !!conceal && h >= conceal.through;
  // A nine only states a result once every hole in it is out.
  const sealedNine = (start) => sealedHole(start + 8);
  // The reader's own side. Off `viewer` rather than off `conceal`, because
  // the question outlives the blackout now: `ownSideOnly` withholds the other
  // side whether or not anything is sealed, and there is no conceal object to
  // read a side out of then. Both callers pass the same value to both.
  const mySide = viewer === "B" ? "B" : "A";
  // ── Whether a side's CARD is on this sheet at all ────────────────
  // Withheld as a BLOCK, not cell by cell. Locking each number left eighteen
  // rows of padlocks on a Team Best Ball sheet — eight player rows and a NET
  // row per nine, each one a control saying "no". A row of nothing is not
  // information, it is furniture.
  //
  // No reveal state in it either — the callers decide, and neither asks the
  // seal. The Scoring tab withholds the other side for as long as that screen
  // exists; the Leaderboard withholds it until the round is in the books. So
  // on a match bigger than a foursome the other side is simply never here
  // while the round is being played, and the rule has no timing to get wrong.
  const hiddenSide = (tid) => ownSideOnly && tid !== mySide;
  // The match cannot be stated with one side's card missing, so the running
  // row goes with it rather than printing a line of padlocks under a gap.
  const hiddenMatch = hiddenSide("A") || hiddenSide("B");

  // Through settlesOnTotal, not off formOfPlay — Double Dot accrues its dots
  // whatever the round was saved as, and this row has to be counting the same
  // currency the engine is settling in. Deriving it here separately is how the
  // running row came to print a match-play state on a card the engine was
  // scoring on totals.
  const total = settlesOnTotal(match, format);
  const perHole = isPointsPerHole(match.scoring_type);
  // What the holes were actually scored under — a best-ball override makes
  // them net strokes whatever the round is called, and everything below
  // (direction, row label, notation) has to follow the method, not the name.
  const scoredFormat = holeFormatFor(match, format);
  const higherWins = higherIsBetter(scoredFormat);
  const unit = totalUnit(scoredFormat);
  const holes = result.holes;
  const segOpts = segmentOptsFor({ ...match, hole_points: result.holePoints }, format);

  // What the side's row is counted in. Named for the currency rather than
  // the format, because that is what the numbers in it are.
  const sideLabel = unit === UNIT_DOTS ? "DOTS" : unit === UNIT_POINTS ? "PTS" : "NET";
  // ── A low-man nine has no total to state ─────────────────────────
  // Under low_man the strokes are the DIFFERENCE off the lowest playing
  // handicap in the match (see scoring.js, "Three settings decide every
  // stroke"), so a hole's net is a figure relative to one man rather than a
  // score. Per hole that is exactly right and it is what the match is
  // settled on — 4 against 4 is the hole, whoever the low man is. Added up,
  // it stops being that and starts looking like a number: the low man's
  // "net 39" is his gross, and the man off 15 posts a "net 33" that is not
  // what he shot, not what he would post off his own handicap, and not
  // comparable to anybody in another match.
  //
  // So the per-hole cells stay and the OUT / IN / TOTAL cells go blank. Not
  // a dash — a dash is what this card prints for a number it does not have
  // yet, and this is one that does not exist. The gross total is directly
  // above it in the same column and is the number a man is looking for.
  //
  // Dots and points are untouched: they ACCRUE, and their total is the whole
  // point of them. Full-handicap rounds are untouched too — Team Best Ball's
  // nets are real net scores and they sum to one.
  const netTotalStands = unit === UNIT_DOTS || unit === UNIT_POINTS
    || result.handicapMode !== HANDICAP_MODE_LOW_MAN;

  // ── A side's number, where the side is EIGHT MEN ──────────────────
  // Team Best Ball counts the best six (front) or seven (back) NETS on a
  // hole and adds them, so the side's number for a par 4 is somewhere around
  // 24 — a figure with no meaning anybody carries in their head, and one
  // that says nothing about whether the hole went well. Six nets adding to
  // 22 is the whole story and it is invisible in "22".
  //
  // So on that format the row reads TO PAR: the same number, measured
  // against what those six or seven balls were expected to make. `counting`
  // is the per-hole count the engine actually scored with (computeMatchResult
  // exposes it), never the director's setting — a hole where a side was a man
  // short counted fewer balls and its par has to follow.
  //
  // Every other format's side number is one ball, or dots, or points, and is
  // already the number people say out loud. Left alone.
  const counting = result.counting;
  const toPar = !!counting;
  const parFor = (h) => (counting?.[h] || 0) * (holePars[h] || 0);

  // ── Who the header names ──────────────────────────────────────────
  // The four men on the card, normally, because it is the only place they
  // are spelled out and it is the legend for the initials in the rows.
  //
  // A Team Best Ball match is EIGHT a side, and eight names against eight
  // wraps to four lines of a phone before a single hole is drawn — a header
  // that pushes the card it heads off the screen. It is technically the
  // match, and it is unreadable. The teams are what those sixteen are
  // playing as, the row colours already say which is which, and every man's
  // own row still carries his initials. So the two sides are named as
  // teams, and the legend job is given up on the one format where it could
  // not be done anyway.
  //
  // `getTeam` reads the LIVE team names (constants mutates them in place
  // when the director's overrides land), so this cannot print last year's.
  const bigSides = formatGroupsByTeam(format);
  const sideHeading = (tid) => (bigSides
    ? getTeam(tid).name
    : sideNames(match, tid, nameOf).join(" / "));
  // What the running row is counted in — a different question. Holes up on
  // a match round, the lead on the running total on a Total one, points
  // banked on a points-per-hole one.
  const runLabel = total ? "LEAD" : perHole ? "PTS" : "MATCH";

  const strokesFor = (pid, h) => result.strokeMaps?.[pid]?.[h] || 0;

  // A shared-ball side (scramble, pinehurst) plays one ball, so it gets one
  // PlayerRow for both partners instead of one each — same score, same
  // strokes, by construction (see App.jsx onTapScore). Grouped once here
  // rather than inside `nine()`, which runs twice (OUT and IN).
  const shared = formatIsSharedBall(format);
  // ── A FOURSOME's card, on a match bigger than one ─────────────────
  // Team Best Ball's match is eight a side across four tee times, and the
  // four men who walked together keep a card between them exactly like every
  // other foursome in the tournament. `foursome` is those four: the card is
  // cut to their rows and everything that COMPARES the two sides comes off
  // it — the side's number, the running MATCH line, the nines, the overall
  // in the header. None of that is theirs. The side's best six of eight is
  // an eight-man fact and it is read on the Leaderboard.
  //
  // What is left is what a foursome signs for: par, stroke index, and four
  // rows of gross with the strokes dotted on the holes they fall. Which is
  // also why this is safe on a sealed round without a single check — there
  // is nothing on it that compares anybody to anybody.
  const solo = foursome?.length ? foursome.filter(Boolean) : null;
  const inSolo = (pid) => !solo || solo.includes(pid);
  const cut = (groups) => groups.map(g => g.filter(inSolo)).filter(g => g.length);
  const teamAGroups = cut(shared ? [match.teamA] : match.teamA.map(pid => [pid]));
  const teamBGroups = cut(shared ? [match.teamB] : match.teamB.map(pid => [pid]));
  // One wave needs no heading naming it, and the wave labels are the MATCH's
  // waves — a card cut to one of them would print three headings with
  // nothing under them.
  const waveRows = solo ? null : waves;

  // ── The running line, computed once over all 18 ──
  // Same currency as the row that prints it, from A's perspective, and
  // undefined until the hole is complete for both sides.
  const running = [];
  {
    let m = 0, ra = 0, rb = 0;
    holes.forEach((h, i) => {
      if (total) {
        ra += h.aScore ?? 0; rb += h.bScore ?? 0;
        m = higherWins ? ra - rb : rb - ra;
      } else {
        const v = perHole ? (h.h < 9 ? result.holePoints.front : result.holePoints.back) : 1;
        if (h.winner === "A") m += v;
        else if (h.winner === "B") m -= v;
      }
      running[i] = h.played ? m : null;
    });
  }

  const overall = segmentState(holes, segOpts);
  const overallLeader = segmentLeader(overall);

  // ── The two nines, as matches in their own right ──────────────────
  // Computed once here and handed to `nine()` below rather than worked out
  // again inside it, so the NINES row and each block's own OUT / IN chip are
  // reading one answer. Same argument as the Leaderboard's, which shares its
  // per-nine state between the collapsed row's flanks and the expanded pills
  // for exactly this reason.
  const nineSt = [segmentState(holes.slice(0, 9), segOpts), segmentState(holes.slice(9, 18), segOpts)];

  // Where the 18-hole match closed out, if it did — off segmentState's own
  // `decided`, which is where that question is answered for every screen.
  // This row used to walk `running` and find the hole itself, and the two
  // readings were free to disagree: the header chip above prints
  // `statusText(overall)`, so a match this row stamped 8&6 could be titled
  // "10&4" three inches higher up. Only match play closes early — a Total
  // round is live until the last putt, and points are banked hole by hole
  // with nothing left pending — and `decided` is absent on both.
  const clinchHole = overall.decided ? overall.decided.at : null;
  const clinchText = overall.decided ? statusText(overall) : null;

  // ══════════════════════════════════════════════════════════════════
  //  The NINES row — a Nassau is three matches, and this names two of them
  // ══════════════════════════════════════════════════════════════════
  //  A Nassau round settles the front, the back and the eighteen, each for
  //  its own point. Until this row the card spelled out one of the three: the
  //  header states the OVERALL, and each nine's result was a chip in the
  //  corner of its MATCH row — FS.micro, labelled OUT and IN, sixteen rows
  //  down the card from the other two.
  //
  //  That is enough to read a nine off mid-round. It is not enough to SIGN,
  //  which is the one moment somebody is swearing to all three results at
  //  once, and it is the sign sheet this row was asked for. It lands on every
  //  standalone card rather than in the sheet alone, because the sheet, the
  //  signed panel and the mid-round Scorecard popup are the same card opened
  //  three ways, and a fact worth stating on one of them is worth stating on
  //  all three. See `showHeader` on the props.
  //
  //  WHICH NINES are matches comes from nassauSegmentVisibility — the same
  //  call the Leaderboard's collapsed row and the Scoring tab's status pills
  //  make, so a nine can never be a match on one screen and a stretch of
  //  holes on another. A Traditional round pays one pot for the eighteen and
  //  gets no row at all; a Nassau with a nine zeroed out gets the other one.
  //
  //  THE WORDS are the card's, not the Scoring tab's. Its pills read "3 DN"
  //  from the reader's own side; here a stated result names a winner and is
  //  painted in that winner's colour, which is the rule the rest of this file
  //  already follows (see the two-currencies note at the top) and the rule
  //  the header directly above this row is printed under. One card, one
  //  convention.
  //
  //  Nothing at all while the round is sealed. A segment result is precisely
  //  what the blackout is holding back, and `nassauBadges` on the Scoring tab
  //  is switched off by the same test.
  //
  //  A LEVEL nine reads TIED, and that word comes from statusText along
  //  with every other result on this card — see the note there. It is not a
  //  choice this file gets to make: the NINES row, the OUT / IN chips and the
  //  overall in the header are one fact stated three times, and the moment
  //  any of them owns its own wording they are free to disagree about tense.

  const nineCells = (showHeader && !conceal && !solo ? (() => {
    const { showFront, showBack } = nassauSegmentVisibility(match, result.holePoints);
    return [
      showFront ? { key: "f", label: "F9", st: nineSt[0] } : null,
      showBack ? { key: "b", label: "B9", st: nineSt[1] } : null,
    ].filter(Boolean);
  })() : []);

  // Two cells side by side, or one across the width when a round plays only
  // one of its nines as a match. Dashed while a nine is still live and solid
  // once it has settled — the live/settled language the Scoring tab's pills
  // and the Leaderboard's use, so a settled nine looks settled wherever it
  // is drawn.
  const NinesRow = nineCells.length > 0 && (
    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
      {nineCells.map(({ key, label, st }) => {
        const leader = segmentLeader(st);
        const col = leader ? teamColor(leader) : st.played ? BC.t2 : BC.t3;
        const settled = st.complete;
        return (
          <div key={key} style={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 6,
            padding: "4px 6px", borderRadius: 6,
            background: settled && leader ? `${col}${ALPHA.wash}` : "transparent",
            border: `1px ${settled ? "solid" : "dashed"} ${settled && leader ? `${col}${ALPHA.line}` : `${BC.bdr}${ALPHA.line}`}`,
          }}>
            <span style={{ fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.8, color: BC.t3 }}>{label}</span>
            <span style={{
              fontSize: FS.small, fontWeight: 800, whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis", color: col,
            }}>{statusText(st)}</span>
          </div>
        );
      })}
    </div>
  );

  // ── One nine ─────────────────────────────────────────────────────
  const nine = (start, label) => {
    const end = start + 9;
    const idx = Array.from({ length: 9 }, (_, i) => start + i);
    const parTotal = holePars.slice(start, end).reduce((a, b) => a + b, 0);
    // The back block is the one that totals eighteen holes; the front draws
    // the column and leaves it empty. See sumCell.
    const isBack = start === 9;
    const par18 = holePars.slice(0, 18).reduce((a, b) => a + b, 0);
    // This nine's own result — a real one, since the Nassau pays out on it.
    // From `nineSt` above, which the NINES row reads too.
    const seg = nineSt[start === 0 ? 0 : 1];
    const segLeader = segmentLeader(seg);

    // Every hole cell in every row shares this: equal width, hairline
    // between columns, none after the ninth.
    const holeCell = (i, h, extra) => ({
      flex: 1, minWidth: 0, height: h,
      display: "flex", alignItems: "center", justifyContent: "center",
      borderRight: i < 8 ? gridLine() : "none",
      ...extra,
    });

    // ── The band ──
    const HoleRow = (
      <div style={{ display: "flex", background: BC.amber, borderRadius: "8px 8px 0 0", overflow: "hidden" }}>
        <div style={labelCell(24, { color: ON_AMBER, opacity: 0.75, borderRight: "none", fontSize: FS.micro })}>HOLE</div>
        {idx.map((h, i) => (
          <div key={h} style={holeCell(i, 24, { borderRight: "none" })}>
            <span style={{ fontSize: FS.small, fontWeight: 800, color: ON_AMBER }}>{h + 1}</span>
          </div>
        ))}
        <div style={totCell(24, { borderLeft: "none" })}>
          <span style={{ fontSize: FS.micro, fontWeight: 800, color: ON_AMBER, letterSpacing: 0.5 }}>{label}</span>
        </div>
        {/* Headed on both blocks, because the heading is what says the empty
            column on the front is deliberate rather than a clipped one. */}
        <div style={sumCell(24, { borderLeft: "none" })}>
          <span style={{ fontSize: FS.micro, fontWeight: 800, color: ON_AMBER, letterSpacing: 0.5 }}>TOT</span>
        </div>
      </div>
    );

    const ParRow = (
      <div style={{ display: "flex", borderBottom: gridLine(), background: `${BC.amber}${ALPHA.wash}` }}>
        <div style={labelCell(20)}>PAR</div>
        {idx.map((h, i) => (
          <div key={h} style={holeCell(i, 20)}>
            <span style={{ fontSize: FS.label, fontWeight: 600, color: BC.t2 }}>{holePars[h]}</span>
          </div>
        ))}
        <div style={totCell(20)}><span style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3 }}>{parTotal}</span></div>
        <div style={sumCell(20)}>
          {isBack && <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3 }}>{par18}</span>}
        </div>
      </div>
    );

    // The stroke-index row. It earns its 18px: it is the only thing that
    // explains why the dots above a cell are where they are, and on a
    // low-man round it is what a player checks before pressing a match.
    const HcpRow = (
      <div style={{ display: "flex", borderBottom: gridLine(), background: BC.inp }}>
        <div style={labelCell(18)}>HCP</div>
        {idx.map((h, i) => (
          <div key={h} style={holeCell(i, 18)}>
            <span style={{ fontSize: FS.micro, fontWeight: 600, color: BC.t3 }}>{holeHcps[h]}</span>
          </div>
        ))}
        <div style={totCell(18)} />
        <div style={sumCell(18)} />
      </div>
    );

    // There is no team-name row above these blocks. It cost a line of a
    // phone per team per nine — four lines of a card that has to fit on a
    // screen — to say something the initials now say themselves: a player
    // row is printed in its team's color, the same color as that side's NET
    // row directly beneath it and the same one the names in the header are
    // in. Which side a row belongs to was never the question anyone had
    // while reading this; whose row it is, is.
    const PlayerRow = (pids, tid) => {
      const rowH = 30;
      const pid = pids[0];
      const combined = pids.length > 1;
      // ── One ball, one number ──
      // A shared-ball side's row is the SIDE's card, so it prints the ball the
      // engine scored (see scoring.sharedBallScore) rather than partner one's
      // own. Those are the same number whenever the two cards agree, which is
      // what the scoring screen writes — but when they don't, printing one
      // partner's gross above a net taken off the other's put a stroke on the
      // row that no dot above it accounted for.
      let gross = 0;
      const cells = idx.map((h) => {
        const s = combined
          ? (sharedBallScore(pids.map(p => getScore(p, h))) || 0)
          : getScore(pid, h);
        if (s > 0) gross += s;
        return { h, s, st: strokesFor(pid, h) };
      });
      // The eighteen, for the TOTAL column on the back block. Off the same
      // reader the nine's cells come from, so a shared-ball side's total is
      // the ball it played rather than one partner's own.
      let gross18 = 0;
      for (let h = 0; h < 18; h++) {
        const v = combined
          ? (sharedBallScore(pids.map(p => getScore(p, h))) || 0)
          : getScore(pid, h);
        if (v > 0) gross18 += v;
      }
      // The playing handicap — post-allowance, which is the number the dots
      // on this row were actually allocated from. On a shared-ball side that
      // is the team's summed-then-rounded figure (result.teamCH), never
      // either partner's own individually-rounded playingCH.
      const ch = combined ? result.teamCH?.[tid] : result.playingCH?.[pid];
      // ── The label, stacked ──
      // A shared-ball side is two men in a 42px column. Side by side —
      // "CB/ND" — they fit only at the grid's smallest type with the handicap
      // pushed onto a second line under them, which is three things in a
      // column and the busiest cell on a busy screen. Stacked, the initials
      // get a whole type rung back and the handicap moves out beside them,
      // where a singles row already carries it.
      const label = (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          {pids.map((p) => (
            <span key={p} style={{ fontSize: combined ? FS.label : FS.small, fontWeight: 800, color: teamColor(tid), lineHeight: 1.15 }}>
              {initials(nameOf(p))}
            </span>
          ))}
        </div>
      );
      return (
        <div key={pids.join("_")} style={{ display: "flex", alignItems: "center", borderBottom: gridLine() }}>
          <div style={labelCell(rowH, { gap: 3, color: BC.t1, paddingTop: combined ? 6 : 8 })}>
            {label}
            {ch != null && <span style={{ fontSize: FS.micro, fontWeight: 700, color: BC.hcpBlue }}>{ch}</span>}
          </div>
          {cells.map((c, i) => (
            <div key={c.h} style={holeCell(i, rowH)}>
              <ScoreCell score={c.s} par={holePars[c.h]} strokes={c.st} notation={false} />
            </div>
          ))}
          <div style={totCell(rowH, { paddingTop: 8 })}>
            <span style={{ fontSize: FS.small, fontWeight: 800, color: BC.t1 }}>{gross || ""}</span>
          </div>
          <div style={sumCell(rowH, { paddingTop: 8 })}>
            {isBack && <span style={{ fontSize: FS.small, fontWeight: 800, color: BC.t1 }}>{gross18 || ""}</span>}
          </div>
        </div>
      );
    };

    // What stands in for a side whose card is not on this sheet. One row,
    // where nine used to be: it says which side is missing and why, so the
    // card reads as half-withheld rather than as a match with one team in
    // it. Painted in the absent side's own colour, because that is the one
    // thing about them this card can still state.
    //
    // Two sentences, because there are two reasons to be missing and they owe
    // the reader different things. DURING the blackout it is the round nobody
    // is allowed to know, and the lock says wait. AFTER it the card is simply
    // not where that answer lives — this is the group's own card, on the
    // course — so it points at the screen that does have it rather than
    // leaving a reader wondering what is still being kept from them.
    const SealedSide = (tid) => (
      <div key={`sealed-${tid}`} style={{
        display: "flex", alignItems: "center", gap: 6, padding: "9px 8px",
        background: `${teamColor(tid)}${ALPHA.wash}`, borderRadius: 6,
      }}>
        {conceal && <span style={{ fontSize: FS.micro, opacity: 0.6 }} title="Sealed until the reveal">🔒</span>}
        <span style={{ fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.4, color: teamColor(tid) }}>
          {conceal ? "SEALED UNTIL THE REVEAL" : hiddenNote}
        </span>
      </div>
    );

    // The tee time a wave went off on, over the four men who went off on it.
    // A label and a rule rather than a full row of its own: it is a heading
    // for the rows under it, not a line of the card, and the grid below has
    // to stay the only thing with columns in it.
    const WaveLabel = (tid, w) => (
      <div key={`wave-${tid}-${w.key}`} style={{
        display: "flex", alignItems: "center", gap: 6, padding: "7px 6px 3px",
      }}>
        <span style={{
          fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.8,
          color: teamColor(tid), opacity: 0.8, whiteSpace: "nowrap",
        }}>{w.label}</span>
        <span style={{ flex: 1, height: 1, background: `${BC.bdr}${ALPHA.line}` }} />
      </div>
    );

    // One side's player rows, grouped into the waves they went off in when
    // there is more than one. Each wave's men come off the MATCH's own roster
    // order filtered to that wave — the same expression the Scoring tab draws
    // its cards from — so the two screens cannot put the same four men in two
    // different orders.
    //
    // A shared-ball side is left alone: its "rows" are already one per side
    // rather than one per man, and that format's match never spans a wave.
    const PlayerRows = (tid, groups) => {
      if (!waveRows?.length || shared) return groups.map((pids) => PlayerRow(pids, tid));
      const roster = tid === "A" ? match.teamA : match.teamB;
      const out = [];
      const drawn = new Set();
      waveRows.forEach((w) => {
        const set = new Set(w.pids || []);
        const mine = roster.filter((pid) => set.has(pid));
        if (!mine.length) return;
        out.push(WaveLabel(tid, w));
        mine.forEach((pid) => { drawn.add(pid); out.push(PlayerRow([pid], tid)); });
      });
      // Anybody the draw missed still gets his row rather than falling off the
      // card — the same call scoringUnits makes for an ungrouped player.
      const left = roster.filter((pid) => !drawn.has(pid));
      if (left.length) {
        out.push(WaveLabel(tid, { key: "none", label: "NOT ON THE TEE SHEET" }));
        left.forEach((pid) => out.push(PlayerRow([pid], tid)));
      }
      return out;
    };

    // The side's number for each hole — net strokes, dots or points, per
    // the format. Read straight off result.holes: this row is the match,
    // and nothing about it is worked out here.
    const SideRow = (tid) => {
      const rowH = 26;
      const col = teamColor(tid);
      const key = tid === "A" ? "aScore" : "bScore";
      // The other side's row is the round, so it stops at the reveal. Your
      // own keeps going: a team is never hidden from itself.
      const hidden = (h) => sealedHole(h) && tid !== mySide;
      // What the row prints for a hole: the side's raw number, or how that
      // number stands against the par of the balls it counted. See `toPar`.
      const at = (h) => {
        const v = holes[h]?.[key];
        if (v == null) return null;
        return toPar ? v - parFor(h) : v;
      };
      let sum = 0, allIn = true;
      idx.forEach((h) => {
        const v = hidden(h) ? null : at(h);
        if (v == null) allIn = false; else sum += v;
      });
      // The eighteen. Its own `allIn`, because a card can have a complete
      // nine and an incomplete card.
      let sum18 = 0, allIn18 = true;
      for (let h = 0; h < 18; h++) {
        const v = (sealedHole(h) && tid !== mySide) ? null : at(h);
        if (v == null) allIn18 = false; else sum18 += v;
      }
      // A to-par row reads in the app's own score vocabulary — E, +2, −3 —
      // where a raw side number is just a number. `0` is E, and an empty
      // cell is still empty.
      const show = (v) => (v == null ? null : toPar ? fmtScore(v) : v);
      return (
        <div style={{ display: "flex", alignItems: "center", background: `${col}${ALPHA.wash}` }}>
          <div style={labelCell(rowH, { color: col })}>{sideLabel}</div>
          {idx.map((h, i) => {
            const hr = holes[h];
            const v = hidden(h) ? null : show(at(h));
            // Who took the hole is a comparison, so it goes dark for BOTH
            // sides — a mark left on your own row would say the other side
            // lost it, which is the same leak the other way round.
            const won = hr?.winner === tid && !sealedHole(h);
            return (
              <div key={h} style={holeCell(i, rowH)}>
                {hidden(h) ? (
                  <span style={{ fontSize: FS.micro, opacity: 0.5 }} title="Sealed until the reveal">🔒</span>
                ) : won ? (
                  // ── The box on this card ──
                  // A boxed number means the side TOOK the hole, and it is now
                  // the only boxed number on the card — see "The box, and what
                  // it costs" at the top of this file. Team-coloured, because a
                  // hole belongs to a team.
                  <div style={{
                    minWidth: 20, height: 20, padding: "0 3px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 4, border: `1.5px solid ${col}`, background: `${col}${ALPHA.tint}`,
                  }}>
                    <span style={{ fontSize: FS.small, fontWeight: 800, color: BC.t1 }}>{v}</span>
                  </div>
                ) : (
                  <span style={{ fontSize: FS.small, fontWeight: 800, color: v == null ? `${BC.t3}${ALPHA.hair}` : BC.t2 }}>
                    {v == null ? "·" : v}
                  </span>
                )}
              </div>
            );
          })}
          <div style={totCell(rowH)}>
            {/* A nine with a sealed hole in it has no total to state on the
                other side — printing the revealed part would read as the
                whole nine and hand over a comparison that isn't out yet. And
                a low-man nine has none at all; see netTotalStands. */}
            {hidden(end - 1) || hidden(start)
              ? <span style={{ fontSize: FS.micro, opacity: 0.5 }}>🔒</span>
              : netTotalStands
                ? <span style={{ fontSize: FS.small, fontWeight: 800, color: col }}>{allIn || sum ? show(sum) : ""}</span>
                : null}
          </div>
          <div style={sumCell(rowH)}>
            {isBack && netTotalStands && !hidden(17) && !hidden(0) && (allIn18 || sum18)
              ? <span style={{ fontSize: FS.small, fontWeight: 800, color: col }}>{show(sum18)}</span>
              : null}
          </div>
        </div>
      );
    };

    // Where the match stood walking off each green, from the READER's side
    // — ▲ ahead, ▼ behind — and, on the nine it happened, the hole it was
    // won on. The OUT / IN cell carries this nine's own state, which is a
    // pot in its own right on a Nassau, so it is a stated result and goes
    // back to the winner's team color.
    const MatchRow = (
      <div style={{
        display: "flex", alignItems: "center", margin: "5px 0 0",
        background: BC.card, border: `1px solid ${BC.bdr}${ALPHA.line}`, borderRadius: 6,
      }}>
        <div style={labelCell(26, { borderRight: "none", color: BC.t2 })}>{runLabel}</div>
        {idx.map((h, i) => {
          const v = running[h];
          // The running line IS the result, so it is the first thing a
          // sealed hole takes away — before the clinch check below, which
          // would otherwise announce a finish nobody has been shown.
          if (sealedHole(h)) return (
            <div key={h} title="Sealed until the reveal" style={holeCell(i, 26)}>
              <span style={{ fontSize: FS.micro, opacity: 0.5 }}>🔒</span>
            </div>
          );
          // Past the clinch there is nothing to say — the match was over.
          if (clinchHole != null && h > clinchHole) return <div key={h} style={holeCell(i, 26)} />;
          if (clinchHole === h) {
            // Boxed for the same reason the won-hole cell is: this IS a hole a
            // team took, the last one they needed.
            const col = teamColor(overall.decided.margin > 0 ? "A" : "B");
            return (
              <div key={h} style={holeCell(i, 26)}>
                <div style={{ border: `1.5px solid ${col}`, borderRadius: 4, padding: "0 3px", lineHeight: "18px", maxWidth: "100%" }}>
                  <span style={{ fontSize: FS.label, fontWeight: 800, color: col, whiteSpace: "nowrap" }}>{clinchText}</span>
                </div>
              </div>
            );
          }
          if (v == null) {
            // Some of the four are in but not all: the hole has no result
            // yet and the scorer is the one who can fix that.
            const partial = [...match.teamA, ...match.teamB].some((pid) => getScore(pid, h) > 0);
            return (
              <div key={h} title={partial ? "Missing score" : undefined} style={holeCell(i, 26)}>
                {partial && <span style={{ fontSize: FS.label, opacity: 0.55 }}>⚠️</span>}
              </div>
            );
          }
          // ── The arrow is the reader's, the colour is the leader's ──
          // Flipped to the reader's own side, so ▲ always means "we are up".
          // That much a colour was never needed for, and a colour was the
          // wrong thing to try it with: green/red here answered "is this good
          // news for me", and `viewer` is `userTeam`, which falls back to a
          // reader's ROSTER team when he is not in the match. A director
          // opening somebody else's card got a red ▼ under a match he has no
          // side in, naming a loser who was nobody.
          //
          // Team colour answers "who", which is a question this row can
          // always answer, and it is the same currency the NET row's boxed
          // hole and the clinch stamp beside it are already drawn in. It is
          // also what the Scoring tab's own status strip behind this popup
          // switched to (App.jsx renderStatusCell) — this row was the last
          // green/red match state left in the app.
          const mine = viewer === "A" ? v : -v;
          const col = v > 0 ? teamColor("A") : v < 0 ? teamColor("B") : BC.t3;
          return (
            <div key={h} style={holeCell(i, 26)}>
              <span style={{ fontSize: FS.small, fontWeight: 800, color: col }}>
                {/* TIED, on every format — the word this app uses for level
                    wherever it says it, and the word in the next cell along.
                    This one is the match as it stood walking off a green, so
                    the currency changes and the fact does not. */}
                {mine === 0
                  ? <span style={{ fontSize: FS.micro, letterSpacing: 0.5 }}>TIED</span>
                  : <>{mine > 0 ? "▲" : "▼"}{Math.abs(mine)}</>}
              </span>
            </div>
          );
        })}
        {/* The nine's own result. A chip rather than a bare number, so it
            reads as this block's summary and not as a tenth hole. */}
        <div style={totCell(26, { borderLeft: "none" })}>
          {sealedNine(start) ? (
            <span style={{ fontSize: FS.micro, opacity: 0.5 }} title="Sealed until the reveal">🔒</span>
          ) : (
            <span style={{
              fontSize: FS.micro, fontWeight: 800, whiteSpace: "nowrap",
              padding: "2px 3px", borderRadius: 4,
              color: segLeader ? teamColor(segLeader) : BC.t3,
              background: segLeader ? `${teamColor(segLeader)}${ALPHA.wash}` : "transparent",
              border: `1px solid ${segLeader ? `${teamColor(segLeader)}${ALPHA.line}` : "transparent"}`,
            }}>{statusText(seg)}</span>
          )}
        </div>
        {/* Deliberately empty, on both blocks. The eighteen-hole verdict is
            the header's, three inches up and in words; a second copy of it
            here would be the same fact twice on one card. The cell is drawn
            so the row keeps the grid's column count. */}
        <div style={sumCell(26, { borderLeft: "none" })} />
      </div>
    );

    return (
      <div key={label} style={{ marginBottom: 12 }}>
        {HoleRow}
        {ParRow}
        {HcpRow}
        {/* Each side is its rows or, when its card is not this reader's to
            see, the one line that says so. Written as a block per side
            rather than "hide team B" because the reader is on either side of
            this card, and it is always the OTHER one that goes. */}
        {solo ? <>
          {PlayerRows("A", teamAGroups)}
          {PlayerRows("B", teamBGroups)}
        </> : <>
          {hiddenSide("A") ? SealedSide("A") : <>
            {PlayerRows("A", teamAGroups)}
            {SideRow("A")}
          </>}
          {!hiddenMatch && MatchRow}
          {/* The MATCH row is a floating chip; without a team label under it
              Team B's first row would butt straight into its border. */}
          <div style={{ marginTop: 5 }}>
            {hiddenSide("B") ? SealedSide("B") : <>
              {PlayerRows("B", teamBGroups)}
              {SideRow("B")}
            </>}
          </div>
        </>}
      </div>
    );
  };

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Who, and where it stands. This is also the legend for the initials
          in the rows below — the only place the four names are spelled out.
          The status between them is the OVERALL match; each nine carries
          its own at the end of its MATCH row. */}
      {/* Wraps rather than truncates: a half-printed name is no legend at
          all, and this is the only place the four are spelled out. */}
      {/* A foursome's card has no two sides to put a result between, so the
          header is the four names and nothing else — still the legend for
          the initials below, which is the job it was doing anyway. Drawn in
          their own side's colour: they are all on it. */}
      {showHeader && solo && (
        <div style={{
          fontSize: FS.label, fontWeight: 800, lineHeight: 1.3, marginBottom: 4,
          color: teamColor(match.teamA.includes(solo[0]) ? "A" : "B"),
        }}>
          {solo.map(nameOf).join(" / ")}
        </div>
      )}
      {showHeader && !solo && <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: FS.label, fontWeight: 800, lineHeight: 1.3, color: BC.teamA }}>
          {sideHeading("A")}
        </span>
        <span style={{
          flexShrink: 0, fontSize: FS.small, fontWeight: 800,
          color: conceal ? BC.amberInk : overallLeader ? teamColor(overallLeader) : BC.t3,
        }}>{conceal ? "🔒 SEALED" : statusText(overall)}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: FS.label, fontWeight: 800, lineHeight: 1.3, color: BC.teamB, textAlign: "right" }}>
          {sideHeading("B")}
        </span>
      </div>}

      {NinesRow}

      {nine(0, "OUT")}
      {nine(9, "IN")}
    </div>
  );
}
