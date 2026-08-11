// ══════════════════════════════════════════════════════════════════
//  GroupSwitcher — a director pointing the Scoring tab at any group,
//  in any round.
// ══════════════════════════════════════════════════════════════════
//
// Scoring is normally locked to the match the person holding the phone is
// playing in, in the one round the tournament is on: that is what makes it
// safe to hand a phone to a tee box. This is the one deliberate hole in that,
// and it is a DIRECTOR'S hole — the flag lives on their bc_accounts document
// and the security rules read the same one, so a phone that can see this
// control is a phone whose writes will be accepted (see CLAUDE.md, Directors).
//
// It exists because a round has to be testable before it is played, and
// because on the day somebody's phone is dead and the scores still have to go
// in. Both of those are "enter scores for a group you are not in".
//
// It crosses ROUNDS as well as groups, which the round gate does not allow
// anybody else (see "The round gate" in App.jsx). A card comes in wrong and
// nobody notices until the next morning; a group posts to the wrong hole and
// signs over it. Correcting that is a director's job and there was no way to
// do it from inside the app at all — the round it happened in was already
// closed. So the list is every round, not just the live one, and a round
// that is not the live one is labelled as such at every point where somebody
// could mistake one for the other: in this list, on the trigger chip, and in
// a banner across the scoring screen itself.
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
// So it is a chip the size of a badge, and it does not get a row — it does not
// live on this screen at all. ScoreEntry portals it into the app header's
// right-hand slot (components/AppHeader), which is chrome that is already on
// screen and already that tall, so the scoring view pays nothing for it. That
// is also where it belongs by rights: it is a tool for pointing the app at a
// group, not a step in entering a score.
//
// Two lines because the crown alone does not say WHICH group you are pointed
// at, and that is the question a director asks it — but "Match" spelled out
// was never part of the answer at a glance, and neither was the caret. The
// popup is the disclosure.
import { useState } from "react";
import { BC, FONT, FS, ALPHA, teamColor } from "../theme";
import { Popup } from "./Popup";
import { roundLockState, LOCK_STATE_LABEL, LOCK_FINAL } from "../lib/roundLocks";

// The cup's number for a match, not its position in the list handed here —
// the list is now every round's matches, so an index into it means nothing to
// anybody standing on a tee.
const label = (m) => `Match ${m?.matchNumber ?? "?"}`;
const shortLabel = (m) => `M${m?.matchNumber ?? "?"}`;

// Matches grouped by round, ascending, each round keeping the order it came
// in. Rounds are the outer axis because that is the axis a director is
// crossing deliberately — a group is picked out of a round, never the other
// way round.
const byRound = (matches) => {
  const groups = new Map();
  (matches || []).forEach(m => {
    if (!groups.has(m.round)) groups.set(m.round, []);
    groups.get(m.round).push(m);
  });
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
};

export function GroupSwitcher({ matches, current, currentRound, roundLocks, tPlayers, userPid, onPick }) {
  const [open, setOpen] = useState(false);
  const nameOf = (pid) => tPlayers.find(p => p.player_id === pid)?.name || pid;
  const side = (pids) => (pids || []).map(nameOf).join(" · ");
  const rounds = byRound(matches);
  // The screen is pointed somewhere other than the round everybody else is
  // playing — including at nothing at all, which is what an empty state hands
  // us and is exactly when the crown is the only way forward. Every affordance
  // here changes when this is true; nothing about the control should read the
  // same in both states.
  const offRound = current == null || current.round !== currentRound;

  return (
    <>
      {/* No wrapper and no margin: the caller places this, and today the
          caller portals it into a box in the app header. */}
      <button onClick={() => setOpen(true)}
        title={current == null
          ? "Open a round to score"
          : offRound
            ? `Round ${current.round} · ${label(current)} — not the live round`
            : `${label(current)} — score another group`}
        aria-label={current == null
          ? "Open a round to score"
          : offRound
            ? `Round ${current.round}, ${label(current)}. Not the live round. Change round or group.`
            : `${label(current)}. Score another group`}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 2, flexShrink: 0, minWidth: 38,
          padding: "3px 7px", borderRadius: 8, cursor: "pointer", fontFamily: FONT,
          // Off-round is a warn-tinted chip, not a neutral one. The banner on
          // the screen says it in words; this says it in the corner of the eye,
          // which is where a director glancing up actually looks.
          background: offRound ? `${BC.warn}${ALPHA.wash}` : BC.card,
          border: `1px solid ${offRound ? BC.warn : BC.bdr}`,
        }}>
        {/* The crown is the tell that this control is not what everyone else
            on the course is looking at; the line under it is where the screen
            is currently pointed — carrying the ROUND too as soon as that is
            not the one everybody assumes. */}
        <span aria-hidden="true" style={{ fontSize: FS.label, lineHeight: 1 }}>👑</span>
        <span aria-hidden="true" style={{
          fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.5, lineHeight: 1,
          color: offRound ? BC.warn : BC.t2,
        }}>
          {current == null ? "OPEN" : offRound ? `R${current.round}·${shortLabel(current)}` : shortLabel(current)}
        </span>
      </button>

      {open && (
        <Popup onClose={() => setOpen(false)} maxWidth={420} padding={0} portal showClose>
          <div style={{ fontFamily: FONT, padding: "16px 16px 8px" }}>
            <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, letterSpacing: 0.5 }}>
              Score another group
            </div>
            {/* The consequence, once. The second half — that a score fixed in
                an older round moves the board straight away — is said again by
                the banner on the scoring screen you land on, in front of the
                round it applies to. */}
            <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.45, marginTop: 3 }}>
              Anything you enter is posted as that group&apos;s score, exactly as
              if they had entered it themselves.
            </div>
          </div>
          <div style={{ padding: "0 10px 14px", maxHeight: "60vh", overflowY: "auto", overscrollBehavior: "contain" }}>
            {rounds.map(([round, ms]) => {
              const state = roundLockState(roundLocks, round);
              const live = round === currentRound;
              return (
                <div key={round}>
                  {/* The round header is the thing that keeps this list honest.
                      A director scrolling past "ROUND 2 · FINAL" into a group
                      has been told twice before they tap. */}
                  <div style={{
                    display: "flex", alignItems: "baseline", gap: 6,
                    padding: "12px 4px 2px", fontFamily: FONT,
                  }}>
                    <span style={{ fontSize: FS.small, fontWeight: 800, letterSpacing: 1, color: BC.t2 }}>
                      ROUND {round}
                    </span>
                    <span style={{
                      fontSize: FS.micro, fontWeight: 800, letterSpacing: 1,
                      color: live ? BC.green : state === LOCK_FINAL ? BC.warn : BC.t3,
                    }}>
                      {live ? "LIVE" : LOCK_STATE_LABEL[state]}
                    </span>
                  </div>
                  {ms.map(m => {
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
                            {label(m)}
                          </span>
                          {/* Their own match, marked — a director scoring their
                              own group is the ordinary case and should be one
                              tap back. */}
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
              );
            })}
          </div>
        </Popup>
      )}
    </>
  );
}
