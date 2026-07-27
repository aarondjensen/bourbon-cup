// ══════════════════════════════════════════════════════════════════
//  MatchSetup — the Admin › Matches tab.
// ══════════════════════════════════════════════════════════════════
//
// Two jobs that used to be one, now told apart (see lib/groups.js):
//
//   MATCHES — who plays whom. Built from the two team pools, sized by the
//             round's format.
//   GROUPS  — who tees off together, and when. In a 2-man format a match
//             already IS a foursome, so this half runs itself and the
//             director never has to look at it. In Singles or a team
//             format it is a real decision, so it gets a real editor.
//
// Tee times are the thread between them: the Rounds tab sets the first tee
// and the spread, group i goes off at slot i, and every match inherits the
// time of the group its players ride in. A match with no group has no tee
// time, and this tab says so rather than letting it ship silently.
//
// Which is also where the grouping is done. When a match fits in one group,
// its row in the match list carries a picker — pick the group and the match
// takes that group's tee time, with "+ New group" opening the next tee slot.
// That is the way a Singles draw is actually made ("M3 and M4 ride together
// off 8:40"), so it lives on the matches. Moving individual players between
// groups is the fix-up underneath it, not the main road.

import { useState } from "react";
import { BC } from "../theme";
import { FORMATS } from "../constants";
import { TOURNAMENT_ID, editionDocId } from "../firebase";
import { getRoundCH, getRoundHandicapMode, lockForRound } from "../scoring";
import {
  GROUP_TARGET, GROUP_MAX,
  autoBuildGroups, expandTeeTimes, teeTimeList, joinTeeTimes, teeInterval,
  parseTeeTime, formatTeeTime, matchPlayers, matchSeq, formatPerSide, isFoursomeFormat,
  teeTimeForMatch, groupIndexForMatch, assignMatchToGroup, matchesInGroup,
  groupIssues, hasGroupIssues,
  orderMatchesForRound, canonicalMatchOrder,
} from "../lib/groups";
import {
  matchScoreImpact, orphanedScores, incomingScores, describeScored,
} from "../lib/scoreGuard";

const ROUNDS = [1, 2, 3, 4];
const FONT = "'Montserrat', sans-serif";
// The Rounds tab renders four tee-time boxes, so the round document always
// carries at least four slots. Never write back fewer or those boxes empty.
const MIN_TIME_SLOTS = 4;

const cardStyle = { background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}` };
const sectionLabel = { fontSize: 10, color: BC.gold, fontWeight: 700, letterSpacing: 1, marginBottom: 8 };
const miniBtn = {
  padding: "5px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: "pointer",
  background: "transparent", border: `1px solid ${BC.amber}66`, color: BC.amber, fontFamily: FONT,
};
// Times are stored bare ("8:30") but older documents may carry a suffix;
// the boxes read cleaner without it and parseTeeTime doesn't need it.
const stripAMPM = (s) => (s ? String(s).replace(/\s*(AM|PM)/gi, "").trim() : s);

const xBtn = {
  fontSize: 9, padding: "3px 7px", borderRadius: 6, border: `1px solid ${BC.danger}22`,
  background: "transparent", color: BC.danger, cursor: "pointer", flexShrink: 0, fontFamily: FONT,
};

// The group picker on a match row. A native select, because on a phone that
// is a proper wheel picker rather than a menu to aim at. fontSize must be 16
// or iOS Safari zooms the page in on focus and never zooms back, so it is
// drawn at 16 and scaled down to the row's size — the same trick the
// tee-time boxes use, with the negative margin taking back the width the
// transform leaves behind (200 × 0.25).
const groupSelect = (ok) => ({
  width: 200, marginRight: -50, transform: "scale(0.75)", transformOrigin: "left center",
  padding: "4px 5px", borderRadius: 7, background: BC.inp, boxSizing: "border-box",
  border: `1px solid ${ok ? BC.amber + "55" : BC.danger + "66"}`,
  color: ok ? BC.amber : BC.danger,
  fontSize: 16, fontWeight: 700, fontFamily: FONT, outline: "none", cursor: "pointer",
});

export function MatchSetup({
  round, setRound,
  tRounds, courses, tPlayers, matches, teams, teamNames,
  hcpOverrides, teeAssignments, roundLocks,
  storedGroups, onSaveGroups,
  onSetRound, onSetMatch, notify, confirm,
  // The round's posted scores, and the way to erase a stale card. Both are
  // here for one reason: scores are keyed by player+round, not by match (see
  // lib/scoreGuard), so this tab is the one place a director can destroy a
  // morning's work without the app ever mentioning scores. It mentions them.
  holeData = {}, onDiscardRoundScores,
}) {
  const [teamASel, setTeamASel] = useState([]);
  const [teamBSel, setTeamBSel] = useState([]);
  // The player picked up for a move. Tap a chip to lift, tap a group to
  // drop. Two taps beats drag-and-drop on a phone, and it is reversible —
  // tapping the lifted chip again puts them back down.
  const [held, setHeld] = useState(null);
  // Tee-time boxes are edited locally and committed on blur. Writing per
  // keystroke would put a Firestore round-document write behind every digit.
  const [timeDraft, setTimeDraft] = useState({});

  const tr = tRounds.find(t => t.round_number === round);
  const mLock = lockForRound(roundLocks, round);
  const course = courses.find(c => c.id === (mLock?.course_id || tr?.course_id));
  const hcpMode = getRoundHandicapMode({ roundLocks, round, tRounds });
  const fmt = FORMATS.find(f => f.id === tr?.format);
  const perSide = formatPerSide(tr?.format);
  const autoFoursomes = isFoursomeFormat(tr?.format);

  const rndMatches = matches.filter(m => m.round === round);

  // Groups the director has actually saved, versus the ones a 2-man format
  // implies. A 2v2 round that has never been touched here still shows its
  // foursomes and still gets tee times — that is the whole point of calling
  // those formats obvious. The first edit materializes them.
  const isDerived = !storedGroups && autoFoursomes;
  const groups = storedGroups || (isDerived ? autoBuildGroups({ formatId: tr?.format, matches: rndMatches }) : []);

  const rawTimes = teeTimeList(tr);
  const times = expandTeeTimes(rawTimes, Math.max(groups.length, MIN_TIME_SLOTS));
  const interval = teeInterval(rawTimes);
  const firstTee = (rawTimes[0] || "").trim();

  const issues = groupIssues({ groups, matches: rndMatches });
  const flagged = hasGroupIssues(issues);

  // ── The score guard ──────────────────────────────────────────────
  // A finalized round's draw IS part of the result, so it is not edited from
  // here at all — the way back is the Scoring tab's Reopen, which is a
  // deliberate act with its own confirmation rather than a side effect of
  // tidying up the matches list.
  const roundFinal = !!mLock?.final;
  // Scores posted in this round that no match accounts for. Invisible
  // everywhere else in the app — that is exactly why they are shown here.
  const orphans = orphanedScores({ holeData, matches, round, players: tPlayers });

  // A match that fits inside one group is grouped from its own row in the
  // match list — pick the group, take that group's tee time. A 2-man format
  // has nothing to pick (the match is the foursome) and a match too big for
  // one group genuinely spans several, so both are grouped player by player.
  const canPickGroup = (m) => !autoFoursomes && matchPlayers(m).length <= GROUP_MAX;
  const anyPickable = rndMatches.some(canPickGroup);

  // The round's matches in the order they go off, which is the order their
  // tournament-wide numbers run in. Only the LISTING is reordered:
  // `rndMatches` keeps its arrival order everywhere else, because derived
  // groups follow the match order and tee times follow the groups — sorting
  // by tee time upstream of that would feed the order back into itself.
  const orderedMatches = orderMatchesForRound({ matches: rndMatches, groups, times });

  const nameOf = (pid) => tPlayers.find(p => p.player_id === pid)?.name || pid;
  const shortOf = (pid) => nameOf(pid).split(" ")[0] || pid;
  const teamOf = (pid) => tPlayers.find(p => p.player_id === pid)?.team;

  // CH preview, routed through the same resolver the scoring engine uses so
  // that once a round is locked this panel shows the strokes that will
  // ACTUALLY be played rather than a live re-derivation that would disagree
  // with the leaderboard.
  const getPlayerCH = (pid) => getRoundCH({
    roundLocks, round, pid, players: tPlayers,
    course, chOverrides: hcpOverrides, teeAssignments, roundTee: tr?.tee_box,
  });

  // ── Writes ───────────────────────────────────────────────────────
  // Empty groups are kept, not pruned: a group's tee time is its POSITION in
  // the round's time list, so silently dropping one would shift every later
  // group onto the wrong time. Removing a group is an explicit action.
  const saveGroups = (next) => onSaveGroups(round, next);

  // Tee times live on the round document as a pipe-delimited list. db.upsert
  // merges, so this touches that one field and nothing else.
  const saveTimes = (next) => onSetRound({
    id: editionDocId(`bc_round_${round}`),
    tournament_id: TOURNAMENT_ID,
    round_number: round,
    tee_time: joinTeeTimes(next.slice(0, Math.max(groups.length, MIN_TIME_SLOTS))),
  });

  const commitGroupTime = (i, value) => {
    setTimeDraft(d => { const n = { ...d }; delete n[i]; return n; });
    const mins = parseTeeTime(value);
    const next = [...times];
    next[i] = mins == null ? value.trim() : formatTeeTime(mins);
    saveTimes(next);
  };

  // Re-space every group off the first tee — the one-tap fix after adding,
  // deleting, or reordering groups.
  const respace = () => {
    const first = parseTeeTime(firstTee);
    if (first == null) { notify("Set a first tee time on the Rounds tab", "error"); return; }
    saveTimes(Array.from({ length: Math.max(groups.length, MIN_TIME_SLOTS) },
      (_, i) => formatTeeTime(first + interval * i)));
    notify(`Tee times re-spaced ${interval} min apart`, "success");
  };

  const buildGroups = async () => {
    if (!rndMatches.length) { notify("Create the round's matches first", "error"); return; }
    if (storedGroups?.length && !(await confirm({
      title: "Rebuild groups?",
      message: "This replaces the current groups for this round. Tee times are kept.",
      confirmLabel: "Rebuild",
    }))) return;
    // Canonical match order, so the groups this WRITES are the same ones the
    // tab was already showing when they were only implied (roundPlaySetup).
    const built = autoBuildGroups({ formatId: tr?.format, matches: canonicalMatchOrder(rndMatches) });
    saveGroups(built);
    notify(`Built ${built.length} group${built.length !== 1 ? "s" : ""}`, "success");
  };

  // gi < 0 drops the held player out of every group (back to unassigned).
  const moveHeldTo = (gi) => {
    if (!held) return;
    const next = groups.map(g => g.filter(p => p !== held));
    if (gi >= 0) next[gi] = [...next[gi], held];
    saveGroups(next);
    setHeld(null);
  };

  const addGroup = () => saveGroups([...groups.map(g => [...g]), []]);

  // Send a whole match off with one group, from the match list. This is the
  // way a Singles or team round actually gets drawn — the decision is "these
  // two matches ride together", not "these four players do" — so it happens
  // where the matches are, and lifting chips stays for the odd fix-up.
  // gi === groups.length is the picker's "+ New group" option.
  const setMatchGroup = (m, gi) => saveGroups(assignMatchToGroup({ groups, match: m, gi }));

  const removeGroup = async (gi) => {
    if (groups[gi].length && !(await confirm({
      title: `Remove Group ${gi + 1}?`,
      message: "Its players go back to the unassigned pool. Later groups move up a tee time.",
      confirmLabel: "Remove", destructive: true,
    }))) return;
    saveGroups(groups.filter((_, i) => i !== gi));
  };

  const createMatch = async () => {
    if (!teamASel.length || !teamBSel.length) { notify("Select players for both teams", "error"); return; }
    if (roundFinal) { notify(`Round ${round} is final — reopen it on Scoring to change the draw`, "error"); return; }
    // The mirror of the delete hazard. A player's holes live on the player
    // and the round, so a new match does not start empty when its players
    // have already posted — it opens with those holes on its card. Re-drawing
    // a match you just deleted is exactly when you want that; pairing someone
    // differently is exactly when you don't.
    const carried = incomingScores({ holeData, round, pids: [...teamASel, ...teamBSel] });
    if (carried.length && !(await confirm({
      eyebrow: `Round ${round}`,
      title: "These players already have scores this round",
      message: [
        `${describeScored(carried, nameOf)} — holes already posted in Round ${round}.`,
        "",
        "Scores belong to the player and the round, not to the match, so this match opens with those holes already on it.",
        "",
        "That is what you want re-drawing a match you deleted. If this is a different pairing, discard the stale card first — see “Scores with no match” below.",
      ].join("\n"),
      confirmLabel: "Create anyway",
    }))) return;
    await onSetMatch({
      id: `bc_match_r${round}_${teamASel.join("_")}_vs_${teamBSel.join("_")}`,
      tournament_id: TOURNAMENT_ID,
      round,
      teamA: teamASel,
      teamB: teamBSel,
      teamANames: teamASel.map(nameOf),
      teamBNames: teamBSel.map(nameOf),
      // `nassau` and `scoring_type` are deliberately NOT written here. They
      // belong to the round, and a copy on the match only ever goes stale the
      // moment the director changes the round's setup.
    });
    // A 2-man format's match is its own foursome, so once this round has
    // saved groups a new match brings one with it instead of landing in the
    // unassigned pool for no reason.
    if (autoFoursomes && storedGroups) {
      saveGroups([...storedGroups, matchSeq({ teamA: teamASel, teamB: teamBSel })]);
    }
    setTeamASel([]); setTeamBSel([]);
    notify("Match created!", "success");
  };

  // Deleting a match used to be the only unconfirmed destructive control in
  // the admin console — one tap on a ✕ the size of a fingernail, sitting in a
  // list you scroll past to get to the groups. It is also the one with the
  // longest tail (scores hidden, tournament-wide match numbers renumbered,
  // the round's progress count reset to zero), so it now always asks, and
  // asks LOUDER when there are scores behind it.
  const deleteMatch = async (m) => {
    if (roundFinal) {
      notify(`Round ${round} is final — reopen it on Scoring to change the draw`, "error");
      return;
    }
    const impact = matchScoreImpact({ match: m, holeData });
    const label = `M${m.matchNumber ?? "?"}`;
    const vs = `${m.teamANames?.join(" / ")} vs ${m.teamBNames?.join(" / ")}`;
    const ok = await confirm(impact.hasScores ? {
      eyebrow: `${label} · Round ${round}`,
      title: `Delete a match with ${impact.holes} hole${impact.holes === 1 ? "" : "s"} scored?`,
      message: [
        `${vs}`,
        `Scored: ${describeScored(impact.scored, nameOf)}.`,
        "",
        "The scores are NOT erased — they are keyed to the player and the round, not to this match. Deleting hides them from the leaderboard, the cards and the round's progress while leaving every one of them in place.",
        "",
        "Re-draw the same pairing and they all come back. Re-draw these players differently and the holes follow them into whatever match they land in.",
      ].join("\n"),
      confirmLabel: "Delete anyway",
      destructive: true,
    } : {
      eyebrow: `${label} · Round ${round}`,
      title: "Delete this match?",
      message: `${vs}\n\nNo scores are attached. Later matches renumber to close the gap.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await onSetMatch({ ...m, _delete: true });
    // Players of a deleted match have nothing left to tee off for.
    if (storedGroups) {
      const gone = new Set(matchPlayers(m));
      saveGroups(storedGroups.map(g => g.filter(p => !gone.has(p))));
    }
    if (impact.hasScores) {
      notify(`${label} deleted — ${impact.holes} scored hole${impact.holes === 1 ? "" : "s"} kept, see below`, "error");
    }
  };

  // The one way to actually erase scores, and the only irreversible button on
  // this tab. It exists because the delete above is deliberately NOT
  // destructive: without a way to take a stale card out of a round, the only
  // route back from a bad draw is a pairing that silently inherits somebody
  // else's morning.
  const discardOrphan = async (pid, holes) => {
    if (roundFinal) {
      notify(`Round ${round} is final — reopen it on Scoring first`, "error");
      return;
    }
    if (!(await confirm({
      eyebrow: `Round ${round}`,
      title: `Erase ${nameOf(pid)}'s ${holes} hole${holes === 1 ? "" : "s"}?`,
      message: [
        `This deletes the scores themselves.`,
        "",
        "Unlike deleting a match, it cannot be undone by re-drawing — the holes would have to be typed in again.",
      ].join("\n"),
      confirmLabel: "Erase scores",
      destructive: true,
    }))) return;
    const n = await onDiscardRoundScores(round, pid);
    notify(`Erased ${n} hole${n === 1 ? "" : "s"} for ${nameOf(pid)}`, "success");
  };

  // ── Pools ────────────────────────────────────────────────────────
  // A player plays one match per round, so anyone already committed drops
  // out of the pool. An in-progress selection stays visible so it can be
  // tapped off again.
  const matchedPids = new Set(rndMatches.flatMap(matchPlayers));
  const poolFor = (tid, sel) => tPlayers
    .filter(p => p.team === tid)
    .filter(p => !matchedPids.has(p.player_id) || sel.includes(p.player_id));

  const strokes = (() => {
    const all = [...teamASel, ...teamBSel];
    if (all.length < 2) return null;
    const chs = all.map(pid => ({ pid, ch: getPlayerCH(pid) }));
    const minCH = Math.min(...chs.map(c => c.ch));
    return chs.map(({ pid, ch }) => ({ pid, strokes: hcpMode === "full" ? ch : ch - minCH }));
  })();

  const sizeHint = perSide ? `${perSide} per side` : "any number per side";
  const sizeOff = !!perSide && (teamASel.length > perSide || teamBSel.length > perSide);

  // ── Render ───────────────────────────────────────────────────────
  const playerChip = (pid, { dim } = {}) => {
    const team = teams[teamOf(pid)] || teams.B;
    const lifted = held === pid;
    return (
      <button key={pid} onClick={() => setHeld(lifted ? null : pid)} style={{
        padding: "5px 9px", borderRadius: 8, cursor: "pointer", fontFamily: FONT,
        fontSize: 11, fontWeight: 700, textAlign: "left",
        background: lifted ? BC.amber : team.color + (dim ? "22" : "44"),
        border: `1.5px solid ${lifted ? BC.amber : team.accent + "55"}`,
        color: lifted ? "#0a0804" : team.accent,
      }}>{shortOf(pid)}</button>
    );
  };

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Round tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {ROUNDS.map(r => (
          <button key={r} onClick={() => { setRound(r); setTeamASel([]); setTeamBSel([]); setHeld(null); setTimeDraft({}); }} style={{
            flex: 1, padding: "7px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
            background: round === r ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : BC.card,
            border: `1px solid ${round === r ? "transparent" : BC.bdr}`,
            color: round === r ? "#0a0804" : BC.t2, fontFamily: FONT,
          }}>Rd {r}</button>
        ))}
      </div>

      {/* Round context — course, format, first tee. All set on other tabs;
          repeated here because you cannot sensibly build a draw without it
          in front of you. */}
      <div style={{ ...cardStyle, padding: "9px 12px", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: BC.t1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {course?.name || "Course TBD"}
          </div>
          <div style={{ fontSize: 10, color: firstTee ? BC.amber : BC.danger, fontWeight: 700, flexShrink: 0 }}>
            {firstTee ? `1st tee ${firstTee}` : "No tee time set"}
          </div>
        </div>
        <div style={{ fontSize: 10, color: BC.t3, marginTop: 3 }}>
          {fmt?.label || "Format TBD"} · {sizeHint}{autoFoursomes ? " · each match is a foursome" : ""}
        </div>
      </div>

      {/* A final round's draw is part of its result. Say so where the draw is
          edited, so a blocked ✕ reads as a rule rather than a bug. */}
      {roundFinal && (
        <div style={{
          ...cardStyle, padding: "9px 12px", marginBottom: 10,
          border: `1px solid ${BC.amber}55`, fontSize: 10, color: BC.t2, lineHeight: 1.45,
        }}>
          <span style={{ fontWeight: 800, color: BC.amber, letterSpacing: 1 }}>ROUND {round} IS FINAL. </span>
          Its draw is locked to its result. Reopen the round on the Scoring tab to change matches.
        </div>
      )}

      {/* ── Match builder ── */}
      <div style={sectionLabel}>BUILD A MATCH</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        {[["A", teamASel, setTeamASel], ["B", teamBSel, setTeamBSel]].map(([tid, sel, setSel]) => {
          const team = teams[tid];
          const roster = tPlayers.filter(p => p.team === tid);
          const pool = poolFor(tid, sel);
          return (
            <div key={tid}>
              <div style={{ fontSize: 9, fontWeight: 700, color: team.accent, letterSpacing: 1, marginBottom: 5 }}>
                {teamNames?.[tid]}{perSide ? ` · ${sel.length}/${perSide}` : ""}
              </div>
              {pool.length === 0 && (
                <div style={{ fontSize: 10, color: BC.t3, padding: "7px 8px", borderRadius: 8, border: `1px dashed ${BC.bdr}`, textAlign: "center" }}>
                  {roster.length ? `All matched in Rd ${round}` : "No players"}
                </div>
              )}
              {pool.map(p => {
                const on = sel.includes(p.player_id);
                return (
                  <button key={p.player_id} onClick={() => setSel(prev => on ? prev.filter(x => x !== p.player_id) : [...prev, p.player_id])} style={{
                    width: "100%", padding: "7px 8px", marginBottom: 3, borderRadius: 8, cursor: "pointer", textAlign: "left",
                    background: on ? team.color + "55" : BC.inp,
                    border: `1.5px solid ${on ? team.accent : BC.bdr}`,
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontFamily: FONT,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: on ? team.accent : BC.t2, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: BC.t3, flexShrink: 0 }}>CH {getPlayerCH(p.player_id)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {sizeOff && (
        <div style={{ fontSize: 10, color: BC.danger, marginBottom: 8, textAlign: "center" }}>
          {fmt?.label} is {sizeHint} — check the selection.
        </div>
      )}

      {strokes && (
        <div style={{ ...cardStyle, padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: BC.t3, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
            STROKE SITUATION · {hcpMode === "low_man" ? "Play Off Low Man" : "Full Strokes"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {strokes.map(({ pid, strokes: s }) => {
              const team = teams[teamOf(pid)] || teams.B;
              return (
                <div key={pid} style={{ background: team.color + "33", border: `1px solid ${team.accent}44`, borderRadius: 8, padding: "5px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: team.accent }}>{shortOf(pid)}</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: s === 0 ? BC.gold : BC.t1 }}>{s === 0 ? "Scratch" : `+${s}`}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {teamASel.length > 0 && teamBSel.length > 0 && (
        <button onClick={createMatch} style={{
          width: "100%", padding: "10px 20px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 700,
          cursor: "pointer", background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`,
          color: "#0a0804", marginBottom: 14, fontFamily: FONT,
        }}>
          Create Match — {teamASel.map(shortOf).join("/")} vs {teamBSel.map(shortOf).join("/")}
        </button>
      )}

      {/* ── This round's matches ── */}
      <div style={sectionLabel}>ROUND {round} MATCHES{fmt ? ` · ${fmt.label}` : ""}</div>
      {rndMatches.length === 0 && (
        <div style={{ fontSize: 10, color: BC.t3, padding: "10px 12px", borderRadius: 10, border: `1px dashed ${BC.bdr}`, textAlign: "center", marginBottom: 14 }}>
          No matches yet for Rd {round}
        </div>
      )}
      {orderedMatches.map(m => {
        const t = teeTimeForMatch({ groups, times, match: m });
        const pids = matchPlayers(m);
        // Three ways to have no single tee time, and they need different
        // things done about them: a match bigger than a foursome legitimately
        // spans groups (that's a team match, not a problem), a small one that
        // spans them has its opponents playing apart, and one nobody has
        // grouped simply has no time yet.
        const spans = pids.length > GROUP_TARGET;
        const grouped = pids.filter(p => groups.some(g => g.includes(p))).length;
        const status = t ? `TEES OFF ${t}`
          : spans ? "ACROSS SEVERAL GROUPS — SEE BELOW"
          : grouped ? "SPLIT ACROSS GROUPS — OPPONENTS MUST RIDE TOGETHER"
          : "NO TEE TIME — NOT GROUPED";
        // Where a match can be picked into a group, the picker REPLACES the
        // status line — choosing the group is choosing the tee time, so the
        // control says everything the line used to.
        const canPick = canPickGroup(m);
        const gi = groupIndexForMatch({ groups, match: m });
        // What is riding on this row. Shown before the ✕ rather than only in
        // the confirmation, so a director scanning the list can see which
        // matches are already being played without tapping anything.
        const impact = matchScoreImpact({ match: m, holeData });
        const pickNote = t ? ""
          : gi >= 0 ? "NO TEE TIME SET"
          : grouped ? "OPPONENTS SPLIT UP"
          : "NEEDS A GROUP";
        return (
          <div key={m.id} style={{ ...cardStyle, borderRadius: 10, padding: "8px 12px", marginBottom: 5, display: "flex", alignItems: "center", gap: 8 }}>
            {/* The match's number in the TOURNAMENT, counted across every
                round (Round 2's opener is M5 when Round 1 had four matches).
                Same gold-chip idiom as the G1 label on the groups below,
                since it is doing the same job for matches. */}
            <span style={{ fontSize: 10, fontWeight: 800, color: BC.gold, letterSpacing: 0.5, flexShrink: 0, minWidth: 20 }}>
              M{m.matchNumber ?? "?"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: teams.A.accent + "99", fontWeight: 600 }}>{m.teamANames?.join(" / ")}</span>
                <span style={{ color: BC.t3 }}> vs </span>
                <span style={{ color: teams.B.accent + "99", fontWeight: 600 }}>{m.teamBNames?.join(" / ")}</span>
              </div>
              {canPick ? (
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <select
                    value={gi >= 0 ? String(gi) : ""}
                    onChange={e => setMatchGroup(m, e.target.value === "" ? -1 : parseInt(e.target.value, 10))}
                    aria-label={`Group for match ${m.matchNumber ?? ""}`}
                    style={groupSelect(!!t)}
                  >
                    <option value="">— No group</option>
                    {groups.map((g, i) => (
                      <option key={i} value={i}>
                        G{i + 1}{times[i] ? ` · ${stripAMPM(times[i])}` : ""} · {g.length}/{GROUP_TARGET}
                      </option>
                    ))}
                    <option value={groups.length}>+ New group</option>
                  </select>
                  {pickNote && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: BC.danger,
                      minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{pickNote}</span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 9, marginTop: 3, fontWeight: 700, letterSpacing: 0.5, color: t ? BC.amber : spans ? BC.t3 : BC.danger }}>
                  {status}
                </div>
              )}
            </div>
            {impact.hasScores && (
              <span title={`${impact.holes} holes scored`} style={{
                flexShrink: 0, fontSize: 8, fontWeight: 800, letterSpacing: 0.5,
                padding: "3px 6px", borderRadius: 6, whiteSpace: "nowrap",
                color: BC.green, border: `1px solid ${BC.green}55`, background: `${BC.green}14`,
              }}>{impact.holes} SCORED</span>
            )}
            <button onClick={() => deleteMatch(m)} style={xBtn}>✕</button>
          </div>
        );
      })}

      {/* ── Scores with no match ──
          The consequence of the delete made visible. These holes are live in
          the database and counted by nothing: not the leaderboard, not the
          round's progress, not the finalize card. Without this panel the only
          symptom is a round that looks emptier than the morning actually was. */}
      {orphans.length > 0 && (
        <div style={{ ...cardStyle, padding: "10px 12px", marginBottom: 14, border: `1px solid ${BC.danger}66` }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: BC.danger, letterSpacing: 1, marginBottom: 6 }}>
            SCORES WITH NO MATCH · ROUND {round}
          </div>
          <div style={{ fontSize: 10, color: BC.t2, lineHeight: 1.45, marginBottom: 9 }}>
            Posted in Round {round}, but no match this round accounts for them — so nothing counts them.
            Draw these players back into a match and their holes come back with them. Erase only if the round is genuinely being re-played.
          </div>
          {orphans.map(({ pid, holes }) => (
            <div key={pid} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: BC.t1, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {nameOf(pid)}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: BC.t3, flexShrink: 0 }}>
                {holes} hole{holes === 1 ? "" : "s"}
              </span>
              {onDiscardRoundScores && (
                <button onClick={() => discardOrphan(pid, holes)} style={{ ...miniBtn, borderColor: `${BC.danger}66`, color: BC.danger }}>
                  Erase
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Groups & tee times ── */}
      <div style={{ ...sectionLabel, marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span>GROUPS &amp; TEE TIMES</span>
        <span style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <button onClick={buildGroups} style={miniBtn}>Auto-build</button>
          {groups.length > 0 && <button onClick={respace} style={miniBtn}>Re-space</button>}
        </span>
      </div>

      <div style={{ fontSize: 10, color: BC.t3, marginBottom: 8, lineHeight: 1.45 }}>
        {autoFoursomes
          ? `A ${fmt?.label} match is a foursome, so groups follow the matches. Times run off the first tee (${firstTee || "unset"}), ${interval} min apart.`
          : `${fmt?.label || "This format"} is not a foursome on its own — set who goes off together. ${anyPickable ? "Send a whole match off with a group from the list above, or tap" : "Tap"} a player here to lift them${anyPickable ? " and" : ", then"} tap a group to drop them in.`}
      </div>

      {isDerived && groups.length > 0 && (
        <div style={{ fontSize: 9, color: BC.t3, marginBottom: 6, fontStyle: "italic" }}>
          Following the matches automatically — edit anything below to take over.
        </div>
      )}

      {groups.length === 0 && (
        <div style={{ fontSize: 10, color: BC.t3, padding: 12, borderRadius: 10, border: `1px dashed ${BC.bdr}`, textAlign: "center", marginBottom: 8 }}>
          No groups yet. {!rndMatches.length ? "Create matches first."
            : anyPickable ? "Auto-build to start from the matches, or send one off with “+ New group” above."
            : "Auto-build to start from the matches."}
        </div>
      )}

      {groups.map((g, gi) => {
        const over = g.length > GROUP_MAX;
        // Which matches ride here. In Singles a foursome is two matches, so
        // naming them is how this card reads back what the pickers above set
        // — the player count alone can't tell a proper pairing from four
        // players who happen to share a tee time.
        const rides = matchesInGroup({ group: g, matches: orderedMatches })
          .map(m => `M${m.matchNumber ?? "?"}`).join(" · ");
        return (
          <div key={gi} style={{
            ...cardStyle, padding: "9px 11px", marginBottom: 6,
            border: `1px solid ${held ? BC.amber + "88" : over ? BC.danger + "66" : BC.bdr}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: g.length ? 7 : 0 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: BC.gold, letterSpacing: 1, flexShrink: 0 }}>G{gi + 1}</span>
              <input
                value={timeDraft[gi] ?? stripAMPM(times[gi]) ?? ""}
                onChange={e => setTimeDraft(d => ({ ...d, [gi]: e.target.value }))}
                onBlur={e => commitGroupTime(gi, e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                placeholder="—"
                inputMode="numeric"
                aria-label={`Group ${gi + 1} tee time`}
                // fontSize must be 16 or iOS Safari zooms the whole page in on
                // focus and never zooms back; the transform scales it back to
                // the size the rest of the row is drawn at. Same trick the
                // Rounds tab's tee-time boxes use.
                style={{
                  width: 76, padding: "5px 6px", background: BC.inp, border: `1px solid ${BC.bdr}`,
                  borderRadius: 7, color: BC.t1, fontSize: 16, textAlign: "center",
                  outline: "none", fontFamily: FONT, flexShrink: 0, boxSizing: "border-box",
                  transform: "scale(0.8)", transformOrigin: "left center", marginRight: -14,
                }}
              />
              <span style={{
                fontSize: 9, color: over ? BC.danger : BC.t3, fontWeight: 700, flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {rides || `${g.length} player${g.length !== 1 ? "s" : ""}`}{over ? " · too many" : ""}
              </span>
              {held
                ? <button onClick={() => moveHeldTo(gi)} style={{ ...miniBtn, padding: "4px 8px" }}>Move {shortOf(held)} here</button>
                : <button onClick={() => removeGroup(gi)} style={xBtn}>✕</button>}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {g.map(pid => playerChip(pid))}
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button onClick={addGroup} style={{ ...miniBtn, flex: 1, padding: "8px 10px" }}>+ Add group</button>
        {held && (
          <button onClick={() => moveHeldTo(-1)} style={{ ...miniBtn, flex: 1, padding: "8px 10px", borderColor: `${BC.danger}66`, color: BC.danger }}>
            Ungroup {shortOf(held)}
          </button>
        )}
      </div>

      {held && (
        <div style={{ fontSize: 10, color: BC.t3, textAlign: "center", marginBottom: 8 }}>
          {nameOf(held)} lifted — tap a group to drop them in, or tap them again to cancel.
        </div>
      )}

      {/* Players with a match but nowhere to tee off. */}
      {issues.unassigned.length > 0 && (
        <div style={{ ...cardStyle, padding: "9px 11px", marginBottom: 8, border: `1px solid ${BC.danger}55` }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: BC.danger, letterSpacing: 1, marginBottom: 7 }}>
            NOT IN A GROUP — NO TEE TIME
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {issues.unassigned.map(pid => playerChip(pid, { dim: true }))}
          </div>
        </div>
      )}

      {/* Everything else worth saying about the draw, in one place. */}
      {flagged && (
        <div style={{ ...cardStyle, padding: "9px 11px", marginBottom: 8, border: `1px solid ${BC.amber}44` }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: BC.amber, letterSpacing: 1, marginBottom: 6 }}>CHECK</div>
          {issues.split.map(m => (
            <div key={m.id} style={{ fontSize: 10, color: BC.t2, marginBottom: 3 }}>
              · {m.teamANames?.join("/")} vs {m.teamBNames?.join("/")} is split across groups — opponents tee off together.
            </div>
          ))}
          {issues.duplicated.map(pid => (
            <div key={pid} style={{ fontSize: 10, color: BC.t2, marginBottom: 3 }}>· {nameOf(pid)} is in more than one group.</div>
          ))}
          {issues.unmatched.map(pid => (
            <div key={pid} style={{ fontSize: 10, color: BC.t2, marginBottom: 3 }}>· {nameOf(pid)} is grouped but has no match this round.</div>
          ))}
          {issues.oversized.map(({ i, n }) => (
            <div key={i} style={{ fontSize: 10, color: BC.t2, marginBottom: 3 }}>· Group {i + 1} has {n} players.</div>
          ))}
          {issues.unassigned.length > 0 && (
            <div style={{ fontSize: 10, color: BC.t2 }}>
              · {issues.unassigned.length} player{issues.unassigned.length !== 1 ? "s" : ""} without a tee time.
            </div>
          )}
        </div>
      )}

      {!flagged && groups.length > 0 && rndMatches.length > 0 && (
        <div style={{ fontSize: 10, color: BC.amber, textAlign: "center", marginBottom: 8, fontWeight: 700 }}>
          ✓ Every player has a group and a tee time.
        </div>
      )}
    </div>
  );
}

export default MatchSetup;
