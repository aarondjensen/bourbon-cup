// ══════════════════════════════════════════════════════════════════
//  FieldCard — one round's card for the WHOLE field, with skins on it
// ══════════════════════════════════════════════════════════════════
//
//  The scorecard skins actually live on. Every other card in this app is
//  match-scoped — four players, two sides — and that is the wrong shape for
//  a skin, because a skin is won against the entire round. On a match card
//  the low number in a column is only the low number among the four people
//  standing there, so an amber cell would be a claim the card cannot check,
//  and the hole whose skin went to somebody in the group ahead has nothing
//  to show at all.
//
//  Here the column IS the field. That single change is what makes the
//  treatment honest: an amber cell is provably the low score because every
//  player who could have beaten it is in the same column, and a push is
//  self-evident — two equal lows sitting one above the other, with nothing
//  lit.
//
//    HOLE   1 2 3 4 5 6 7 8 9   SK   ← the nine on show
//    PAR    4 5 3 4 4 3 5 4 4        ← always
//    HCP    5 11 17 …                ← net only: where the dots come from
//    AJ 12  4 5 ② 4 4 3 5 4 4    1   ← one row per player in the round
//    BK  8  5 6 4 4 4 4 ④ 4 4    1
//    …
//    SKIN   – DM AJ – TR – BK – –  4 ← who took each hole, and how many
//
//  Nine at a time, because sixteen rows of eighteen holes is a spreadsheet.
//  The nine-column grid is the same width the match card uses, so this fits
//  a phone with no horizontal scroll and no sticky name column.
//
//  Everything is presentational. The scores arrive already concealed for a
//  sealed round (BettingView is handed revealedHoleData), so a round nobody
//  has turned over yet arrives here as a round with no scores in it, and the
//  skins computed from it are empty on their own — there is no separate
//  blackout to keep in step.

import { useState } from "react";
import { BC, FONT, ALPHA, FS, BROWN, ON_ACCENT, teamColor } from "../theme";
import { ScoreCell } from "./FullScorecard";
import { SegmentedToggle } from "./ui";

// Same geometry as the match card: fixed label and total columns, nine hole
// columns flexing into what is left.
const LABEL_W = 42;
const TOT_W = 30;
const ROW_H = 15;

const colBdr = () => `1px solid ${BC.bdr}${ALPHA.line}`;
const rowBdr = () => `1px solid ${BC.bdr}${ALPHA.hair}`;

const initials = (name) =>
  String(name || "?").trim().split(/\s+/).map((n) => n[0]?.toUpperCase() || "").join("") || "?";

const labelCell = (extra) => ({
  width: LABEL_W, flexShrink: 0,
  fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.3, color: BC.t3,
  display: "flex", alignItems: "center", gap: 2, paddingLeft: 4,
  borderRight: colBdr(),
  ...extra,
});

const totCell = (extra) => ({
  width: TOT_W, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  borderLeft: colBdr(),
  fontSize: FS.micro, fontWeight: 800,
  ...extra,
});

const holeCell = { flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" };

export function FieldCard({ players, pars, hcps, scoreFor, strokesFor, skins, gross }) {
  const [nine, setNine] = useState(0);
  const start = nine === 0 ? 0 : 9;
  const idx = Array.from({ length: 9 }, (_, i) => start + i);

  // Skins keyed by hole, so a row can ask "did this player take this one?"
  // without walking the array eighteen times per row.
  const winnerAt = {};
  skins.forEach(s => { if (s.winner) winnerAt[s.hole] = s.winner; });
  const nineCount = idx.filter(h => winnerAt[h]).length;

  return (
    <div style={{ fontFamily: FONT }}>
      <SegmentedToggle
        variant="pills"
        style={{ marginBottom: 8 }}
        options={[[0, "Front"], [1, "Back"]]}
        value={nine}
        onChange={setNine}
      />

      <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 8, overflow: "hidden" }}>

        {/* Hole band */}
        <div style={{ display: "flex", background: BROWN, height: 18 }}>
          <div style={labelCell({ color: ON_ACCENT, borderRightColor: `${ON_ACCENT}${ALPHA.hair}` })}>HOLE</div>
          {idx.map(h => (
            <div key={h} style={{ ...holeCell, fontSize: FS.micro, fontWeight: 800, color: ON_ACCENT }}>{h + 1}</div>
          ))}
          <div style={totCell({ color: ON_ACCENT, borderLeftColor: `${ON_ACCENT}${ALPHA.hair}` })}>SK</div>
        </div>

        {/* Par. The total column stays EMPTY here: it counts skins, and a
            nine's par total is the one value in it that would not be one —
            with no stroke totals anywhere on this card for it to pair with,
            it read as a skins count of 36. */}
        <div style={{ display: "flex", height: ROW_H, borderTop: rowBdr() }}>
          <div style={labelCell()}>PAR</div>
          {idx.map(h => (
            <div key={h} style={{ ...holeCell, fontSize: FS.micro, fontWeight: 700, color: BC.t2 }}>{pars[h]}</div>
          ))}
          <div style={totCell()} />
        </div>

        {/* Stroke index — only when it is explaining something. In gross mode
            no cell carries dots, so the row would be a table of numbers with
            nothing on the card referring to them. */}
        {!gross && (
          <div style={{ display: "flex", height: ROW_H, borderTop: rowBdr() }}>
            <div style={labelCell()}>HCP</div>
            {idx.map(h => (
              <div key={h} style={{ ...holeCell, fontSize: FS.micro, fontWeight: 700, color: BC.hcpBlue }}>{hcps[h]}</div>
            ))}
            <div style={totCell()} />
          </div>
        )}

        {/* Who took each hole. It sits with the other header rows rather than
            under the field: it is the answer, and sixteen rows is too far to
            scroll to find out how the nine went. The amber cells below are
            the same answer read down instead of across — this row is also the
            only place a push is stated in words rather than implied by a
            column with nothing lit in it. */}
        <div style={{ display: "flex", height: 17, borderTop: `1px solid ${BC.bdr}`, background: `${BC.amber}${ALPHA.wash}` }}>
          <div style={labelCell({ color: BC.amberInk })}>SKIN</div>
          {idx.map(h => {
            const w = winnerAt[h];
            return (
              <div key={h} style={{ ...holeCell, fontSize: FS.micro, fontWeight: 800, color: w ? BC.amberInk : BC.t3 }}>
                {w ? initials(w.name) : "–"}
              </div>
            );
          })}
          <div style={totCell({ color: BC.amberInk })}>{nineCount}</div>
        </div>

        {/* One row per player in the round */}
        {players.map(p => {
          const won = idx.filter(h => winnerAt[h]?.pid === p.player_id).length;
          return (
            <div key={p.player_id} style={{ display: "flex", alignItems: "center", borderTop: rowBdr() }}>
              <div style={labelCell({ alignSelf: "stretch" })}>
                <span style={{ fontWeight: 800, color: teamColor(p.team) }}>{initials(p.name)}</span>
              </div>
              {idx.map(h => (
                <div key={h} style={holeCell}>
                  <ScoreCell
                    score={scoreFor(p.player_id, h)}
                    par={pars[h]}
                    strokes={gross ? 0 : strokesFor(p.player_id, h)}
                    skin={winnerAt[h]?.pid === p.player_id}
                  />
                </div>
              ))}
              <div style={totCell({ alignSelf: "stretch", color: won ? BC.amberInk : BC.t3 })}>{won || "—"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
