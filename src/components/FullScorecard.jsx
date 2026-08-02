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
//    • GOLF NOTATION. A circled 3 and a squared 6 are read at a glance,
//      by everyone who has ever held a scorecard. Nothing else in this
//      app says "you birdied the 4th" without the reader doing
//      arithmetic against the PAR row.
//    • STROKE DOTS on the cell that gets them, not in a legend. The dots
//      come from result.strokeMaps — the same allocation the match was
//      scored with — so the card cannot show a stroke the engine didn't
//      give.
//    • ONE ROW PER PLAYER, initials in their team's color, with the
//      side's scoring row directly beneath. How the side's number was
//      made is then visible rather than asserted.
//
//  Bourbon Cup differences from MNQ, all of them forced by this app
//  having formats MNQ does not:
//
//    • Two nines, not one. Each is its own block, and each block's OUT /
//      IN cell carries that nine's segment state — which is a real
//      result here, because the Nassau pays out on it.
//    • The side's row is not always net strokes. It is whatever the
//      hole was SCORED in (scoring.js holeFormatFor) — net strokes for
//      most formats, dots on Double Dot, points on Stableford and Tilt —
//      and the row is labelled for it. Its numbers come straight off
//      result.holes, so this card cannot disagree with the leaderboard.
//    • Team colors instead of MNQ's single accent, and no
//      your-team-on-top swap: Team A stays on top, in the same order as
//      the player cards on the screen behind this popup.
//    • Two currencies of color, the split the Scoring tab's status strip
//      already draws (see App.jsx, renderStatusCell): a HOLE belongs to a
//      team and is painted in that team's color; the RUNNING MATCH belongs
//      to the reader and is painted green/red from their own side's point
//      of view. A stated result — the overall status, a nine's status, a
//      clinch — is team-colored again, because it names a winner.
//
//  Everything here is presentational. Every number is either a gross
//  score the group entered or something computeMatchResult already
//  worked out.
// ══════════════════════════════════════════════════════════════════

import { BC, FONT, ALPHA, FS, ON_AMBER, teamColor } from "../theme";
import {
  FORMATS, HOLE_METHOD_LABELS, UNIT_DOTS, UNIT_POINTS,
  describeHolePoints, isPointsPerHole, resolveScoring, SCORING_TYPE_TOTAL,
} from "../constants";
import {
  higherIsBetter, totalUnit, holeFormatFor,
  segmentState, statusText, segmentLeader, segmentOptsFor,
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
export function ScoreCell({ score, par, strokes = 0, size = CELL, color, skin = false }) {
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

  let border = null;
  if (diff <= -2) {
    border = (
      <div style={{ ...ring, width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 6, height: sh - 6, borderRadius: "50%", border: `1px solid ${bc}` }} />
      </div>
    );
  } else if (diff === -1) {
    border = <div style={{ ...ring, width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}` }} />;
  } else if (diff === 1) {
    border = <div style={{ ...ring, width: sh, height: sh, borderRadius: 3, border: `1.5px solid ${bc}` }} />;
  } else if (diff >= 2) {
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
        {skin && <div style={{ position: "absolute", inset: -1, borderRadius: 4, background: BC.amber }} />}
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
//    showHeader             — the names-and-status line. On by default: in
//                             the Scoring popup it is the only place the
//                             four players are spelled out, so the initials
//                             in the rows below have nothing else to read
//                             against. The Leaderboard turns it off — its
//                             match row names the pair and states the match
//                             directly above this, and its segment pills
//                             say it a third time.
//    conceal                — { through, side } on a SEALED round, null on
//                             every other one. See lib/reveal.js. Past hole
//                             `through` this card stops printing anything
//                             that COMPARES the two sides — the other side's
//                             row, the hole-won marks, the running line, the
//                             nine's result — and keeps everything that is
//                             just a card: the gross scores the group is
//                             writing down, and `side`'s own numbers.
//
//                             It has to work that way rather than by hiding
//                             the data, because the group holding this phone
//                             is entering two of the four cards on it. What
//                             the blackout owes them is not their opponents'
//                             scores back; it is what those scores ADD UP TO,
//                             which is the round nobody is allowed to know.
export function FullScorecard({
  match, result, format, holePars, holeHcps, course, tPlayers, getScore,
  viewer = "A", showHeader = true, conceal = null,
}) {
  if (!result) return null;

  // One question, asked in six places below. `conceal.through` is a count of
  // holes, `h` a 0-based index, so hole `through` is the first sealed one.
  const sealedHole = (h) => !!conceal && h >= conceal.through;
  // A nine only states a result once every hole in it is out.
  const sealedNine = (start) => sealedHole(start + 8);
  const mySide = conceal?.side === "B" ? "B" : "A";

  const { formOfPlay } = resolveScoring(match);
  const total = formOfPlay === SCORING_TYPE_TOTAL;
  const perHole = isPointsPerHole(match.scoring_type);
  // What the holes were actually scored under — a best-ball override makes
  // them net strokes whatever the round is called, and everything below
  // (direction, row label, notation) has to follow the method, not the name.
  const scoredFormat = holeFormatFor(match, format);
  const methodNamed = scoredFormat !== format ? (HOLE_METHOD_LABELS[scoredFormat] || null) : null;
  const higherWins = higherIsBetter(scoredFormat);
  const unit = totalUnit(scoredFormat);
  const holes = result.holes;
  const segOpts = segmentOptsFor({ ...match, hole_points: result.holePoints }, format);

  // What the side's row is counted in. Named for the currency rather than
  // the format, because that is what the numbers in it are.
  const sideLabel = unit === UNIT_DOTS ? "DOTS" : unit === UNIT_POINTS ? "PTS" : "NET";
  // What the running row is counted in — a different question. Holes up on
  // a match round, the lead on the running total on a Total one, points
  // banked on a points-per-hole one.
  const runLabel = total ? "LEAD" : perHole ? "PTS" : "MATCH";

  const strokesFor = (pid, h) => result.strokeMaps?.[pid]?.[h] || 0;
  const nameOf = (pid) => tPlayers.find((p) => p.player_id === pid)?.name || pid;

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

  // Where the 18-hole match closed out, if it did. Only match play closes
  // early: a Total round is live until the last putt, and points are banked
  // hole by hole with nothing left pending. The lead has to be bigger than
  // the holes still to play, which is the same test segmentState applies to
  // the overall segment — this only locates the hole it happened on.
  let clinchHole = null, clinchText = null;
  if (!total && !perHole) {
    for (let i = 0; i < 18; i++) {
      if (running[i] == null) continue;
      const lead = Math.abs(running[i]);
      const rem = 17 - i;
      if (lead > rem) {
        clinchHole = i;
        clinchText = rem > 0 ? `${lead}&${rem}` : `${lead} UP`;
        break;
      }
    }
  }

  const overall = segmentState(holes, segOpts);
  const overallLeader = segmentLeader(overall);

  // ── One nine ─────────────────────────────────────────────────────
  const nine = (start, label) => {
    const end = start + 9;
    const idx = Array.from({ length: 9 }, (_, i) => start + i);
    const parTotal = holePars.slice(start, end).reduce((a, b) => a + b, 0);
    // This nine's own result — a real one, since the Nassau pays out on it.
    const seg = segmentState(holes.slice(start, end), segOpts);
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
      </div>
    );

    // There is no team-name row above these blocks. It cost a line of a
    // phone per team per nine — four lines of a card that has to fit on a
    // screen — to say something the initials now say themselves: a player
    // row is printed in its team's color, the same color as that side's NET
    // row directly beneath it and the same one the names in the header are
    // in. Which side a row belongs to was never the question anyone had
    // while reading this; whose row it is, is.
    const PlayerRow = (pid, tid) => {
      const rowH = 30;
      let gross = 0;
      const cells = idx.map((h) => {
        const s = getScore(pid, h);
        if (s > 0) gross += s;
        return { h, s, st: strokesFor(pid, h) };
      });
      // The playing handicap — post-allowance, which is the number the dots
      // on this row were actually allocated from.
      const ch = result.playingCH?.[pid];
      return (
        <div key={pid} style={{ display: "flex", alignItems: "center", borderBottom: gridLine() }}>
          <div style={labelCell(rowH, { gap: 3, color: BC.t1, paddingTop: 8 })}>
            <span style={{ fontSize: FS.small, fontWeight: 800, color: teamColor(tid) }}>{initials(nameOf(pid))}</span>
            {ch != null && <span style={{ fontSize: FS.micro, fontWeight: 700, color: BC.hcpBlue }}>{ch}</span>}
          </div>
          {cells.map((c, i) => (
            <div key={c.h} style={holeCell(i, rowH)}>
              <ScoreCell score={c.s} par={holePars[c.h]} strokes={c.st} />
            </div>
          ))}
          <div style={totCell(rowH, { paddingTop: 8 })}>
            <span style={{ fontSize: FS.small, fontWeight: 800, color: BC.t1 }}>{gross || ""}</span>
          </div>
        </div>
      );
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
      let sum = 0, allIn = true;
      idx.forEach((h) => {
        const v = hidden(h) ? null : holes[h]?.[key];
        if (v == null) allIn = false; else sum += v;
      });
      return (
        <div style={{ display: "flex", alignItems: "center", background: `${col}${ALPHA.wash}` }}>
          <div style={labelCell(rowH, { color: col })}>{sideLabel}</div>
          {idx.map((h, i) => {
            const hr = holes[h];
            const v = hidden(h) ? null : hr?.[key];
            // Who took the hole is a comparison, so it goes dark for BOTH
            // sides — a mark left on your own row would say the other side
            // lost it, which is the same leak the other way round.
            const won = hr?.winner === tid && !sealedHole(h);
            return (
              <div key={h} style={holeCell(i, rowH)}>
                {hidden(h) ? (
                  <span style={{ fontSize: FS.micro, opacity: 0.5 }} title="Sealed until the reveal">🔒</span>
                ) : won ? (
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
                whole nine and hand over a comparison that isn't out yet. */}
            {hidden(end - 1) || hidden(start)
              ? <span style={{ fontSize: FS.micro, opacity: 0.5 }}>🔒</span>
              : <span style={{ fontSize: FS.small, fontWeight: 800, color: col }}>{allIn || sum ? sum : ""}</span>}
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
            const col = teamColor(running[h] > 0 ? "A" : "B");
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
          // Flipped to the reader's own side, so ▲ always means "we are up".
          const mine = viewer === "A" ? v : -v;
          const col = mine > 0 ? BC.green : mine < 0 ? BC.danger : BC.t3;
          const signed = total || perHole;
          return (
            <div key={h} style={holeCell(i, 26)}>
              <span style={{ fontSize: FS.small, fontWeight: 800, color: col }}>
                {mine === 0
                  ? <span style={{ fontSize: FS.micro, letterSpacing: 0.5 }}>{signed ? "TIED" : "AS"}</span>
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
      </div>
    );

    return (
      <div key={label} style={{ marginBottom: 12 }}>
        {HoleRow}
        {ParRow}
        {HcpRow}
        {match.teamA.map((pid) => PlayerRow(pid, "A"))}
        {SideRow("A")}
        {MatchRow}
        {/* The MATCH row is a floating chip; without a team label under it
            Team B's first row would butt straight into its border. */}
        <div style={{ marginTop: 5 }}>
          {match.teamB.map((pid) => PlayerRow(pid, "B"))}
          {SideRow("B")}
        </div>
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
      {showHeader && <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: FS.label, fontWeight: 800, lineHeight: 1.3, color: BC.teamA }}>
          {(match.teamANames || []).join(" / ")}
        </span>
        <span style={{
          flexShrink: 0, fontSize: FS.small, fontWeight: 800,
          color: conceal ? BC.amberInk : overallLeader ? teamColor(overallLeader) : BC.t3,
        }}>{conceal ? "🔒 SEALED" : statusText(overall)}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: FS.label, fontWeight: 800, lineHeight: 1.3, color: BC.teamB, textAlign: "right" }}>
          {(match.teamBNames || []).join(" / ")}
        </span>
      </div>}

      {/* The terms, in the order the round is scored: where, what the
          format is, how a hole is made, how the holes settle. */}
      <div style={{ fontSize: FS.micro, color: BC.t3, letterSpacing: 0.4, marginBottom: 10, lineHeight: 1.5 }}>
        {[
          course?.name,
          FORMATS.find((f) => f.id === format)?.label,
          methodNamed,
          higherWins ? unit : "net scores",
          perHole ? describeHolePoints(result.holePoints) : total ? `total ${unit}` : "match play",
        ].filter(Boolean).join(" · ")}
      </div>

      {nine(0, "OUT")}
      {nine(9, "IN")}
    </div>
  );
}
