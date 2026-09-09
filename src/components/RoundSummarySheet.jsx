// ══════════════════════════════════════════════════════════════════
//  RoundSummarySheet — what one round decided, on one screen.
// ══════════════════════════════════════════════════════════════════
//
// Where a tapped round-final notification lands. The push says "Round 3 is
// final" and names the pins, because a notification body holds about a line
// and a half (see functions/ctpNotice.js); this is the rest of the answer.
//
// It exists because the round's result was spread across three screens and
// none of them asked the question. The Leaderboard has the matches and the
// points but nothing about the money; the Betting tab has the four side games
// but organised by GAME across the whole week, so "what did Round 3 do" meant
// four sections and four round toggles. A man who has just been told a round
// is final wants the round, not the tournament.
//
// Read-only, and every number in it comes from lib/roundSummary — which is to
// say from the same builders the Leaderboard and the Betting tab read. This
// file draws; it does not decide. A summary that computed its own skins would
// eventually disagree with the tab the men are settling out of.
//
// Reachable two ways: the notification, and the chip on each round's header
// on the Leaderboard. Nothing here needs the round to be final — a round in
// play summarises fine and says THRU rather than a result — but the push is
// what most opens it, so it reads as a round that is over.
import { Fragment, useMemo } from "react";
import { Popup } from "./Popup";
import { roundSummary } from "../lib/roundSummary";
import { formatLabel } from "../constants";
import { BC, ALPHA, ON_AMBER, FS, R, teamColor } from "../theme";

// The all-caps eyebrow every section card is led by. Spelled once so five
// sections cannot drift apart by a letter of tracking.
const Label = ({ children, note }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
    <span style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1.2 }}>{children}</span>
    {note && <span style={{ fontSize: FS.micro, color: BC.t3, opacity: 0.8, letterSpacing: 0.3 }}>{note}</span>}
  </div>
);

// A section is always drawn, even with nothing in it. A card that disappears
// when a game had no winner reads as a screen that failed to load, and "every
// hole carried" is a real thing to know about a round.
const Card = ({ label, note, empty, children, rows }) => (
  <div style={{
    background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: R.xl,
    padding: "9px 11px", marginBottom: 8,
  }}>
    <Label note={note}>{label}</Label>
    {rows === 0
      ? <div style={{ fontSize: FS.small, color: BC.t3 }}>{empty}</div>
      : children}
  </div>
);

// One line of a game's result: who, and what they did. Low net and the money
// hole are lists of NAMES against one number each, which is the one shape on
// this sheet a plain row still suits — the pins and the skins have three and
// four facts a row and are laid out for that below.
const WinRow = ({ name, detail }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 0" }}>
    <span style={{
      flex: 1, minWidth: 0, fontSize: FS.small, fontWeight: 700, color: BC.t1,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>{name}</span>
    {detail && (
      <span style={{ flexShrink: 0, fontSize: FS.label, fontWeight: 700, color: BC.t3 }}>{detail}</span>
    )}
  </div>
);

// ── One side of a match, the Leaderboard's way ──────────────────────
// Borrowed geometry rather than re-invented: the pair stacks on its own side
// of the row with the team's colour as a rail on the OUTER edge, so the two
// rails bracket the result sitting between them. Team A is the left column in
// every match of every round on the board, and now here too — which is what
// lets a man find himself without re-answering "which side am I reading?" on
// each row. It also halves what the old layout spent: two names across a
// column instead of two teams down a row, and the result beside them rather
// than in a third column of its own.
//
// The losing side goes grey. That is the whole result signal in the names —
// no tint, no pill — exactly as the board draws it.
const MatchSide = ({ tid, names, winner }) => {
  const left = tid === "A";
  const lost = winner != null && winner !== tid;
  return (
    <div style={{
      minWidth: 0, display: "flex", flexDirection: "column", gap: 1,
      textAlign: left ? "left" : "right",
      ...(left
        ? { borderLeft: `3px solid ${teamColor(tid)}`, paddingLeft: 7 }
        : { borderRight: `3px solid ${teamColor(tid)}`, paddingRight: 7 }),
    }}>
      {names.map((nm, i) => (
        <div key={i} style={{
          fontSize: FS.small, fontWeight: winner === tid ? 800 : 700,
          color: lost ? BC.t3 : BC.t1, lineHeight: 1.25,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{nm}</div>
      ))}
    </div>
  );
};

// ── A tagged pin, as a tile ─────────────────────────────────────────
// A course has four par 3s, so the pins are a fixed little set rather than a
// list of unknown length — and four tiles across one row say that at a glance
// in the height one stacked row used to take. Hole, name, distance, top to
// bottom, because the hole is what a man looks for first and the name is what
// he is looking for it about.
const CtpTile = ({ ctp }) => (
  <div style={{
    minWidth: 0, textAlign: "center", borderRadius: R.md,
    background: BC.amber + ALPHA.wash, border: `1px solid ${BC.amber}${ALPHA.hair}`,
    padding: "5px 3px 6px",
  }}>
    <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.amberInk, letterSpacing: 0.3, lineHeight: 1.2 }}>
      #{ctp.hole + 1}
    </div>
    <div style={{
      fontSize: FS.small, fontWeight: 800, color: BC.t1, lineHeight: 1.25, marginTop: 1,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>{ctp.name}</div>
    <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, lineHeight: 1.2, marginTop: 1 }}>
      {ctp.distanceFt == null ? "—" : `${ctp.distanceFt} FT`}
    </div>
  </div>
);

// ── The skins, as a real grid ───────────────────────────────────────
// One grid per list rather than a row component per skin, because columns
// only line up when the cells share ONE container: `auto` sizes a column to
// the widest cell IN THE GRID, so BIRDIE and PAR start at the same x and #1
// sits under #16 without anybody measuring anything. As a flex row per skin
// each row sized itself, and every name of a different length nudged that
// row's result and hole somewhere new — a list that was legible one line at
// a time and a mess read down.
//
// The name column is `minmax(0, max-content)` and the rest are `auto`, which
// is what packs the four to the LEFT as a table instead of stranding the
// result out at the right edge with a gulf of card between it and the man it
// belongs to. It is also the only track with a min of 0, so when a name is
// too long for the row it is the one that gives up its tail — the holes and
// the pars hold their columns and the row still reads down.
//
// ── There is no score column, and that is deliberate ────────────────
// It read "3 GROSS" and "3 GROSS · 2 NET" out to the right. On the GROSS list
// that was the same fact twice on every row — a birdie on a par 4 IS a three,
// and the row already says birdie and says par 4. The NET list is the real
// trade: the net score is genuinely gone, and what is left says WHAT HE MADE
// rather than what it netted to. Which shot won the skin is the thing being
// read here; what it settles for is the Betting tab's, as the footnote below
// these cards has always said.
const SKINS_GRID = {
  display: "grid",
  gridTemplateColumns: "minmax(0, max-content) auto auto 1fr",
  columnGap: 8, rowGap: 5, alignItems: "baseline",
};
const SKIN_NAME = {
  minWidth: 0, fontSize: FS.small, fontWeight: 700, color: BC.t1,
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const SKIN_RESULT = { fontSize: FS.label, fontWeight: 800, color: BC.amberInk, whiteSpace: "nowrap" };
// Right-aligned so #7 lines up under #16 on its digits rather than on its
// hash, which is the only thing a column of hole numbers is for.
const SKIN_HOLE = { fontSize: FS.label, color: BC.t3, whiteSpace: "nowrap", textAlign: "right" };
const SKIN_PAR = { fontSize: FS.label, color: BC.t3, whiteSpace: "nowrap" };

const SkinsGrid = ({ skins }) => (
  <div style={SKINS_GRID}>
    {skins.map((k) => (
      <Fragment key={k.hole}>
        <span style={SKIN_NAME}>{k.name}</span>
        <span style={SKIN_RESULT}>{k.result}</span>
        <span style={SKIN_HOLE}>#{k.hole + 1}</span>
        <span style={SKIN_PAR}>PAR {k.par}</span>
      </Fragment>
    ))}
  </div>
);

export function RoundSummarySheet({
  round, onClose,
  matches, holeData, tPlayers, tRounds, courses, roundLocks, ctpData, buyIns,
  hcpOverrides, teeAssignments, teamNames,
}) {
  // Scored once when the sheet opens rather than on every render. A round is
  // four to eight matches through the engine, which is cheap — but it is not
  // free, and a popup redrawing on a parent's subscription tick would pay it
  // again each time a phone somewhere posts a hole.
  const s = useMemo(() => roundSummary({
    round, matches, holeData, tPlayers, tRounds, courses, roundLocks,
    ctpData, buyIns, hcpOverrides, teeAssignments, teamNames,
  }), [round, matches, holeData, tPlayers, tRounds, courses, roundLocks,
    ctpData, buyIns, hcpOverrides, teeAssignments, teamNames]);

  return (
    <Popup
      onClose={onClose}
      maxWidth={440}
      padding={0}
      outerPadding={16}
      portal
      // ── A frame with a scrolling middle, not one long scroll ───────
      // Popup carries display/flexDirection through to its scroller, which is
      // what lets the three pieces below split it: the header and the team
      // score are pinned, the sections travel underneath them, and Close sits
      // on the bottom edge. One round is comfortably twice a phone's height —
      // four matches, a pin, two skins lists, low net and the money hole — so
      // as one scroll it opened with the round it was summarising already
      // scrolled off the top and the only way out five sections below the
      // fold.
      innerStyle={{
        background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}`,
        display: "flex", flexDirection: "column",
      }}
    >
      {/* ── The header ────────────────────────────────────────────
          Named by where and what, the way the Leaderboard's round bar is —
          "Treetops · 2-Man Best Ball" places a round for a player far better
          than its number does. The number is the eyebrow because the
          notification that opened this said it. */}
      <div style={{
        flexShrink: 0,
        background: BC.amber + ALPHA.wash, borderBottom: `1px solid ${BC.amber}${ALPHA.hair}`,
        padding: "13px 18px", textAlign: "center",
      }}>
        <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.amberInk, letterSpacing: 1.5 }}>
          ROUND {s.round}{s.final ? " · FINAL" : s.played ? " · IN PLAY" : ""}
        </div>
        <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, marginTop: 3 }}>
          {s.courseName || "Course TBD"}
        </div>
        {formatLabel(s.format) && (
          <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 2 }}>{formatLabel(s.format)}</div>
        )}
      </div>

      {/* ── What the round moved ──────────────────────────────────
          The two team totals, which is the one number the whole field cares
          about and the reason a round being final is worth a push at all. */}
      <div style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        padding: "12px 16px", borderBottom: `1px solid ${BC.bdr}`,
      }}>
        <div style={{ flex: 1, textAlign: "right", minWidth: 0 }}>
          <div style={{
            fontSize: FS.label, fontWeight: 800, letterSpacing: 0.6, color: teamColor("A"),
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{s.points.teamA}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: FS.title, fontWeight: 800, color: s.points.leader === "B" ? `${BC.teamA}${ALPHA.held}` : BC.teamA }}>{s.points.A}</span>
          <span style={{ fontSize: FS.small, color: BC.t3 }}>–</span>
          <span style={{ fontSize: FS.title, fontWeight: 800, color: s.points.leader === "A" ? `${BC.teamB}${ALPHA.held}` : BC.teamB }}>{s.points.B}</span>
        </div>
        <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
          <div style={{
            fontSize: FS.label, fontWeight: 800, letterSpacing: 0.6, color: teamColor("B"),
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{s.points.teamB}</div>
        </div>
      </div>

      {/* Everything below the score is what scrolls. minHeight:0 is what
          lets it: a flex item's automatic minimum is its content, so without
          it this box refuses to shrink and pushes Close off the card again. */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain",
        padding: "12px 14px 2px",
      }}>
        {/* ── The matches ─────────────────────────────────────────
            The Leaderboard's own row: team A, the result, team B, with each
            side's colour as a rail on its outer edge. It used to be the two
            sides stacked on top of each other with the result pushed out to
            the right — the same two lines spent, but with team A's names
            ABOVE team B's on a screen whose score bar, six pixels up, has A
            on the left and B on the right.

            `1fr auto 1fr` keeps the centre exactly as wide as its content, so
            the two name columns stay equal to each other however long the
            status runs. `status` off the scoring engine is already
            golf-native — "3&2", "TIED" — so nothing here re-words a result. */}
        <Card label="MATCHES" empty="No matches set up for this round." rows={s.matches.length}>
          {s.matches.map((m, i) => (
            <div key={m.id ?? i} style={{
              display: "grid", gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center", gap: 8,
              padding: "6px 0",
              borderTop: i ? `1px solid ${BC.bdr}${ALPHA.hair}` : "none",
            }}>
              <MatchSide tid="A" names={m.a} winner={m.winner} />
              <div style={{ minWidth: 50, textAlign: "center" }}>
                <div style={{
                  fontSize: FS.small, fontWeight: 800, lineHeight: 1.2, letterSpacing: 0.3,
                  color: m.winner ? teamColor(m.winner) : BC.t2,
                }}>{m.status}</div>
                <div style={{ fontSize: FS.label, fontWeight: 800, lineHeight: 1.2 }}>
                  <span style={{ color: m.winner === "A" ? BC.teamA : BC.t3 }}>{m.pts.A}</span>
                  <span style={{ color: BC.t3 }}> – </span>
                  <span style={{ color: m.winner === "B" ? BC.teamB : BC.t3 }}>{m.pts.B}</span>
                </div>
              </div>
              <MatchSide tid="B" names={m.b} winner={m.winner} />
            </div>
          ))}
        </Card>

        {/* ── The side games ──────────────────────────────────────
            Four cards in the order the money is decided on the course: the
            pins as they are played, the skins hole by hole, the card at the
            end of it, and the one hole with a pot of its own.

            Each is scored against its OWN buy-in field, which is why a man
            can be missing from one card and on the next. */}
        {/* Four tiles across, because four is how many par 3s a course has —
            the pins are a fixed little set, not a list of unknown length, and
            laid out as one row they fit in the height a single stacked row
            used to take. Fewer than four still divides the row rather than
            stretching one tile the width of the card, which would read as the
            only pin there was to tag; the floor of two keeps a lone tile from
            becoming a banner. */}
        <Card label="CTP" empty="No pin was tagged on this one." rows={s.ctp.length}>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(Math.max(s.ctp.length, 2), 4)}, 1fr)`,
            gap: 5,
          }}>
            {s.ctp.map((c) => <CtpTile key={c.hole} ctp={c} />)}
          </div>
        </Card>

        {/* Two games on the same eighteen holes, and they do not agree — a
            hole can go net to the man with the shot and carry gross. Gross
            first, because that is the order a golfer says a score in and the
            order the net row's own two numbers are printed in.

            "Every hole carried" is a claim about a round somebody played. A
            round nobody has teed off on carried nothing. */}
        <Card
          label="GROSS SKINS"
          empty={s.played ? "Every hole carried." : "Nothing scored yet."}
          rows={s.skins.gross.length}
        >
          <SkinsGrid skins={s.skins.gross} />
        </Card>

        <Card
          label="NET SKINS"
          empty={s.played ? "Every hole carried." : "Nothing scored yet."}
          rows={s.skins.net.length}
        >
          <SkinsGrid skins={s.skins.net} />
        </Card>

        {/* Only a finished card is ranked, and equal lowest cards are
            co-winners — low net has nowhere to carry to. */}
        <Card label="LOW NET" empty="No card is in yet." rows={s.lowNet.length}>
          {s.lowNet.map((r) => (
            <WinRow key={r.pid} name={r.name} detail={`${r.gross} − ${r.ch} = ${r.net}`} />
          ))}
        </Card>

        {/* Absent entirely on a round the money hole is switched off in —
            not an empty card. "Nobody has posted it yet" on a round it is
            not being played would be waiting for a result that is never
            coming. See lib/betting. */}
        {s.moneyHole && (
          <Card
            label="MONEY HOLE"
            note={`hole ${s.moneyHole.hole}${s.moneyHole.par ? ` · par ${s.moneyHole.par}` : ""}`}
            empty="Nobody has posted it yet."
            rows={s.moneyHole.winners.length}
          >
            {s.moneyHole.winners.map((r) => (
              <WinRow key={r.pid} name={r.name} detail={`net ${r.net}`} />
            ))}
          </Card>
        )}

        {/* The pots themselves are not on this screen. What each of these is
            WORTH depends on the buy-in and on how the week's other rounds
            went, and the Betting tab is where that is settled — a share
            quoted here would be a second answer to it. */}
        <div style={{ fontSize: FS.micro, color: BC.t3, textAlign: "center", lineHeight: 1.5, margin: "2px 0 10px" }}>
          What each of these pays is on the Betting tab.
        </div>
      </div>

      {/* On the frame rather than at the end of the scroll, so the way out of
          a summary is where it is on every other sheet — the bottom edge —
          rather than wherever the round happened to run to. */}
      <div style={{
        flexShrink: 0, padding: "10px 14px",
        borderTop: `1px solid ${BC.bdr}`, background: BC.card,
      }}>
        <button
          onClick={onClose}
          style={{
            width: "100%", padding: 13, borderRadius: R.lg, border: "none",
            background: BC.amber, color: ON_AMBER,
            fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Close
        </button>
      </div>
    </Popup>
  );
}
