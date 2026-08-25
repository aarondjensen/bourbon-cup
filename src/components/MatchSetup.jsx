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
// Tee times are the thread between them, and they belong to the ROUND: the
// Rounds tab writes one box per group (G1–G4), group i goes off at slot i,
// and every match inherits the time of the group its players ride in. So the
// round's tee sheet IS its group list — this tab never creates a group, adds
// one, or removes one, because a group is a tee time and tee times are set on
// the Rounds tab. It only says which match rides in which.
//
// Which is what the picker on each match row does. Pick the group and the
// match takes that group's tee time. That is the way a Singles draw is
// actually made ("M3 and M4 ride together off 8:40"), so it lives on the
// matches. Moving individual players between groups is the fix-up underneath
// it, not the main road.

import { useLayoutEffect, useRef, useState } from "react";
import { BC, FONT, SCRIM, ALPHA, ON_AMBER, FS } from "../theme";
import { SegmentedToggle } from "./ui";
import { playerLookup, sideNames } from "../lib/players";
import { FORMATS } from "../constants";
import { TOURNAMENT_ID, editionDocId } from "../firebase";
import { getRoundCH, getRoundHandicapMode, lockForRound } from "../scoring";
import {
  GROUP_TARGET, TEE_SLOTS,
  autoBuildGroups, expandTeeTimes, teeTimeList,
  stripAMPM, teeSlotCount, padGroups, trimGroups, firstOpenGroup, groupHasRoom,
  matchPlayers, matchSeq, formatPerSide, isFoursomeFormat, formatGroupsByTeam,
  assignPlayersToGroup, groupFitsAfter,
  groupIndexForMatch, assignMatchToGroup, swapMatchIntoGroup,
  groupIssues, hasGroupIssues,
  orderMatchesForRound, canonicalMatchOrder,
} from "../lib/groups";
import {
  matchScoreImpact, orphanedScores, incomingScores, describeScored,
} from "../lib/scoreGuard";


const cardStyle = { background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}` };
const miniBtn = {
  padding: "5px 10px", borderRadius: 8, fontSize: FS.label, fontWeight: 700, cursor: "pointer",
  background: "transparent", border: `1px solid ${BC.amber}${ALPHA.line}`, color: BC.amberInk, fontFamily: FONT,
};
const xBtn = {
  fontSize: FS.label, padding: "3px 7px", borderRadius: 6, border: `1px solid ${BC.danger}${ALPHA.hair}`,
  background: "transparent", color: BC.danger, cursor: "pointer", flexShrink: 0, fontFamily: FONT,
};

export function MatchSetup({
  round, setRound,
  // The tournament's rounds, resolved once by App from the setup count — not
  // derived here and not a literal. This tab used to hold its own
  // `[1, 2, 3, 4]`, which is how a three-round trip got a dead fourth pill
  // and a five-round one could not draw its fifth.
  tournamentRounds,
  tRounds, courses, tPlayers, matches, teams, teamNames,
  hcpOverrides, teeAssignments, roundLocks,
  storedGroups, onSaveGroups,
  onSetMatch, notify, confirm,
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
  // The match being dragged to another tee time: { id, over }, where `over` is
  // the group slot under the finger. Committed on pointerup — nothing is
  // written to Firestore while a finger is still down.
  const [drag, setDrag] = useState(null);
  // Live tee-time section rects, read during a drag to work out which one the
  // finger is over. Kept in a ref rather than state so measuring never
  // triggers a render.
  const sectionRefs = useRef({});
  // ── Swapping, animated ───────────────────────────────────────────
  // A swap rewrites two tee times at once, and without an animation the whole
  // draw just blinks into a new arrangement — you are left checking the M
  // numbers to work out whether the thing you meant to happen happened.
  //
  // So the rows FLIP: their positions are recorded before the write, and on
  // the render that lands the new groups each one is put back where it was and
  // released, which reads as the two rows trading places.
  //
  // offsetTop, not getBoundingClientRect: the dragged row is still carrying
  // its scale(1.02) when the snapshot is taken, and a transformed rect would
  // start the animation a few pixels out. Rows are full width in every card,
  // so vertical is the only axis that moves anyway.
  const rowRefs = useRef({});
  // { tops, key } — `key` is the groups arrangement this snapshot is waiting
  // for, so an unrelated re-render in between (clearing the drag, a Firestore
  // echo) cannot spend it on the wrong frame.
  const pendingFlip = useRef(null);
  // Rows to pulse once they land, so the eye is told WHICH two traded.
  const [swapped, setSwapped] = useState(null);

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
  //
  // canonicalMatchOrder, not arrival order: roundPlaySetup derives the same
  // implied foursomes that way for every other surface, and this tab WRITES
  // these groups — so the two have to agree before that happens.
  const base = storedGroups
    || (autoFoursomes ? autoBuildGroups({ formatId: tr?.format, matches: canonicalMatchOrder(rndMatches) }) : []);
  // The round's TEE TIMES are the groups, so the slots are there from the
  // moment the Rounds tab is filled in — four of them, empty and waiting.
  // Nothing on this tab adds one.
  const groups = padGroups(base, teeSlotCount({ tr, groups: base }));

  // The second half of the FLIP (see the refs above). Runs on the render that
  // brings in the arrangement the snapshot was taken for, puts each row back
  // where it was and lets go — which reads as the two rows trading places.
  // Layout effect, not an effect: it has to run before the browser paints, or
  // the rows are seen in their new slots for a frame first.
  useLayoutEffect(() => {
    const flip = pendingFlip.current;
    if (!flip || flip.key !== JSON.stringify(trimGroups(groups))) return;
    pendingFlip.current = null;
    Object.entries(rowRefs.current).forEach(([id, el]) => {
      const was = flip.tops[id];
      if (!el || was == null) return;
      const dy = was - el.offsetTop;
      if (!dy) return;
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
        { duration: 280, easing: "cubic-bezier(.2,.7,.3,1)" },
      );
    });
  });

  const rawTimes = teeTimeList(tr);
  // The tee times themselves are all this tab needs now: the first tee and the
  // spread were only ever read out in prose that no longer exists, and they
  // live on the Rounds tab, which is where they are set.
  const times = expandTeeTimes(rawTimes, Math.max(groups.length, TEE_SLOTS));

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

  // A format whose match fits inside one foursome — Singles at one player a
  // side, everything 2-man at two — is listed AS the tee sheet: matches sit
  // under the time they go off and are dragged from one time to another. A
  // team format's match holds more players than a group does, so it genuinely
  // spans several and is still split player by player.
  const matchFitsGroup = perSide != null;
  // Team Best Ball: the side plays the side, so what a director builds here is
  // not a match at all — it is a FOURSOME of teammates. There are no opponents
  // to pick, the match is the whole roster either way, and four men is the
  // most that ever walks off a tee.
  const teammateGroups = formatGroupsByTeam(tr?.format);

  // The round's matches in the order they go off, which is the order their
  // tournament-wide numbers run in. Only the LISTING is reordered:
  // `rndMatches` keeps its arrival order everywhere else, because derived
  // groups follow the match order and tee times follow the groups — sorting
  // by tee time upstream of that would feed the order back into itself.
  const orderedMatches = orderMatchesForRound({ matches: rndMatches, groups, times });

  // Each tee time's matches, and the ones that have not landed on a time yet.
  // Membership is the WHOLE match being in one group, so a match split across
  // two lands in `loose` and is visibly off the sheet rather than listed twice.
  const byGroup = groups.map(() => []);
  const loose = [];
  orderedMatches.forEach(m => {
    const gi = groupIndexForMatch({ groups, match: m });
    if (gi >= 0 && gi < byGroup.length) byGroup[gi].push(m); else loose.push(m);
  });

  // What to call a group in prose. Its tee time, because that is now the only
  // name it carries on screen — the G-numbers are gone, so a message that said
  // "G3" would be pointing at a label the director cannot see. Falls back to
  // the slot's position for a round whose times are not set yet.
  const slotName = (gi) => (times[gi] ? stripAMPM(times[gi]) : `tee time ${gi + 1}`);

  const { nameOf, shortOf, teamOf } = playerLookup(tPlayers);

  // CH preview, routed through the same resolver the scoring engine uses so
  // that once a round is locked this panel shows the strokes that will
  // ACTUALLY be played rather than a live re-derivation that would disagree
  // with the leaderboard.
  const getPlayerCH = (pid) => getRoundCH({
    roundLocks, round, pid, players: tPlayers,
    course, chOverrides: hcpOverrides, teeAssignments, roundTee: tr?.tee_box,
  });

  // ── Writes ───────────────────────────────────────────────────────
  // A group's tee time is its POSITION in the round's time list, so an empty
  // group in the MIDDLE is load-bearing and is kept — dropping it would shift
  // every later group onto the wrong time. Trailing empties are not: they are
  // only the tee sheet running out, and trimming them is what lets a round
  // shrink back to its tee times without a "remove group" button.
  const saveGroups = (next) => onSaveGroups(round, trimGroups(next));

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

  // ── Moving a match between tee times ─────────────────────────────
  // Everyone in a group tees off together, so there is no order WITHIN one —
  // which means a drag has nothing to insert between. It only has a tee time
  // to land on. So the drop target is the whole section under the finger, and
  // the match's tee time, and its tournament-wide number, follow from that.
  //
  // Pointer events, not HTML5 drag-and-drop: this console is used on a phone
  // at the first tee, and dragstart/drop never fire for touch. `touchAction:
  // none` on the row is what stops the page scrolling under the finger.
  const canDragRow = (m) => matchFitsGroup && !roundFinal && !!m;

  // The one buzz this can actually make. Android fires it; iOS Safari has no
  // Vibration API at all, so on the phone this console mostly runs on it is a
  // no-op — which is why the drag also lifts, shadows and re-labels its target
  // rather than leaning on haptics to say what is happening.
  const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

  const startDrag = (e, m) => {
    if (!canDragRow(m)) return;
    // Capture keeps the moves coming to the row once the finger slides off it,
    // which it does immediately. It throws for a pointer that is no longer
    // active; the drag still works off the row's own events without it.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    buzz(12);
    setDrag({ id: m.id, over: groupIndexForMatch({ groups, match: m }) });
  };
  const moveDrag = (e) => {
    if (!drag) return;
    // Sections do not move while dragging, so their rects stay a stable ruler
    // to measure the finger against.
    let over = -1;
    Object.entries(sectionRefs.current).forEach(([gi, el]) => {
      const r = el?.getBoundingClientRect();
      if (r && e.clientY >= r.top && e.clientY <= r.bottom) over = Number(gi);
    });
    // A pulse as the target changes — the moment the drop would land somewhere
    // new is the one worth feeling, not every pixel of travel.
    if (over !== drag.over && over >= 0) buzz(8);
    if (over !== drag.over) setDrag(d => (d ? { ...d, over } : d));
  };
  const endDrag = () => {
    if (!drag) return;
    const { id, over } = drag;
    setDrag(null);
    // Released off every section: nothing to land on, so nothing happens. A
    // match is never dropped OUT of the draw by letting go in the wrong place.
    if (over < 0) return;
    const m = rndMatches.find(x => x.id === id);
    if (!m) return;
    const from = groupIndexForMatch({ groups, match: m });
    if (from === over) return;
    // A full tee time cannot absorb another match — four players go off at a
    // time. Dropping on one trades places instead of stacking up an eightsome.
    // An ungrouped match has nowhere to send the occupants, so it is turned
    // away rather than quietly evicting them.
    if (from < 0 && !groupHasRoom({ group: groups[over], need: matchPlayers(m).length })) {
      notify(`${slotName(over)} is full — drop it on an open time`, "error");
      return;
    }
    const { groups: next, displaced } = swapMatchIntoGroup({
      groups, match: m, gi: over, matches: rndMatches,
    });

    // Where every row is standing NOW, and which arrangement to spend it on.
    // Taken before the write, because after it the old positions are gone.
    const tops = {};
    Object.entries(rowRefs.current).forEach(([id, el]) => { if (el) tops[id] = el.offsetTop; });
    pendingFlip.current = { tops, key: JSON.stringify(trimGroups(next)) };

    saveGroups(next);
    // Two pulses for a trade, one for a plain move — the only part of this the
    // phone can feel, and only on Android (see buzz).
    buzz(displaced.length ? [12, 45, 12] : 15);
    if (displaced.length) {
      const ids = [m.id, ...displaced.map(d => d.id)];
      setSwapped(new Set(ids));
      // Long enough to read after the 280ms slide, short enough not to linger
      // as if it were state rather than an event.
      setTimeout(() => setSwapped(s => (s && ids.every(i => s.has(i)) ? null : s)), 900);
      notify(`M${m.matchNumber ?? "?"} and ${displaced.map(d => `M${d.matchNumber ?? "?"}`).join(", ")} swapped tee times`, "success");
    }
  };

  // Empty a tee slot without touching the ones after it. The slot stays —
  // it is a tee time, and the round still has that tee time — so this is the
  // one-tap way back from a group drawn wrong, not a deletion.
  const clearGroup = async (gi) => {
    if (!(await confirm({
      title: `Clear the ${slotName(gi)} group?`,
      message: "Its players go back to the unassigned pool. Every other tee time is left alone.",
      confirmLabel: "Clear", destructive: true,
    }))) return;
    saveGroups(groups.map((g, i) => (i === gi ? [] : g)));
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
        "Scores belong to the player and the round, not to the match, so this match opens with those holes on it.",
        "",
        "If this is a different pairing, discard the stale card first — see “Scores with no match” below.",
      ].join("\n"),
      confirmLabel: "Create anyway",
    }))) return;
    await onSetMatch({
      // Edition-scoped like every other document the app writes — see the
      // note in App.onSaveHole for why these two collections were the last
      // ones building their ids by hand. Existing matches keep the id they
      // were stored with (edits and deletes go through `m.id`), so this only
      // ever applies to a match being created now.
      id: editionDocId(`bc_match_r${round}_${teamASel.join("_")}_vs_${teamBSel.join("_")}`),
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
    // The draw makes itself. The tee times already exist, a new pairing goes
    // off the first one with room for it, and the sheet fills from the first
    // tee down — so a Singles round is drawn by building eight matches and
    // nothing else. Dragging is for changing your mind, not for making it up.
    const pairing = { teamA: teamASel, teamB: teamBSel };
    const gi = firstOpenGroup({ groups, need: matchSeq(pairing).length });
    if (gi >= 0) saveGroups(assignMatchToGroup({ groups, match: pairing, gi }));
    setTeamASel([]); setTeamBSel([]);
    notify(gi >= 0 && times[gi] ? `Match created — off ${stripAMPM(times[gi])}` : "Match created!", "success");
  };

  // ── Building a teammate foursome ─────────────────────────────────
  // The Team Best Ball road, and it does not go through the match builder at
  // all: pick four teammates, and they are on the next open tee time.
  //
  // The MATCH is written once, behind this, and never picked: the side plays
  // the side, so it is the whole roster against the whole roster and there is
  // no arrangement of the field that would make it anything else. Asking a
  // director to select sixteen names to say so is data entry with one
  // possible answer — and until it exists the round has nothing to score
  // against, which is why it is written here rather than left for later.
  const ensureTeamMatch = async () => {
    if (rndMatches.length) return true;
    const sideOf = (t) => tPlayers.filter(p => p.team === t).map(p => p.player_id);
    const teamA = sideOf("A");
    const teamB = sideOf("B");
    if (!teamA.length || !teamB.length) {
      notify("Both teams need players on the roster first", "error");
      return false;
    }
    // Keyed on the ROUND, not the roster. A signed card stores the match id it
    // was signed against, so an id built from the names would move the moment
    // somebody joined and orphan every signature on the round.
    await onSetMatch({
      id: editionDocId(`bc_match_r${round}_teams`),
      tournament_id: TOURNAMENT_ID,
      round,
      teamA, teamB,
      teamANames: teamA.map(nameOf),
      teamBNames: teamB.map(nameOf),
    });
    return true;
  };

  const createFoursome = async () => {
    const pids = foursomeSel;
    if (!pids.length) return;
    if (roundFinal) { notify(`Round ${round} is final — reopen it on Scoring to change the draw`, "error"); return; }
    const gi = firstOpenGroup({ groups, need: pids.length });
    if (gi < 0) { notify("Every tee time is full", "error"); return; }
    // Belt and braces behind pickPlayer's cap: the selection cannot get here
    // over four, and if it ever did this is the write that would put five men
    // on one tee.
    if (!groupFitsAfter({ group: groups[gi], pids })) {
      notify(`A tee time holds ${GROUP_TARGET}`, "error");
      return;
    }
    if (!(await ensureTeamMatch())) return;
    saveGroups(assignPlayersToGroup({ groups, pids, gi }));
    setTeamASel([]); setTeamBSel([]);
    notify(times[gi] ? `Off ${stripAMPM(times[gi])} — ${pids.map(shortOf).join(", ")}` : "Foursome added", "success");
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
    const vs = `${sideNames(m, "A", nameOf).join(" / ")} vs ${sideNames(m, "B", nameOf).join(" / ")}`;
    const ok = await confirm(impact.hasScores ? {
      eyebrow: `${label} · Round ${round}`,
      title: `Delete a match with ${impact.holes} hole${impact.holes === 1 ? "" : "s"} scored?`,
      message: [
        `${vs}`,
        `Scored: ${describeScored(impact.scored, nameOf)}.`,
        "",
        "The scores are NOT erased — they are keyed to the player and the round, not to this match. Deleting hides them from the leaderboard, the cards and the round's progress.",
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
  //
  // On a teammate format the question is different, and so is the pool: the
  // match holds the whole roster from the moment it exists, so "already in a
  // match" would empty both columns after the first foursome and leave
  // nothing to build the rest of the draw from. What is being handed out
  // there is TEE TIMES, so the pool is whoever has not got one yet.
  const matchedPids = new Set(rndMatches.flatMap(matchPlayers));
  const groupedPids = new Set(groups.flat());
  const committed = teammateGroups ? groupedPids : matchedPids;
  const poolFor = (tid, sel) => tPlayers
    .filter(p => p.team === tid)
    .filter(p => !committed.has(p.player_id) || sel.includes(p.player_id));

  const strokes = (() => {
    const all = [...teamASel, ...teamBSel];
    if (all.length < 2) return null;
    const chs = all.map(pid => ({ pid, ch: getPlayerCH(pid) }));
    const minCH = Math.min(...chs.map(c => c.ch));
    return chs.map(({ pid, ch }) => ({ pid, ch, strokes: hcpMode === "full" ? ch : ch - minCH }));
  })();

  const sizeHint = perSide ? `${perSide} per side` : "any number per side";
  const sizeOff = !!perSide && (teamASel.length > perSide || teamBSel.length > perSide);

  // The players lifted for a teammate foursome, whichever column they came
  // from. One side only — see pickPlayer.
  const foursomeSel = teamASel.length ? teamASel : teamBSel;

  // Tapping a name in a pool.
  //
  // Two rules, and both exist only for a teammate format:
  //
  //  · ONE SIDE. A Team Best Ball foursome is four teammates; there is no
  //    opponent to add, so a tap in the other column is a change of mind
  //    about which team you are drawing, not a second half of a pairing.
  //    It moves the selection rather than building a mixed group the draw
  //    would immediately flag.
  //  · FOUR AT MOST. Four players go off at a time. This is the tee sheet
  //    being built, so the cap belongs on the selection — refusing at the
  //    end, after somebody has picked six men, is telling them off for
  //    something the screen let them do.
  const pickPlayer = (tid, pid, on) => {
    const [sel, setSel] = tid === "A" ? [teamASel, setTeamASel] : [teamBSel, setTeamBSel];
    const [other, setOther] = tid === "A" ? [teamBSel, setTeamBSel] : [teamASel, setTeamASel];
    if (on) { setSel(sel.filter(x => x !== pid)); return; }
    if (teammateGroups) {
      if (other.length) setOther([]);
      if (sel.length >= GROUP_TARGET) {
        notify(`A tee time holds ${GROUP_TARGET} — tap one off first`, "error");
        return;
      }
    }
    setSel([...sel, pid]);
  };

  // ── Render ───────────────────────────────────────────────────────
  const playerChip = (pid, { dim } = {}) => {
    const team = teams[teamOf(pid)] || teams.B;
    const lifted = held === pid;
    return (
      <button key={pid} onClick={() => setHeld(lifted ? null : pid)} style={{
        padding: "5px 9px", borderRadius: 8, cursor: "pointer", fontFamily: FONT,
        fontSize: FS.small, fontWeight: 700, textAlign: "left",
        background: lifted ? BC.amber : team.color + (dim ? "22" : "44"),
        border: `1.5px solid ${lifted ? BC.amber : team.accent + ALPHA.line}`,
        color: lifted ? ON_AMBER : team.accent,
      }}>{shortOf(pid)}</button>
    );
  };

  // A side's players, one per line — the same stack MatchTeamColumn draws on
  // the leaderboard, and set at the same FS.body/600. Joined with " / " on one
  // line instead, a 2-man pairing had to wrap once its half of the row
  // narrowed, and it wrapped wherever the width ran out: "AARON J / PETE" over
  // "C". A name is the unit that breaks, not a character inside it.
  const nameStack = (names, color, align) => (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, textAlign: align }}>
      {(names || []).map((nm, i) => (
        <span key={i} style={{
          fontSize: FS.body, fontWeight: 600, lineHeight: 1.3, color,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{nm}</span>
      ))}
    </div>
  );

  // One match, as it appears under its tee time. The M-number is what a drag
  // changes, since both the number and the time belong to the slot rather than
  // to the match.
  //
  // The drag lives on the GRIP, not the whole row — see the note on it below
  // for why that is load-bearing rather than cosmetic.
  //
  // No "n SCORED" badge here. What is already being played matters at the one
  // moment it can be lost — deleting the match — and deleteMatch says it
  // there, in full, with the hole count and the players named. A badge on
  // every row spent space restating that to nobody who was about to act on it.
  const matchRow = (m) => {
    const dragging = drag?.id === m.id;
    const draggable = canDragRow(m);
    // Held amber for a beat after it lands, so the two that traded are named
    // by the screen and not only by the toast.
    const justSwapped = swapped?.has(m.id);
    return (
      // The same three-track grid the card's title uses, for the same reason:
      // matched 1fr flanks put the middle column dead centre on the CARD, so
      // every row's "vs" stacks on one axis and lands under the tee time above
      // it. Laid out inline, the "vs" sat wherever the names happened to end
      // and wandered a few pixels per row all the way down the draw.
      <div
        key={m.id}
        ref={el => { rowRefs.current[m.id] = el; }}
        style={{
          display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
          gap: 8, padding: "4px 6px", margin: "0 -6px", borderRadius: 8,
          // Without this a drag that starts on a name selects it, and the row
          // ends up with a blue text highlight stuck under it.
          userSelect: "none", WebkitUserSelect: "none",
          // Lifted where it sits, NOT dragged under the finger. A floating row
          // is full-width, so it covered the target card's SWAP/MOVE HERE
          // label — the one thing worth reading mid-drag — and the finger was
          // already on top of the row anyway. So the row says "I am the one
          // moving" (raised, tinted, its M-number lit) and the target card
          // says what will happen to it.
          //
          // Transform and opacity only: dragging must never reflow the list,
          // because moveDrag measures the SECTION rects against the finger and
          // a list that shifts under its own measurement oscillates.
          opacity: drag && !dragging ? 0.4 : 1,
          transform: dragging ? "scale(1.02)" : "none",
          // No transition on transform: the FLIP drives it with the Web
          // Animations API, and a CSS transition on the same property would
          // fight the keyframes and drag the slide out to its own duration.
          transition: "opacity 120ms ease, box-shadow 120ms ease, background 400ms ease",
          background: dragging ? BC.inp : justSwapped ? `${BC.amber}${ALPHA.tint}` : "transparent",
          boxShadow: dragging ? `0 4px 14px ${SCRIM}` : "none",
        }}
      >
        {/* Left track: the grip, then team A.

            The grip is the ONLY thing carrying `touch-action: none`, and that
            is not a style choice — it is the whole reason the tab scrolls. A
            finger that lands on a `touch-action: none` box cannot pan the page
            underneath it, so when the whole row was the handle, a swipe
            anywhere over the draw did nothing, and a swipe that travelled far
            enough re-timed a match instead. The grip is padded out to a real
            touch target (44px, Apple's minimum) so it stays easy to hit while
            every other pixel of the row is left to the scroller.

            The ⠿ and the M-number sit inside it together: the number is what
            the drag changes, so it belongs to the thing you drag. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div
            onPointerDown={e => startDrag(e, m)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            // Releasing outside the grip is the normal case, not the odd one —
            // without this a drag that ends off-target would leave the list
            // stuck in its dragging state.
            onLostPointerCapture={endDrag}
            style={{
              display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
              minHeight: 44, minWidth: 44, padding: "0 6px", margin: "-8px 0 -8px -6px",
              touchAction: draggable ? "none" : "auto",
              cursor: draggable ? (dragging ? "grabbing" : "grab") : "default",
            }}
          >
            {draggable && <span aria-hidden style={{ fontSize: FS.small, lineHeight: 1, color: dragging ? BC.amberInk : BC.t3 }}>⠿</span>}
            <span style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 0.5, minWidth: 22, color: dragging ? BC.amberInk : BC.gold }}>
              M{m.matchNumber ?? "?"}
            </span>
          </div>
          {nameStack(sideNames(m, "A", nameOf), teams.A.accent, "left")}
        </div>
        {/* One rung down from the names, and grey: punctuation between them,
            not one of them. It is also the row's axis, so it never moves. */}
        <span style={{ fontSize: FS.small, color: BC.t3 }}>vs</span>
        {/* Right track, mirrored: team B reading toward the axis, then the ✕. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, justifyContent: "flex-end" }}>
          {nameStack(sideNames(m, "B", nameOf), teams.B.accent, "right")}
          <button onClick={() => deleteMatch(m)} style={xBtn}>✕</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Round tabs — the same row of round pills the Matches, Betting and
          Admin tabs lead with, and now literally the same component. It was
          a hand-built copy that had already drifted a little (7px of padding
          against 8) and would have drifted further the moment the shared one
          changed, which is exactly what happened when selection stopped being
          drawn in amber. */}
      <SegmentedToggle
        variant="pills"
        style={{ marginBottom: 10 }}
        options={tournamentRounds.map(r => [r, `Rd ${r}`])}
        value={round}
        onChange={(r) => { setRound(r); setTeamASel([]); setTeamBSel([]); setHeld(null); }}
      />

      {/* Round context — the course and the format, both set on other tabs and
          repeated here because you cannot sensibly build a draw without them
          in front of you.

          The first tee used to sit beside them, and the format line used to
          carry "2 per side · each match is a foursome". Both are said better
          by the draw itself a few inches below: G1 is stamped with the time it
          goes off, and how many players a match holds is plain from the rows
          in it. The size hint survives where it can still tell you something
          you don't already see — over an over-filled selection. */}
      {/* One line, one voice: same size, same colour, joined by a dot. Set at
          different weights and greys they read as a title with a caption under
          it, when they are two halves of the same sentence — "this round is
          this format at this course". */}
      <div style={{
        ...cardStyle, padding: "9px 12px", marginBottom: 10,
        fontSize: FS.small, fontWeight: 700, color: BC.t1,
        // The dot on the card's centre line, the same axis the tee times and
        // every "vs" below it sit on. Course reads into it from the left,
        // format out of it to the right — matched 1fr flanks are what pin the
        // separator rather than letting it drift with the course's length.
        display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "baseline", gap: 6,
      }}>
        <span style={{ textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {course?.name || "Course TBD"}
        </span>
        <span style={{ color: BC.t3 }}>·</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {fmt?.label || "Format TBD"}
        </span>
      </div>

      {/* A final round's draw is part of its result. Say so where the draw is
          edited, so a blocked ✕ reads as a rule rather than a bug. */}
      {roundFinal && (
        <div style={{
          ...cardStyle, padding: "9px 12px", marginBottom: 10,
          border: `1px solid ${BC.amber}${ALPHA.line}`, fontSize: FS.label, color: BC.t2, lineHeight: 1.45,
        }}>
          <span style={{ fontWeight: 800, color: BC.amberInk, letterSpacing: 1 }}>ROUND {round} IS FINAL. </span>
          Its draw is locked to its result. Reopen the round on the Scoring tab to change matches.
        </div>
      )}

      {/* ── Match builder ──
          Unlabelled for the formats that build a match: the two team rosters
          under the round's banner are what this tab opens with, and picking a
          name from each is the only thing they can do.

          A teammate format DOES get a line, because the pools do the opposite
          of what they look like there — two columns side by side read as "one
          from each", and here that is the one thing they are not. */}
      {teammateGroups && !roundFinal && (
        <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, lineHeight: 1.35, marginBottom: 7, textAlign: "center" }}>
          Pick up to {GROUP_TARGET} teammates — they tee off together.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        {[["A", teamASel], ["B", teamBSel]].map(([tid, sel]) => {
          const team = teams[tid];
          const roster = tPlayers.filter(p => p.team === tid);
          const pool = poolFor(tid, sel);
          return (
            <div key={tid}>
              {/* Just the team's name, centred over its column — it is the
                  column's heading, and left-aligned it read as the first item
                  in the list rather than the label for it. The "0/1" counter
                  that used to follow it was counting the taps you had already
                  made, in a column where the ones you made are the lit rows. */}
              <div style={{ fontSize: FS.label, fontWeight: 700, color: team.accent, letterSpacing: 1, marginBottom: 5, textAlign: "center" }}>
                {teamNames?.[tid]}
              </div>
              {pool.length === 0 && (
                <div style={{ fontSize: FS.label, color: BC.t3, padding: "7px 8px", borderRadius: 8, border: `1px dashed ${BC.bdr}`, textAlign: "center" }}>
                  {!roster.length ? "No players"
                    : teammateGroups ? `All on a tee time` : `All matched in Rd ${round}`}
                </div>
              )}
              {pool.map(p => {
                const on = sel.includes(p.player_id);
                return (
                  <button key={p.player_id} onClick={() => pickPlayer(tid, p.player_id, on)} style={{
                    width: "100%", padding: "7px 8px", marginBottom: 3, borderRadius: 8, cursor: "pointer", textAlign: "left",
                    background: on ? team.color + ALPHA.line : BC.inp,
                    border: `1.5px solid ${on ? team.accent : BC.bdr}`,
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontFamily: FONT,
                  }}>
                    {/* FS.body, the size a player's name is set at on the
                        leaderboard and in the match rows below. The CH stays
                        small beside it — it labels the name rather than
                        competing with it. */}
                    <span style={{ fontSize: FS.body, fontWeight: 600, color: on ? team.accent : BC.t2, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                    <span style={{ fontSize: FS.label, color: BC.t3, flexShrink: 0 }}>CH {getPlayerCH(p.player_id)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {sizeOff && (
        <div style={{ fontSize: FS.label, color: BC.danger, marginBottom: 8, textAlign: "center" }}>
          {fmt?.label} is {sizeHint} — check the selection.
        </div>
      )}

      {strokes && (
        <div style={{ ...cardStyle, padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
            {hcpMode === "low_man" ? "PLAY OFF LOW MAN" : "FULL STROKES"}
          </div>
          {/* Equal-width cards. A flex row sized each card to its own label, so
              "Low (14)" next to "+3" read as different kinds of thing; a grid
              makes them uniform. auto-fit drops the empty tracks, so a
              two-player match splits the row instead of hugging the left. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))", gap: 6 }}>
            {strokes.map(({ pid, ch, strokes: s }) => {
              const team = teams[teamOf(pid)] || teams.B;
              // Off low man, a zero means "this is the man everyone plays off",
              // not "this player is scratch" — so name him and show the
              // handicap the others are being measured against.
              const label = s > 0 ? `+${s}` : hcpMode === "low_man" ? `Low (${ch})` : "Scratch";
              return (
                <div key={pid} style={{ background: team.color + ALPHA.tint, border: `1px solid ${team.accent}${ALPHA.line}`, borderRadius: 8, padding: "5px 10px", textAlign: "center", minWidth: 0 }}>
                  <div style={{ fontSize: FS.small, fontWeight: 700, color: team.accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortOf(pid)}</div>
                  <div style={{ fontSize: FS.body, fontWeight: 900, color: s === 0 ? BC.gold : BC.t1 }}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The one button, saying whichever of the two things this format does.
          A teammate format needs no opponent, so it lights on the first name
          picked rather than waiting for a second column that is never coming
          — which is what made this button look broken on Team Best Ball. */}
      {(teammateGroups ? foursomeSel.length > 0 : (teamASel.length > 0 && teamBSel.length > 0)) && (
        <button onClick={teammateGroups ? createFoursome : createMatch} style={{
          width: "100%", padding: "10px 20px", borderRadius: 10, border: "none", fontSize: FS.body, fontWeight: 700,
          cursor: "pointer", background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`,
          color: ON_AMBER, marginBottom: 14, fontFamily: FONT,
        }}>
          {teammateGroups
            ? `${foursomeSel.map(shortOf).join(", ")} — off ${
              (() => {
                const gi = firstOpenGroup({ groups, need: foursomeSel.length });
                return gi >= 0 && times[gi] ? stripAMPM(times[gi]) : "the next tee";
              })()}`
            : `Create Match — ${teamASel.map(shortOf).join("/")} vs ${teamBSel.map(shortOf).join("/")}`}
        </button>
      )}

      {/* ── This round's draw ──
          The match list IS the tee sheet. A match sits under the time it goes
          off, a new one lands on the first time with room, and dragging it to
          another time is the only grouping control there is.

          Unlabelled, like the builder above it: the round and its format are
          already named twice over the top of this tab (the round tabs, the
          course banner), and the tee-time cards say what the list is without
          a heading having to. Only Auto-build gets a row — and only while
          there is something off the sheet for it to place. */}
      {matchFitsGroup && loose.length > 0 && !roundFinal && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button onClick={buildGroups} style={miniBtn}>Auto-build</button>
        </div>
      )}
      {/* No "no matches yet" placeholder. An undrawn round already shows four
          tee times reading OPEN, which says the same thing in the place the
          matches are about to appear. */}

      {/* One section per tee time, each a drop target. Sections are only the
          draw's shape where a match fits in one group; a team format's match
          spans them all, so it is listed flat and split by the chip editor
          further down. */}
      {matchFitsGroup && groups.map((g, gi) => {
        const rows = byGroup[gi];
        const over = drag?.over === gi;
        const tooMany = g.length > GROUP_TARGET;
        // What letting go here would do, worked out while the finger is still
        // down. A full tee time trades places rather than stacking up, and
        // saying SWAP on the card before the drop is what makes that the
        // obvious outcome instead of a surprise after it.
        const dragged = drag ? rndMatches.find(x => x.id === drag.id) : null;
        const draggedFrom = dragged ? groupIndexForMatch({ groups, match: dragged }) : -1;
        const wouldSwap = over && dragged && draggedFrom !== gi
          && !groupHasRoom({ group: g, need: matchPlayers(dragged).length });
        // Nowhere to send this one's occupants — see endDrag.
        const wouldRefuse = wouldSwap && draggedFrom < 0;
        const edge = over ? (wouldRefuse ? BC.danger : BC.amber) : tooMany ? BC.danger + ALPHA.line : BC.bdr;
        return (
          <div
            key={gi}
            ref={el => { sectionRefs.current[gi] = el; }}
            style={{
              ...cardStyle, padding: "8px 10px", marginBottom: 6,
              border: `1px solid ${edge}`,
              background: over ? `${wouldRefuse ? BC.danger : BC.amber}${ALPHA.wash}` : BC.card,
              transition: "border-color 120ms ease, background 120ms ease",
            }}
          >
            {/* The tee time alone, centred over the matches riding in it.
                No "G1" beside it — the time IS the group's name, and the
                G-number was a second label for one thing. No "4/4" counter
                either: you can see how many matches are in the card, and a
                card that is over its four turns red and gets named in CHECK.

                The three-track grid stays even though only the middle is
                filled. It is what centres the time on the CARD, and the right
                track is where the drag's answer lands. */}
            {/* Given its own band so it reads as the card's header rather than
                a first row: BC.inp is the sunken surface one step off BC.card,
                which separates them in both themes without introducing a
                colour. Bled out to the card's edges by the negative margins —
                a band that stops short of them reads as a box inside a box —
                and the top corners are rounded to 11 (the card's 12 less its
                1px border) so it sits inside the rounding rather than
                squaring it off.

                When the card is a drop target the band takes the amber a rung
                stronger than the body wash, so the target reads from its
                header down. */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "baseline",
              margin: "-8px -10px 7px", padding: "6px 10px",
              background: over ? `${wouldRefuse ? BC.danger : BC.amber}${ALPHA.tint}` : BC.inp,
              borderBottom: `1px solid ${over ? edge : BC.bdr}`,
              borderRadius: "11px 11px 0 0",
              transition: "background 120ms ease, border-color 120ms ease",
            }}>
              <span />
              <span style={{ fontSize: FS.body, fontWeight: 800, justifySelf: "center", color: times[gi] ? BC.t1 : BC.t3 }}>
                {times[gi] ? stripAMPM(times[gi]) : "—"}
              </span>
              {/* Only while a drag is over this card: what letting go would do.
                  Empty the rest of the time, which is most of the time. */}
              <span style={{
                fontSize: FS.label, fontWeight: 700, textAlign: "right", minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: wouldRefuse ? BC.danger : BC.amberInk,
              }}>
                {wouldRefuse ? "FULL"
                  : wouldSwap ? "SWAP"
                  : over && draggedFrom !== gi ? "MOVE HERE"
                  : ""}
              </span>
            </div>
            {rows.length === 0 && (
              <div style={{ fontSize: FS.label, color: over ? BC.amberInk : BC.t3, fontWeight: 700, letterSpacing: 0.5, padding: "2px 0" }}>
                {over && draggedFrom !== gi ? "DROP HERE" : "OPEN"}
              </div>
            )}
            {rows.map(m => matchRow(m))}
          </div>
        );
      })}

      {/* Matches with no time of their own: a team format's (every one of
          them, legitimately), or one whose opponents ended up in different
          groups. Not a drop target — a match leaves here by being dragged
          onto a time, never by being dropped back out of the draw. */}
      {loose.length > 0 && (
        <div style={{
          ...cardStyle, padding: "8px 10px", marginBottom: 6,
          border: `1px solid ${matchFitsGroup ? BC.danger + ALPHA.line : BC.bdr}`,
        }}>
          {matchFitsGroup && (
            <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.danger, letterSpacing: 1, marginBottom: 7 }}>
              NO TEE TIME
            </div>
          )}
          {loose.map(m => matchRow(m))}
        </div>
      )}

      {/* No "drag ⠿ to move a match" instruction. The ⠿ on every row is the
          affordance, and the drag now narrates itself while it is happening —
          the target card says SWAP, MOVE HERE or FULL under the finger, and
          the rows slide into their new times when it lands. */}
      {matchFitsGroup && <div style={{ marginBottom: 14 }} />}

      {/* ── Scores with no match ──
          The consequence of the delete made visible. These holes are live in
          the database and counted by nothing: not the leaderboard, not the
          round's progress, not the finalize card. Without this panel the only
          symptom is a round that looks emptier than the morning actually was. */}
      {orphans.length > 0 && (
        <div style={{ ...cardStyle, padding: "10px 12px", marginBottom: 14, border: `1px solid ${BC.danger}${ALPHA.line}` }}>
          <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.danger, letterSpacing: 1, marginBottom: 6 }}>
            SCORES WITH NO MATCH · ROUND {round}
          </div>
          <div style={{ fontSize: FS.label, color: BC.t2, lineHeight: 1.45, marginBottom: 9 }}>
            Posted in Round {round}, but no match this round accounts for them — so nothing counts them.
            Draw these players back into a match and their holes come back with them. Erase only if the round is genuinely being re-played.
          </div>
          {orphans.map(({ pid, holes }) => (
            <div key={pid} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.t1, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {nameOf(pid)}
              </span>
              <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, flexShrink: 0 }}>
                {holes} hole{holes === 1 ? "" : "s"}
              </span>
              {onDiscardRoundScores && (
                <button onClick={() => discardOrphan(pid, holes)} style={{ ...miniBtn, borderColor: `${BC.danger}${ALPHA.line}`, color: BC.danger }}>
                  Erase
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Splitting a team match across the tee sheet ──
          Only reached by the formats whose match is bigger than a foursome.
          Everything else is already grouped by the draw above — its matches
          ARE its groups — so there is nothing here for it to do. */}
      {!matchFitsGroup && (
        <>
          {/* No heading and no explanation. The G1–G4 cards below are visibly
              a tee sheet, and how a team match gets split across them is what
              the chips do when you tap them, not something to read first.
              Auto-build keeps its button — for these formats it is the only
              way to fill the sheet in one move, since a match spanning several
              groups has no single time to be dropped onto. */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, marginBottom: 8 }}>
            <button onClick={buildGroups} style={miniBtn}>Auto-build</button>
          </div>

          {groups.map((g, gi) => {
            const over = g.length > GROUP_TARGET;
            return (
              <div key={gi} style={{
                ...cardStyle, padding: "9px 11px", marginBottom: 6,
                border: `1px solid ${held ? BC.amber + ALPHA.line : over ? BC.danger + ALPHA.line : BC.bdr}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: g.length ? 7 : 0 }}>
                  {/* The time this group goes off, read off the round, and the
                      only name it needs. Not an input: the Rounds tab's boxes
                      are the one place tee times are typed, and editing them
                      there re-spaces the whole sheet instead of leaving one
                      slot out of step. The player count stays here — this is
                      the editor where players are placed one at a time, so
                      "how many are in this one" is the thing being watched. */}
                  <span style={{
                    fontSize: FS.small, fontWeight: 800, flexShrink: 0, minWidth: 46,
                    color: times[gi] ? BC.t1 : BC.t3,
                  }}>{times[gi] ? stripAMPM(times[gi]) : "—"}</span>
                  <span style={{
                    fontSize: FS.label, color: over ? BC.danger : BC.t3, fontWeight: 700, flex: 1, minWidth: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {g.length} player{g.length !== 1 ? "s" : ""}{over ? " · too many" : ""}
                  </span>
                  {held
                    ? <button onClick={() => moveHeldTo(gi)} style={{ ...miniBtn, padding: "4px 8px" }}>Move {shortOf(held)} here</button>
                    : g.length > 0 && <button onClick={() => clearGroup(gi)} style={xBtn}>✕</button>}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {g.map(pid => playerChip(pid))}
                </div>
              </div>
            );
          })}

          {held && (
            <>
              <button onClick={() => moveHeldTo(-1)} style={{ ...miniBtn, width: "100%", padding: "8px 10px", marginBottom: 8, borderColor: `${BC.danger}${ALPHA.line}`, color: BC.danger }}>
                Ungroup {shortOf(held)}
              </button>
              <div style={{ fontSize: FS.label, color: BC.t3, textAlign: "center", marginBottom: 8 }}>
                {nameOf(held)} lifted — tap a group to drop them in, or tap them again to cancel.
              </div>
            </>
          )}

          {/* Players with a match but nowhere to tee off. */}
          {issues.unassigned.length > 0 && (
            <div style={{ ...cardStyle, padding: "9px 11px", marginBottom: 8, border: `1px solid ${BC.danger}${ALPHA.line}` }}>
              <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.danger, letterSpacing: 1, marginBottom: 7 }}>
                NOT IN A GROUP — NO TEE TIME
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {issues.unassigned.map(pid => playerChip(pid, { dim: true }))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Everything else worth saying about the draw, in one place. */}
      {flagged && (
        <div style={{ ...cardStyle, padding: "9px 11px", marginBottom: 8, border: `1px solid ${BC.amber}${ALPHA.line}` }}>
          <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.amberInk, letterSpacing: 1, marginBottom: 6 }}>CHECK</div>
          {issues.split.map(m => (
            <div key={m.id} style={{ fontSize: FS.label, color: BC.t2, marginBottom: 3 }}>
              · {sideNames(m, "A", nameOf).join("/")} vs {sideNames(m, "B", nameOf).join("/")} is split across groups — opponents tee off together.
            </div>
          ))}
          {issues.duplicated.map(pid => (
            <div key={pid} style={{ fontSize: FS.label, color: BC.t2, marginBottom: 3 }}>· {nameOf(pid)} is in more than one group.</div>
          ))}
          {issues.unmatched.map(pid => (
            <div key={pid} style={{ fontSize: FS.label, color: BC.t2, marginBottom: 3 }}>· {nameOf(pid)} is grouped but has no match this round.</div>
          ))}
          {issues.oversized.map(({ i, n }) => (
            <div key={i} style={{ fontSize: FS.label, color: BC.t2, marginBottom: 3 }}>· The {slotName(i)} group has {n} players.</div>
          ))}
          {issues.unassigned.length > 0 && (
            <div style={{ fontSize: FS.label, color: BC.t2 }}>
              · {issues.unassigned.length} player{issues.unassigned.length !== 1 ? "s" : ""} without a tee time.
            </div>
          )}
        </div>
      )}

      {!flagged && groups.length > 0 && rndMatches.length > 0 && (
        <div style={{ fontSize: FS.label, color: BC.amberInk, textAlign: "center", marginBottom: 8, fontWeight: 700 }}>
          ✓ Every player has a group and a tee time.
        </div>
      )}
    </div>
  );
}

export default MatchSetup;
