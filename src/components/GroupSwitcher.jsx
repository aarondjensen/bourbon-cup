// ══════════════════════════════════════════════════════════════════
//  GroupSwitcher — a director pointing the Scoring tab at any group.
// ══════════════════════════════════════════════════════════════════
//
// Scoring is normally locked to the match the person holding the phone is
// playing in: that is what makes it safe to hand a phone to a tee box. This
// is the one deliberate hole in that, and it is a DIRECTOR'S hole — the flag
// lives on their bc_accounts document and the security rules read the same
// one, so a phone that can see this control is a phone whose writes will be
// accepted (see CLAUDE.md, Directors).
//
// It exists because a round has to be testable before it is played, and
// because on the day somebody's phone is dead and the scores still have to go
// in. Both of those are "enter scores for a group you are not in".
//
// A row of pills is what the multi-match player gets, and it does not survive
// eight matches. It also names the wrong thing: a director hunting for the
// group in front of them is not looking for "Match 6", they are looking for
// the four people standing there. So this is a button that opens a list, and
// the list leads with the names.
//
// ── Why the trigger is a crown over M6 and not a labelled pill ─────
// This screen is fit to the device, not scrolled (lib/useFitDensity): every
// pixel above the player cards comes out of the score buttons' height. The
// trigger started as a right-aligned pill reading "👑 MATCH 1 ▾" on a row of
// its own, which cost 26px of that budget — for one director, all round, on
// every phone that is one.
//
// So it is a chip the size of a badge, and it does not get a row. It rides on
// the Full Scorecard bar, which is full width and already there, so its
// vertical cost is zero rather than merely small. Two lines because the crown
// alone does not say WHICH group you are pointed at, and that is the question
// a director asks it — but "Match" spelled out was never part of the answer at
// a glance, and neither was the caret. The popup is the disclosure.
import { useState } from "react";
import { BC, FONT, FS, ALPHA, teamColor } from "../theme";
import { Popup } from "./Popup";

const label = (m, i) => `Match ${m.matchNumber ?? i + 1}`;
const shortLabel = (m, i) => `M${m.matchNumber ?? i + 1}`;

export function GroupSwitcher({ matches, current, tPlayers, userPid, onPick }) {
  const [open, setOpen] = useState(false);
  const nameOf = (pid) => tPlayers.find(p => p.player_id === pid)?.name || pid;
  const side = (pids) => (pids || []).map(nameOf).join(" · ");
  const currentIdx = matches.findIndex(m => m.id === current?.id);

  return (
    <>
      {/* No wrapper and no margin: the caller places this. On the scoring
          screen it sits at the end of the Full Scorecard bar; the signed view
          gives it a row, because that screen is not fighting for height. */}
      <button onClick={() => setOpen(true)}
        title={`${label(current, currentIdx)} — score another group`}
        aria-label={`${label(current, currentIdx)}. Score another group`}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 1, flexShrink: 0, alignSelf: "stretch", minWidth: 38,
          padding: "2px 7px", borderRadius: 8, cursor: "pointer", fontFamily: FONT,
          background: BC.card, border: `1px solid ${BC.bdr}`,
        }}>
        {/* The crown is the tell that this control is not what everyone else
            on the course is looking at; the number under it is which group
            the screen is currently pointed at. */}
        <span aria-hidden="true" style={{ fontSize: FS.label, lineHeight: 1 }}>👑</span>
        <span aria-hidden="true" style={{
          fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.5, lineHeight: 1, color: BC.t2,
        }}>
          {shortLabel(current, currentIdx)}
        </span>
      </button>

      {open && (
        <Popup onClose={() => setOpen(false)} maxWidth={420} padding={0} portal showClose>
          <div style={{ fontFamily: FONT, padding: "16px 16px 8px" }}>
            <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, letterSpacing: 0.5 }}>
              Score another group
            </div>
            <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.45, marginTop: 3 }}>
              Round {current?.round}. Anything you enter is posted as that
              group&apos;s score, exactly as if they had entered it themselves.
            </div>
          </div>
          <div style={{ padding: "0 10px 14px", maxHeight: "60vh", overflowY: "auto", overscrollBehavior: "contain" }}>
            {matches.map((m, i) => {
              const on = m.id === current?.id;
              const mine = [...(m.teamA || []), ...(m.teamB || [])].includes(userPid);
              return (
                <button key={m.id} onClick={() => { onPick(m.id); setOpen(false); }} style={{
                  display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                  padding: "9px 11px", marginTop: 6, borderRadius: 10, fontFamily: FONT,
                  background: on ? `${BC.amber}${ALPHA.wash}` : BC.card,
                  border: `1px solid ${on ? BC.amber : BC.bdr}${ALPHA.line}`,
                }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: FS.small, fontWeight: 800, letterSpacing: 0.5, color: on ? BC.amberInk : BC.t2 }}>
                      {label(m, i)}
                    </span>
                    {/* Their own match, marked — a director scoring their own
                        group is the ordinary case and should be one tap back. */}
                    {mine && (
                      <span style={{ fontSize: FS.micro, fontWeight: 700, letterSpacing: 1, color: BC.t3 }}>YOURS</span>
                    )}
                  </div>
                  {["A", "B"].map(t => (
                    <div key={t} style={{
                      fontSize: FS.label, fontWeight: 600, lineHeight: 1.5, color: BC.t1,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      <span style={{ color: teamColor(t), fontWeight: 800 }}>▌</span>{" "}
                      {side(t === "A" ? m.teamA : m.teamB) || "—"}
                    </div>
                  ))}
                </button>
              );
            })}
          </div>
        </Popup>
      )}
    </>
  );
}
