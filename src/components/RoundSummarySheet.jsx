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
import { useMemo } from "react";
import { Popup } from "./Popup";
import { roundSummary } from "../lib/roundSummary";
import { formatLabel } from "../constants";
import { BC, ALPHA, ON_AMBER, FS, R, teamColor } from "../theme";

// The all-caps eyebrow every section card is led by. Spelled once so five
// sections cannot drift apart by a letter of tracking.
const Label = ({ children, note }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
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
    padding: "10px 12px", marginBottom: 10,
  }}>
    <Label note={note}>{label}</Label>
    {rows === 0
      ? <div style={{ fontSize: FS.small, color: BC.t3 }}>{empty}</div>
      : children}
  </div>
);

// One line of a game's result: who, and what they did. The hole number leads
// where there is one, because that is what a man scans for.
const WinRow = ({ lead, name, detail }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
    {lead != null && (
      <span style={{
        flexShrink: 0, minWidth: 26, fontSize: FS.label, fontWeight: 800,
        color: BC.amberInk, letterSpacing: 0.3,
      }}>{lead}</span>
    )}
    <span style={{
      flex: 1, minWidth: 0, fontSize: FS.small, fontWeight: 700, color: BC.t1,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>{name}</span>
    {detail && (
      <span style={{ flexShrink: 0, fontSize: FS.label, fontWeight: 700, color: BC.t3 }}>{detail}</span>
    )}
  </div>
);

// A skin gets a line of its own rather than WinRow's single one. It carries
// four facts — who, what he made, where, and off what — and the shot itself is
// the one a man wants first, so the golf word leads the second line and the
// two scores sit out to the right where they can be compared down the column.
//
// Both scores, always, even where they are the same: "5 gross · 5 net" is how
// the card says he got no stroke on that hole, which is a real thing to know
// about a skin somebody is about to be paid for.
const SkinRow = ({ skin }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "5px 0" }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: FS.small, fontWeight: 700, color: BC.t1,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{skin.name}</div>
      <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 1 }}>
        <span style={{ color: BC.amberInk, fontWeight: 800 }}>{skin.result}</span>
        {` on Hole ${skin.hole + 1}, Par ${skin.par}`}
      </div>
    </div>
    <span style={{ flexShrink: 0, fontSize: FS.label, fontWeight: 700, color: BC.t3 }}>
      {skin.gross} gross · <span style={{ color: BC.t2 }}>{skin.net} net</span>
    </span>
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

  const ft = (n) => (n == null ? null : `${n} ft`);

  return (
    <Popup
      onClose={onClose}
      maxWidth={440}
      padding={0}
      outerPadding={12}
      portal
      innerStyle={{ background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}` }}
    >
      {/* ── The header ────────────────────────────────────────────
          Named by where and what, the way the Leaderboard's round bar is —
          "Treetops · 2-Man Best Ball" places a round for a player far better
          than its number does. The number is the eyebrow because the
          notification that opened this said it. */}
      <div style={{
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

      <div style={{ padding: "12px 14px" }}>
        {/* ── The matches ─────────────────────────────────────────
            `status` off the scoring engine is already golf-native — "3&2
            (IRONS)", "AS" — so nothing here re-words a result. The two sides
            are stacked rather than columned: a four-ball's two names per side
            do not fit across a phone beside a status. */}
        <Card label="MATCHES" empty="No matches set up for this round." rows={s.matches.length}>
          {s.matches.map((m, i) => (
            <div key={m.id ?? i} style={{
              padding: "7px 0",
              borderTop: i ? `1px solid ${BC.bdr}${ALPHA.hair}` : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: FS.small, fontWeight: 700, color: m.winner === "B" ? BC.t3 : BC.t1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{m.a.join(" / ")}</div>
                  <div style={{
                    fontSize: FS.small, fontWeight: 700, color: m.winner === "A" ? BC.t3 : BC.t1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{m.b.join(" / ")}</div>
                </div>
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.t2, letterSpacing: 0.3 }}>{m.status}</div>
                  <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3 }}>
                    <span style={{ color: m.winner === "A" ? BC.teamA : BC.t3 }}>{m.pts.A}</span>
                    <span> – </span>
                    <span style={{ color: m.winner === "B" ? BC.teamB : BC.t3 }}>{m.pts.B}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </Card>

        {/* ── The side games ──────────────────────────────────────
            Four cards in the order the money is decided on the course: the
            pins as they are played, the skins hole by hole, the card at the
            end of it, and the one hole with a pot of its own.

            Each is scored against its OWN buy-in field, which is why a man
            can be missing from one card and on the next. */}
        <Card label="CTP" empty="No pin was tagged on this one." rows={s.ctp.length}>
          {s.ctp.map((c) => (
            <WinRow key={c.hole} lead={`#${c.hole + 1}`} name={c.name} detail={ft(c.distanceFt)} />
          ))}
        </Card>

        {/* "Every hole carried" is a claim about a round somebody played. A
            round nobody has teed off on carried nothing. */}
        <Card
          label="SKINS"
          note="won on net"
          empty={s.played ? "Every hole carried." : "Nothing scored yet."}
          rows={s.skins.length}
        >
          {s.skins.map((k) => (
            <SkinRow key={k.hole} skin={k} />
          ))}
        </Card>

        {/* Only a finished card is ranked, and equal lowest cards are
            co-winners — low net has nowhere to carry to. */}
        <Card label="LOW NET" empty="No card is in yet." rows={s.lowNet.length}>
          {s.lowNet.map((r) => (
            <WinRow key={r.pid} name={r.name} detail={`${r.gross} − ${r.ch} = ${r.net}`} />
          ))}
        </Card>

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

        {/* The pots themselves are not on this screen. What each of these is
            WORTH depends on the buy-in and on how the week's other rounds
            went, and the Betting tab is where that is settled — a share
            quoted here would be a second answer to it. */}
        <div style={{ fontSize: FS.micro, color: BC.t3, textAlign: "center", lineHeight: 1.5, margin: "2px 0 12px" }}>
          What each of these pays is on the Betting tab.
        </div>

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
