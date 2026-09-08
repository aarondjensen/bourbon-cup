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
//    THE HOLE   — one of eighteen.
//    THE ROUNDS — which rounds it is played in, one switch each, with the par
//                 and the format that round is played under on the row.
//    THE MONEY  — the buy-in and the field, in the same BuyInEditor the other
//                 three games use, which already prints what the two of them
//                 come to.
//
//  ── The scramble switch ──────────────────────────────────────────
//  The money hole is lowest NET, one man's ball. On a shared-ball round —
//  2-Man Scramble, Pinehurst — a side plays one ball and both partners carry
//  it, so the pair posts identical gross off an identical team stroke map and
//  therefore identical net. They do not win the hole between them, they win
//  it TWICE: two of the round's shares for one golf shot, and nobody finds
//  out until the money is read out on Sunday.
//
//  So a shared-ball round says so on its row, and the switch beside it is how
//  a director takes the game off that round. It is his call and not a rule —
//  a group that wants the pair playing for it can have it — and the pot then
//  divides by the rounds it IS played in, so switching one off makes the
//  others worth more rather than stranding a quarter of the money.
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
import { moneyHolePlaysRound } from "../lib/betting";
import { formatLabel, formatIsSharedBall } from "../constants";

const HOLES = 18;

export function MoneyHoleSetup({ hole, pars, only, players, amount, ids, onSetHole, onToggleRound, onChangeBuyIn }) {
  const rounds = (pars?.perRound || []).map(r => ({ ...r, on: moneyHolePlaysRound(r.round, only) }));
  const playing = rounds.filter(r => r.on);
  // The two warnings are about the game as it will be PLAYED, so a round the
  // director has switched off raises neither. A par 3 nobody is playing for
  // is not a CTP clash, and a course nobody needs the par of is not an open
  // question.
  const warn = playing.filter(r => r.par === 3);
  const unknown = playing.filter(r => r.par == null);
  const shared = playing.filter(r => formatIsSharedBall(r.format));

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

        {/* ── THE ROUNDS ──
            What the chosen hole plays to round by round — four rounds are
            four courses, so one hole has up to four pars, which is why the
            warnings below are per round rather than per tournament — and the
            switch that decides whether it is played there at all.

            A switch rather than a chip because the pot follows it: the share
            under the header divides by the rounds left ON. */}
        {rounds.length > 0 && (
          <div style={{ padding: "0 14px 10px" }}>
            <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 0.8, marginBottom: 2 }}>THE ROUNDS</div>
            <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.4, marginBottom: 6 }}>
              The pot divides by the rounds left on
            </div>
            {rounds.map(({ round, course, par, format, on }) => (
              <button
                key={round}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => onToggleRound?.(round, !on)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "7px 10px", marginBottom: 4, borderRadius: 8, cursor: "pointer",
                  fontFamily: FONT, textAlign: "left",
                  border: `1px solid ${on && par === 3 ? BC.warn : BC.bdr}${on && par === 3 ? "" : ALPHA.line}`,
                  background: on && par === 3 ? `${BC.warn}${ALPHA.wash}` : on ? BC.inp : "transparent",
                  opacity: on ? 1 : 0.55,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: "block", fontSize: FS.label, fontWeight: 800, letterSpacing: 0.4,
                    color: on && par === 3 ? BC.warn : on ? BC.t1 : BC.t3,
                  }}>
                    RD {round} · {course ? `PAR ${par}` : "NO COURSE"}
                  </span>
                  {/* The format, because it is the reason a director would
                      reach for this switch — see the note at the top. */}
                  <span style={{ display: "block", fontSize: FS.label, color: BC.t3, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {formatLabel(format) || "No format yet"}
                    {formatIsSharedBall(format) ? " · one ball, both partners" : ""}
                  </span>
                </span>
                <span style={{
                  flexShrink: 0, fontSize: FS.label, fontWeight: 800, letterSpacing: 0.6,
                  padding: "3px 8px", borderRadius: 999,
                  background: on ? `${BC.amber}${ALPHA.wash}` : "transparent",
                  border: `1px solid ${on ? BC.amber : BC.bdr}${ALPHA.line}`,
                  color: on ? BC.amberInk : BC.t3,
                }}>
                  {on ? "ON" : "OFF"}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* The shared-ball warning. Not a refusal, for the same reason the par
            3 one is not: the director sets the draw and may have a reason. */}
        {shared.length > 0 && (
          <div style={{
            display: "flex", gap: 8, padding: "10px 14px",
            borderTop: `1px solid ${BC.warn}${ALPHA.line}`,
            background: `${BC.warn}${ALPHA.wash}`,
          }}>
            <span style={{ fontSize: FS.body, flexShrink: 0 }}>⚠️</span>
            <span style={{ fontSize: FS.label, color: BC.t2, lineHeight: 1.5, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 800, color: BC.warn, letterSpacing: 0.4, marginBottom: 2 }}>
                {shared.length === 1 ? `ROUND ${shared[0].round} IS` : `ROUNDS ${shared.map(x => x.round).join(", ")} ARE`} A SHARED BALL
              </span>
              Both partners post the same net, so a side wins it twice. Switch
              {shared.length === 1 ? " it " : " them "}off unless you mean it.
            </span>
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
