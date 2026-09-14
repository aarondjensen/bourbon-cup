// ══════════════════════════════════════════════════════════════════
//  TurnCard — the group's front nine, put up on the 10th tee
// ══════════════════════════════════════════════════════════════════
//
//  Ported from WBC's scoring screen, where it has been the one thing that
//  catches a bad number while catching it is still free. Once every player on
//  the card has all nine front holes in and the screen lands on the 10th, the
//  group's gross front nine goes up as a card to eyeball before they play on.
//
//  The turn is the only moment on a golf course where a whole group is
//  standing still, has just added up a nine, and can still say "I had a 5
//  there". An hour later the same correction is an argument, and after the
//  card is signed it is a director's edit to a closed round.
//
//  What it is NOT is the scorecard. There is a Full Scorecard behind a button
//  on the same screen and it prints net, strokes, both sides and a running
//  line under every hole. The numbers here are GROSS ONLY, nine columns, one
//  row a card — what a man can check against his own memory of the hole, and
//  nothing else to read past. No net, no stroke dots, no birdie rings.
//
//  ── Except the match, and only where it is the news ────────────────
//  A bar over each match, the same one the score cards behind this popup are
//  headed with (components/MatchStatusBar), because the turn is when the
//  front nine SETTLES. A Nassau's front pot is decided on the ninth green and
//  the group walks off it not knowing — the one moment where the match state
//  is not a distraction from the numbers but the reason anybody is reading
//  them. It is one line a match, above the two men it is about, and the FRONT
//  chip on it is what has just been won.
//
//  The caller decides whether there is a bar at all, and passes `bar: null`
//  where there is not. Two cases, both its to know, not this one's:
//
//    • a SEALED round (lib/reveal). Gross is what makes this popup safe there
//      — the screen behind it already shows the group's gross on the score
//      buttons — and a running match state is the one thing the seal exists
//      to withhold. It would be handed to the man keeping the card, an hour
//      before the room is together.
//    • a TEAM round, whose match is the whole side across four tee times. A
//      verdict over these four would be a running score for holes they never
//      played, off men who are not in this popup. Same reasoning that takes
//      the per-hole status rows off that round's scoring screen.
//
//  A hole number is a button back to that hole. Catching a wrong number is
//  only worth anything with a way to it, and the group is standing on the
//  tee with the phone already open.
//
//  One button, and no backdrop dismiss — the same reason CtpPrompt and
//  MoneyHolePrompt have none. A stray tap on a phone in a cart pocket should
//  not be what closes it.

import { Popup } from "./Popup";
import { MatchStatusBar } from "./MatchStatusBar";
import { BC, ALPHA, ON_AMBER, FS, R } from "../theme";

// Every cell on the grid is the same box; only its ink changes. 30px is a
// readable row that still fits eleven rows of a foursome's card plus the
// header and the button inside a phone's popup.
const CELL = { display: "flex", alignItems: "center", justifyContent: "center", minHeight: 30 };
const LEAD = { ...CELL, justifyContent: "flex-start", overflow: "hidden" };

// `sections` is one entry per MATCH — because a singles tee group is two of
// them (lib/groups.scoringUnits) and each has its own front nine to have won.
// Every other round is one section holding every row.
//
//   { key,
//     bar:  MatchStatusBar props, or null where there is no verdict to give
//     rows: [{ key, names: ["Aaron J", "Dave S"], scores: [9 gross, 0 unposted] }] }
//
// A row is one CARD, not one player: a shared-ball side plays one ball and
// posts one number, so both partners share a row. Their names are STACKED in
// the cell rather than joined with a slash — the field's longest name is
// eight characters ("Julius P"), which is what the name column is cut to, and
// two of them with a separator came out as "CHRISTOP…", which identifies
// nobody. The row is the wide part of this card and the tall part is free.
export function TurnCard({ pars = [], sections = [], onJump, onClose }) {
  const holes = Array.from({ length: 9 }, (_, i) => i);
  const parOut = holes.reduce((a, h) => a + (pars[h] || 0), 0);
  const cols = "70px repeat(9, minmax(0,1fr)) 34px";
  const jump = (h) => { onClose?.(); onJump?.(h); };

  return (
    <Popup
      onClose={onClose}
      maxWidth={420}
      padding={0}
      noBackdropClose
      portal
      innerStyle={{ background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}` }}
    >
      <div style={{
        background: BC.amber + ALPHA.wash, borderBottom: `1px solid ${BC.amber}${ALPHA.hair}`,
        padding: "14px 20px", textAlign: "center",
      }}>
        <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.amberInk, letterSpacing: 0.3 }}>
          At the Turn
        </div>
      </div>

      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 2 }}>
          <div style={{ ...LEAD, fontSize: FS.micro, fontWeight: 700, color: BC.t3, letterSpacing: 0.6 }}>HOLE</div>
          {holes.map(h => (
            <button
              key={`h${h}`}
              onClick={() => jump(h)}
              style={{
                ...CELL, background: "none", border: "none", padding: 0, cursor: "pointer",
                fontFamily: "inherit", fontSize: FS.label, fontWeight: 700, color: BC.amberInk,
              }}
            >{h + 1}</button>
          ))}
          <div style={{ ...CELL, fontSize: FS.micro, fontWeight: 800, color: BC.amberInk }}>OUT</div>

          <div style={{ ...LEAD, fontSize: FS.micro, fontWeight: 600, color: BC.t3, letterSpacing: 0.6 }}>PAR</div>
          {holes.map(h => (
            <div key={`p${h}`} style={{ ...CELL, fontSize: FS.label, fontWeight: 600, color: BC.t2 }}>{pars[h] || "–"}</div>
          ))}
          <div style={{ ...CELL, fontSize: FS.label, fontWeight: 700, color: BC.t2 }}>{parOut || "–"}</div>

          {sections.flatMap(sec => [
            // Spans the whole grid rather than sitting in the name column:
            // the bar is about the rows under it, not about one of them.
            sec.bar ? (
              <div key={`${sec.key}-bar`} style={{ gridColumn: "1 / -1", margin: "5px 0 3px" }}>
                <MatchStatusBar {...sec.bar} style={{ borderRadius: R.sm, border: `1px solid ${BC.bdr}` }} />
              </div>
            ) : null,
            ...(sec.rows || []).flatMap(r => {
            const out = holes.reduce((a, h) => a + (r.scores?.[h] || 0), 0);
            return [
              <div key={`${r.key}-n`} style={{ ...LEAD, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", padding: "3px 0" }}>
                {(r.names || []).map((n, i) => (
                  <span key={i} style={{
                    display: "block", maxWidth: "100%",
                    fontSize: FS.label, fontWeight: 700, color: BC.t1, lineHeight: 1.35,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{n}</span>
                ))}
              </div>,
              ...holes.map(h => (
                <div key={`${r.key}-${h}`} style={{ ...CELL, fontSize: FS.label, fontWeight: 700, color: BC.t1 }}>
                  {r.scores?.[h] || ""}
                </div>
              )),
              <div key={`${r.key}-out`} style={{ ...CELL, fontSize: FS.label, fontWeight: 800, color: BC.amberInk }}>
                {out || ""}
              </div>,
            ];
            }),
          ].filter(Boolean))}
        </div>

        <div style={{ height: 12 }} />

        <button
          onClick={onClose}
          style={{
            width: "100%", padding: 13, borderRadius: R.lg, border: "none",
            background: BC.amber, color: ON_AMBER,
            fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5, cursor: "pointer",
          }}
        >
          On to the Back 9
        </button>
      </div>
    </Popup>
  );
}
