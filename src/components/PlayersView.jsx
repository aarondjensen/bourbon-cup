// ══════════════════════════════════════════════════════════════════
//  Players — the field, for everybody
// ══════════════════════════════════════════════════════════════════
//
// Admin → Players read-only, minus the two columns that are the director's
// business rather than the field's: the crown and the 🔗 that says whose
// sign-in claimed a name. Both answer "who administers this tournament" and
// "why can't I pick my own name", which are questions asked OF a director.
// What is left is the two facts sixteen men ask each other on the first tee —
// what is he playing off, and what does he get today.
//
// The Round CH columns are the point of the screen. The index has always been
// on a phone somewhere; the number that actually hands out strokes has only
// ever been visible inside round setup, which is a director's screen.
//
// ── The one rule the columns have to keep ─────────────────────────
// A round's Course Handicap is FROZEN once that round has locked, and live
// until then. A GHIN sync on Saturday morning moves Sunday's column and must
// not move Friday's — the round was played off the number on the card.
//
// That is not re-implemented here. Every cell goes through `getRoundCH`,
// which is the same resolution point every stroke dot on every screen goes
// through: lock's frozen answer first, then the director's per-round CH
// override, then a live calculation off the effective index and the assigned
// tee. A column that derived its own number would be a fifth opinion about a
// round that has exactly one.
import { BC, FONT, ALPHA, FS, playerNameColor } from "../theme";
import { getRoundCH, lockedPlayerRow } from "../scoring";
import { realPlayers } from "../lib/players";

// Name flexes, the numbers don't. The round columns are capped rather than
// free so a four-round tournament spends its spare width on names instead of
// spreading six characters over half a phone — and floored so a twelve-round
// one scrolls sideways rather than crushing them to nothing.
const gridCols = (n) => `minmax(84px, 1fr) 40px repeat(${n}, minmax(28px, 34px))`;

// A function, not an object: `BC` is mutated in place by applyBCTheme, so a
// top-level style object would freeze whichever theme the app started in and
// keep it for the session. See src/themeMutation.test.js.
const head = () => ({
  fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.4,
  color: BC.t3, textAlign: "center",
});

// A course handicap, or null when the round has nothing to compute one from.
// An unlocked round with no course assigned would otherwise print a number:
// `resolveTeeSpec` falls back to 113/72/72, which quietly renders the index
// back as a handicap and reads as a real allocation for a round that has not
// been set up at all.
const chFor = ({ pid, round, tPlayers, tRounds, courses, roundLocks, hcpOverrides, teeAssignments }) => {
  const tr = (tRounds || []).find(r => r.round_number === round);
  const course = (courses || []).find(c => c.id === tr?.course_id) || null;
  if (!course && !lockedPlayerRow(roundLocks, round, pid)) return null;
  return getRoundCH({
    roundLocks, round, pid, players: tPlayers,
    course, chOverrides: hcpOverrides, teeAssignments, roundTee: tr?.tee_box,
  });
};

// Live figures are whole (calcCH rounds), but the imported years carry the
// blended fractional handicaps their sheets were played off — see the shared
// ball note in lib/historyImport — so 2020 must not print "12" over a card
// that gave 11.5.
const num = (v) => (v == null || !Number.isFinite(Number(v)))
  ? "–"
  : (Number.isInteger(Number(v)) ? String(Number(v)) : String(Number(Number(v).toFixed(1))));

export function PlayersView({
  tPlayers, teams, rounds, tRounds, courses, roundLocks, hcpOverrides, teeAssignments,
}) {
  const roundList = (rounds && rounds.length) ? rounds : [];
  const cols = gridCols(roundList.length);
  const field = realPlayers(tPlayers);

  return (
    <div style={{ fontFamily: FONT, padding: "4px 2px 20px" }}>
      {/* Sideways scroll is the twelve-round escape hatch and nothing else —
          at four rounds the grid fits a phone and this box never scrolls. */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: "100%" }}>
          {/* Column heads, once, above both sides. Repeating them per team
              would put a row of labels between the two blocks and make the
              second side read as a second table. */}
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, padding: "0 8px 4px", alignItems: "end" }}>
            <div />
            <div style={head()}>IDX</div>
            {roundList.map(r => <div key={r} style={head()}>R{r}</div>)}
          </div>

          {[teams.A, teams.B].map(team => {
            const side = field.filter(p => p.team === team.id);
            return (
              <div key={team.id} style={{ marginBottom: 10 }}>
                <div style={{
                  padding: "6px 8px", marginBottom: 6,
                  background: team.color + ALPHA.tint, borderRadius: 10,
                  border: `1px solid ${team.accent}${ALPHA.line}`,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {team.logo && (
                    <img src={team.logo} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />
                  )}
                  <span style={{
                    fontSize: FS.small, fontWeight: 800, letterSpacing: 1, color: team.accent,
                    minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{team.name || ""}</span>
                </div>

                {side.map(p => {
                  // Player-level override wins over the GHIN/base index, the
                  // same way getEffectiveHI resolves it for the scoring engine.
                  const overridden = p.hi_override != null && String(p.hi_override).trim() !== "";
                  const effHI = overridden ? p.hi_override : p.handicap_index;
                  return (
                    <div key={p.player_id} style={{
                      display: "grid", gridTemplateColumns: cols, gap: 4, alignItems: "center",
                      background: BC.card, borderRadius: 6, padding: "6px 8px", marginBottom: 2,
                      border: `1px solid ${BC.bdr}`,
                      boxShadow: `inset 3px 0 0 ${team.accent}${ALPHA.line}`,
                    }}>
                      <span style={{
                        fontSize: FS.small, fontWeight: 600, color: playerNameColor(),
                        minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{p.name || ""}</span>
                      <span style={{ fontSize: FS.small, fontWeight: 500, color: BC.t2, textAlign: "center" }}>
                        {num(effHI)}
                      </span>
                      {roundList.map(r => (
                        <span key={r} style={{ fontSize: FS.small, fontWeight: 700, color: BC.t1, textAlign: "center" }}>
                          {num(chFor({
                            pid: p.player_id, round: r,
                            tPlayers, tRounds, courses, roundLocks, hcpOverrides, teeAssignments,
                          }))}
                        </span>
                      ))}
                    </div>
                  );
                })}

                {side.length === 0 && (
                  <div style={{ color: BC.t3, fontSize: FS.small, padding: "6px 10px" }}>No players yet.</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
