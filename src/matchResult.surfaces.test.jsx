/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  Four screens, one match, and they had better agree
// ══════════════════════════════════════════════════════════════════
//
// A match result is stated in four places — the Scoring tab's Nassau chips,
// the Full Scorecard's header, the Leaderboard's collapsed row and the round
// summary sheet — and each of them reached for its own words. Both of the
// result bugs found in the field were exactly this: the scorecard stamping
// 8&6 on the twelfth under a chip reading "10&4", and a chip reading
// "LOST 2 UP" over a strip of ▼s.
//
// So this walks ONE match through its whole life — not started, live,
// clinched, played on past the closeout, all eighteen in, signed, attested,
// and halved — and asserts the four screens are telling the same story at
// every step. Each is allowed its own dialect and nothing else:
//
//   Scoring tab   says it from the reader's side  — "WON 9&7", "3 DOWN"
//   everything else is neutral                    — "9&7", "TIED"
//
// Strip the dialect and the four have to be the same sentence. ("½" is still
// mapped below: the Leaderboard printed it for a level overall until the word
// moved into statusText, and a screen reaching back for the symbol should
// fail on something other than a stale helper in a test.)
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("./lib/auth", () => ({
  PROVIDERS:{GOOGLE:"google.com",APPLE:"apple.com"}, signIn:async()=>({user:null,error:null}),
  signOutUser:async()=>{}, onAuthUser:()=>()=>{}, consumeRedirectResult:async()=>({user:null,error:null}),
  isCancelled:()=>false, whenAuthReady:async()=>{}, providerLabel:()=>"account",
}));
vi.mock("./firebase", () => ({
  db:{subscribe:()=>()=>{},upsert:async()=>null,delete:async()=>null,get:async()=>[]},
  TOURNAMENT_ID:"bc_test", editionDocId:(id)=>id, getTournamentYear:()=>2026, writeFailure:()=>"failed",
  writeTracker:{track:(p)=>p,state:()=>({pending:0,kinds:{},since:null,refused:0,refusedKinds:{}}),subscribe:()=>()=>{}},
  firebaseApp:{}, getMessagingInstance:async()=>null, getActiveTournamentId:()=>"bc_test",
  getDefaultEditionId:()=>"bc_test", setActiveTournamentId:()=>{}, readUserSession:()=>null,
  writeUserSession:()=>{}, readTournamentIdentity:()=>null, writeTournamentIdentity:()=>{},
  spectatorSession:()=>null, BOOTSTRAP_DIRECTOR:"bootstrap_director", SPECTATOR_ID:"spectator",
}));

import { ScoreEntry } from "./App";
import { TeamLeaderboard } from "./components/Leaderboard";
import { FullScorecard } from "./components/FullScorecard";
import { computeMatchResult } from "./scoring";
import { roundSummary } from "./lib/roundSummary";

afterEach(cleanup);

const PARS=[4,4,3,5,4,4,3,4,5,4,3,4,4,5,4,3,4,4];
const SI=[5,9,15,1,11,3,17,7,13,6,16,2,10,4,8,18,12,14];
const courses=[{id:"c1",name:"Treetops",par:72,hole_pars:PARS,hole_handicaps:SI,
  tee_boxes:[{name:"White",slope:113,rating:72,par:72}]}];
const tPlayers=[
  {player_id:"p1",name:"Aaron J",team:"A",handicap_index:0,auth_uid:"u1"},
  {player_id:"p2",name:"Paul W",team:"B",handicap_index:0},
];
const teams={A:{id:"A",name:"Irons",color:"#2e7d5b",accent:"#2e7d5b"},B:{id:"B",name:"Drivers",color:"#1f7a8c",accent:"#1f7a8c"}};
const match={id:"m1",round:1,teamA:["p1"],teamB:["p2"],tournament_id:"bc_test"};
const baseRound={round_number:1,course_id:"c1",tee_box:"White",date:"2026-07-16",tee_time:"8:30",format:"singles"};

const WINNERS="AAAAAAAABAAABB----";
const cardTo=(n,seq)=>{const hd={p1_1:{},p2_1:{}};
  for(let h=0;h<n;h++){const w=(seq||WINNERS)[h];
    hd.p1_1[h]=w==="A"?3:w==="B"?5:4; hd.p2_1[h]=w==="A"?5:w==="B"?3:4;}
  return hd;};

const scoringProps=(hd,rounds,over)=>({
  user:{...tPlayers[0],isDirector:false}, matches:[match], holeData:hd, onSaveHole:async()=>{},
  tPlayers, courses, tRounds:rounds, notify:()=>{}, teams, hcpOverrides:{}, teeAssignments:{}, roundLocks:{},
  rounds:[1], currentRound:1, groups:{1:[["p1","p2"]]}, ctpData:{}, onSetCtp:async()=>{},
  onConfirmCtp:async()=>{}, buyIns:{}, cardSigs:over.cardSigs||[], onSignCard:async()=>{},
  onAttestCard:async()=>{}, onUnsignCard:async()=>{},
});

const chips=(txt)=>["FRONT","OVERALL","BACK"].map(l=>{
  const i=txt.indexOf(l); if(i<0) return `${l}:none`;
  const m=txt.slice(i+l.length).match(/^(TIED|—|🔒|[0-9]+ (?:UP|DOWN)|(?:WON|LOST) [0-9]+(?:&[0-9]+| UP| DOWN))/);
  return `${l}:${m?m[1]:"?"}`;}).join("  ");

// A two-row three-column grid — F9 / overall / B9 on top, each value beneath.
const lbRow=(txt)=>{
  const m=txt.match(/Aaron J\s*F9([\s\S]*?)B9([\s\S]*?)(THRU [0-9]+|FINAL|—|8:30)\s*▾([\s\S]*?)Paul W/);
  return m ? `F9 ${m[2].trim()} · overall ${m[1].trim()} · B9 ${m[4].trim()} · ${m[3]}`
    : (txt.match(/Aaron J[\s\S]{0,70}?Paul W/)||["?"])[0].replace(/\s+/g," ").trim();
};

const SIGNED=[{id:"s1",match_id:"m1",round:1,signed_by:"p1",attests:{}}];
const FINAL=[{id:"s1",match_id:"m1",round:1,signed_by:"p1",attests:{p2:1}}];

const STATES=[
  ["not started",          0,  {}, "—"],
  ["3 holes, live",        3,  {}, "3 UP"],
  ["clinched on the 11th", 12, {}, "9&7"],
  ["scored on to 14",      14, {}, "9&7"],
  ["all 18 in",            18, {}, "9&7"],
  ["signed",               18, {cardSigs:SIGNED}, "9&7"],
  ["attested / final",     18, {cardSigs:FINAL},  "9&7"],
  ["level",                18, {winners:"AAAAAAAAABBBBBBBBB"}, "TIED"],
];

// The result, with each screen's dialect taken off it.
const plain=(s)=>String(s??"").trim().replace(/^(WON|LOST)\s+/,"").replace(/^½$/,"TIED").trim();

describe("one match, four screens, the same story", () => {
  for (const [label,n,over,expected] of STATES) {
    it(label, () => {
      const hd=cardTo(n,over.winners);
      const rounds=[baseRound];
      const res=computeMatchResult(match,hd,courses,rounds,tPlayers,"singles",{},undefined,{},{});

      const scoringTxt=render(<ScoreEntry {...scoringProps(hd,rounds,over)} />).container.textContent;
      cleanup();
      const lbTxt=render(<TeamLeaderboard matches={[match]} holeData={hd} ownHoleData={hd}
        countdownHoleData={hd} courses={courses} tRounds={rounds} tPlayers={tPlayers} teams={teams}
        hcpOverrides={{}} teeAssignments={{}} roundLocks={{}} viewer="A" />).container.textContent;
      cleanup();
      const cardTxt=render(<FullScorecard match={match} result={res} format="singles" holePars={PARS}
        holeHcps={SI} course={courses[0]} tPlayers={tPlayers} viewer="A"
        getScore={(pid,h)=>hd[`${pid}_1`]?.[h]||0} />).container.textContent;
      cleanup();
      const rs=roundSummary({round:1,matches:[match],holeData:hd,tPlayers,tRounds:rounds,courses,
        roundLocks:{},hcpOverrides:{},teeAssignments:{},teams,buyIns:{},ctpData:{},cardSigs:over.cardSigs||[]});

      const said={
        scorecard: plain(((cardTxt.match(/Aaron J(.{0,14}?)Paul W/)||[])[1]||"").trim()),
        leaderboard: plain((lbRow(lbTxt).match(/overall ([^·]*)/)||[])[1]),
        summary: plain(rs.matches?.[0]?.status),
      };
      // The Scoring tab hands the whole screen over to the signed card, so its
      // chips are gone by then — the card above IS its statement of the result.
      const chip=(chips(scoringTxt).match(/OVERALL:(\S+(?: (?:UP|DOWN|[0-9]+&[0-9]+))?)/)||[])[1];
      if (chip && chip!=="none") said.scoringTab=plain(chip.replace(/^(WON|LOST)/,"").trim());

      for (const [where,text] of Object.entries(said)) {
        expect(text, `${where} said "${text}"`).toBe(expected);
      }
    });
  }
});

// ── The fifth voice on the Scoring tab ──
// The per-hole status strip under the hole numbers is a running account —
// where the match stood walking off each green — and on the hole the match
// ENDED it was still speaking that dialect: "▲9" under a match every other
// surface on the same screen, the OVERALL chip included, calls 9&7. Three up
// with one to play is not a state, it is a finish, and the strip was the one
// place on the phone that would not say so. The Full Scorecard's MATCH row
// has always marked the clinch hole; this pins that the strip does too.
describe("the strip's closing hole states the result, not the margin", () => {
  const scoringText=(n)=>{
    const hd=cardTo(n);
    const txt=render(<ScoreEntry {...scoringProps(hd,[baseRound],{})} />).container.textContent;
    cleanup();
    return txt;
  };

  it("marks the hole the match was won on", () => {
    // A clinches on the 11th, 9 up with 7 to play, and the group scores on.
    const txt=scoringText(14);
    // Twice: once in the strip's eleventh cell, once in the OVERALL chip.
    expect(txt.match(/9&7/g)||[]).toHaveLength(2);
    // And never as the running margin it stood at — the number the strip
    // used to print there, one hole before it stopped counting.
    expect(txt).not.toContain("▲9");
  });

  it("leaves a live match's running numbers alone", () => {
    // Eight holes in and nothing decided: every cell is still a state, and
    // the strip must go on saying so.
    const txt=scoringText(8);
    // The strip alone — the FRONT chip below it has clinched its own nine
    // 5&4 by the eighth, which is a segment result and not this strip's job.
    const strip=txt.slice(0,txt.indexOf("FRONT"));
    expect(strip).toContain("▲8");
    expect(strip).not.toContain("&");
  });
});
