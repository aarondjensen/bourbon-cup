// ══════════════════════════════════════════════════════════════════
//  MoneyHoleSetup — the director's console for the money hole
// ══════════════════════════════════════════════════════════════════
//
//  The money hole is the one scored game with a SETTING. Skins, CTP and low
//  net all know their own holes — every hole, every par 3, every card — and
//  need nothing but a buy-in and a field. This one has to be told which hole
//  it is on, and that answer names the Betting tab, decides which green the
//  on-course prompt fires before, and is what every payout on the tab is
//  computed from. A picker tucked into a corner of the pot card is not enough
//  UI for a number carrying that much, so it gets a console:
//
//    THE HOLE   — one of eighteen, with the par it plays to on every round of
//                 the draw underneath it.
//    THE MONEY  — the buy-in and the field, in the same BuyInEditor the other
//                 three games use, which already prints what the two of them
//                 come to.
//
//  ── The par 3 warning ────────────────────────────────────────────
//  Every par 3 already carries the CTP pot, and the two games are decided by
//  different things on the same green: CTP by the tee shot, this by the score.
//  A hole carrying both walks the group off into two prompts, one asking how
//  close and one that has already paid out.
//
//  So the console says so, loudly, naming the rounds — but it does NOT refuse
//  the choice. The director sets the draw and may have a reason; what they
//  must not do is set it by accident, which is exactly what happens when the
//  hole is picked in February and the courses land in June. Which is also why
//  a round whose course is not set yet is called out separately rather than
//  passing: an unanswerable question must not read as an answered one.

import { BC, FONT, ALPHA, FS } from "../theme";
import { BuyInEditor } from "./BuyIns";

const HOLES = 18;

export function MoneyHoleSetup({ hole, pars, players, amount, ids, onSetHole, onChangeBuyIn }) {
  const warn = pars?.par3 || [];
  const unknown = pars?.unknown || [];
  const rounds = pars?.perRound || [];

  return (
    <div style={{ fontFamily: FONT, marginBottom: 12 }}>
      {/* ── THE HOLE ── */}
      <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 12, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}`, fontSize: FS.label, fontWeight: 700, color: BC.gold, letterSpacing: 1 }}>
          MONEY HOLE SETUP
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 0.8 }}>THE HOLE</span>
            {/* Short, because the app's face is all caps and prose in it
                reads as shouting — see the note in CtpPrompt. A director
                needs the two consequences and nothing else. */}
            <span style={{ display: "block", fontSize: FS.label, color: BC.t3, lineHeight: 1.4, marginTop: 2 }}>
              Names the tab · warns the tee
            </span>
          </span>
          {/* A select rather than a number field: there are eighteen answers,
              and a typo in a box would MOVE the game rather than be refused. */}
          <select
            value={hole}
            onChange={e => onSetHole(Number(e.target.value))}
            style={{
              background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1,
              fontSize: FS.lead, fontWeight: 800, padding: "6px 8px", fontFamily: FONT, flexShrink: 0,
            }}
          >
            {Array.from({ length: HOLES }, (_, i) => i + 1).map(h => (
              <option key={h} value={h}>Hole {h}</option>
            ))}
          </select>
        </label>

        {/* What the chosen hole plays to, round by round. Four rounds are four
            courses, so one hole has up to four pars — which is the whole
            reason the warning below is per round rather than per tournament. */}
        {rounds.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 10px" }}>
            {rounds.map(({ round, course, par }) => (
              <span key={round} style={{
                fontSize: FS.label, fontWeight: 700, letterSpacing: 0.4,
                padding: "3px 8px", borderRadius: 6,
                border: `1px solid ${par === 3 ? BC.warn : BC.bdr}${par === 3 ? "" : ALPHA.line}`,
                background: par === 3 ? `${BC.warn}${ALPHA.wash}` : "transparent",
                color: par === 3 ? BC.warn : BC.t3,
              }}>
                RD {round} · {course ? `PAR ${par}` : "NO COURSE"}
              </span>
            ))}
          </div>
        )}

        {warn.length > 0 && (
          <div style={{
            display: "flex", gap: 8, padding: "10px 14px",
            borderTop: `1px solid ${BC.warn}${ALPHA.line}`,
            background: `${BC.warn}${ALPHA.wash}`,
          }}>
            <span style={{ fontSize: FS.body, flexShrink: 0 }}>⚠️</span>
            <span style={{ fontSize: FS.label, color: BC.t2, lineHeight: 1.5, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 800, color: BC.warn, letterSpacing: 0.4, marginBottom: 2 }}>
                HOLE {hole} IS A PAR 3 ON {warn.length === 1 ? `ROUND ${warn[0].round}` : `ROUNDS ${warn.map(x => x.round).join(", ")}`}
              </span>
              Already a CTP. Pick a par 4 or 5.
            </span>
          </div>
        )}

        {unknown.length > 0 && (
          <div style={{ padding: "8px 14px", borderTop: `1px solid ${BC.bdr}`, fontSize: FS.label, color: BC.t3, lineHeight: 1.4 }}>
            {unknown.length === 1 ? `Round ${unknown[0].round} has` : `Rounds ${unknown.map(x => x.round).join(", ")} have`}
            {" "}no course yet — check the par again once the draw lands.
          </div>
        )}
      </div>

      {/* ── THE MONEY ── */}
      {/* No summary strip above the editor. It said "3 × $10 = $30.00" over
          an editor whose own header row already reads "3 IN · $30.00" — the
          same number, twice, one line apart. */}
      <BuyInEditor players={players} amount={amount} ids={ids} onChange={onChangeBuyIn} />
    </div>
  );
}
