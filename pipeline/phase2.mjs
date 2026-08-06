#!/usr/bin/env node
// Bourbon Cup — PHASE 2 (generalized). Match-status layer for any year.
//   singles / 2man_best_ball / 2man_hi_lo → computed from gross + match-relative handicap
//   2man_scramble                          → read cumulative status row (shared ball, blend pre-applied)

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildResolver, displayName as N } from "./players.mjs";

// Repo data/ dir, resolved from this script's location (see backbone.mjs).
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

const resolve = buildResolver();
const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function parseCSV(t){const rows=[];let c="",q=false,row=[];for(let i=0;i<t.length;i++){const ch=t[i];
  if(q){if(ch==='"'){if(t[i+1]==='"'){c+='"';i++;}else q=false;}else c+=ch;}
  else if(ch==='"')q=true;else if(ch===','){row.push(c);c="";}
  else if(ch==='\n'){row.push(c);rows.push(row);row=[];c="";}else if(ch==='\r'){}else c+=ch;}
  if(c.length||row.length){row.push(c);rows.push(row);}return rows;}
const num=v=>{const n=parseFloat(String(v).replace(/[^0-9.\-]/g,""));return isNaN(n)?null:n;};
const strokesOn=(ch,idx)=>ch==null||idx==null||ch<=0?0:Math.floor(ch/18)+(idx<=((ch%18+18)%18)?1:0);
const sign=x=>x>0?1:x<0?-1:0;

const dir=process.argv[2];
const APPEND=process.argv.includes("--append");
const year=+String(dir).match(/\d{4}/)?.[0];
const backbone=JSON.parse(readFileSync(join(DATA_DIR, "bourbon-cup-backbone.json"),"utf8"));
const PR=backbone.playerRound, PH=backbone.playerHole;
const roundFact=(p,r)=>PR.find(x=>x.player===p&&x.round===r&&x.year===year);
const holes=(p,r)=>PH.filter(x=>x.player===p&&x.round===r&&x.year===year).sort((a,b)=>a.hole-b.hole);
const scfile=g=>{const f=readdirSync(dir).find(x=>norm(x).includes(norm(g))&&x.endsWith(".csv"));return f?parseCSV(readFileSync(join(dir,f),"utf8")):null;};

function readCard(rows){
  const players=[]; let status=null;
  for(const r of rows){
    const pid=resolve(r[0]); const team=(r[1]||"").trim().toUpperCase();
    const isTeam=/[A-Z]/.test(team) && team.length>=2 && team.length<=20 && !/^\d/.test(team[0]);
    if(pid && isTeam) players.push({player:pid,team});
  }
  const teams=[...new Set(players.map(p=>p.team))];
  for(const r of rows){
    if(/status/i.test(r[0]) || /match - front/i.test(r[1]||"")){
      const front=r.slice(4,13).map(num), back=r.slice(16,25).map(num);
      const s=[...front.slice(0,9),...back.slice(0,9)];
      if(s.filter(x=>x!=null).length>=18){
        const pfx=String(r[0]).replace(/\s*(status|top|bot).*/i,"").trim().toUpperCase();
        status={refTeam: teams.includes(pfx)?pfx:teams[0], statusAfter:s};
      }
    }
  }
  return {players,teams,status};
}

const matchFacts=[];
// ── 2020 ghost: a borrowed-scores player fills TeeHawks' 8th slot each round ──
// The ghost reuses a real teammate's card (R1 Dave K, R2 Andy H, R3 Ben T); R4 sits out.
// CONVENTION (assumption — confirm): the borrowed player's 1st-listed match is his REAL
// one; his 2nd appearance is the ghost match. No fact is emitted for the ghost slot;
// every row of an affected match carries involves_ghost:true.
const GHOST_BORROW = year===2020 ? {1:"dk",2:"andy",3:"bent"} : {};
const ghostCount = {};   // round -> times the borrowed player has been seen (2nd occurrence = ghost)

function emit(round,format,a,b,teamA,statusA,involvesGhost=false){
  matchFacts.push({year,round,format,player:a,opponent:b,team:teamA,
    trajectory:[...statusA],                 // ATOMIC: player-perspective match state after each hole
    after9:statusA[8], final:statusA[17], margin:Math.abs(statusA[17]),
    won:statusA[17]>0, halved:statusA[17]===0, involves_ghost:involvesGhost});
  const hs=holes(a,round); statusA.forEach((s,i)=>{ if(hs[i]){ hs[i].status_after=s;
    hs[i].hole_result=i===0?sign(s):sign(s-statusA[i-1]); }});
}
function withMnet(data){
  const minCH=Math.min(...data.map(d=>d.ch||0));
  return data.map(d=>({...d, mnet:d.hs.map(h=> h.gross - strokesOn((d.ch||0)-minCH, h.hole_index))}));
}

let xPass=0,xFail=0;
function processCard(round,format,rows){
  const {players,teams,status}=readCard(rows);
  if(players.length<2||teams.length<2) return;
  const base=players.map(p=>({...p, ch:roundFact(p.player,round)?.course_handicap, hs:holes(p.player,round)})).filter(d=>d.hs.length>=18);
  if(base.length<2) return;

  if(format==="2man_scramble"||format==="pinehurst"){   // shared-ball formats: read cumulative status row
    if(!status) return;
    const refA=status.refTeam, sA=status.statusAfter;
    const tA=base.filter(d=>d.team===refA).map(d=>d.player);
    const tB=base.filter(d=>d.team!==refA).map(d=>d.player);
    for(const p of tA) emit(round,format,p,tB.join("+"),refA,sA);
    for(const p of tB) emit(round,format,p,tA.join("+"),base.find(d=>d.player===p).team,sA.map(x=>-x));
    return;
  }
  if(format==="singles"){
    const borrow=GHOST_BORROW[round];
    for(let i=0;i+1<players.length;i+=2){
      const pa=players[i].player, pb=players[i+1].player;
      const da=base.find(d=>d.player===pa);
      const db=base.find(d=>d.player===pb);
      if(da&&db){
        let isGhost=false, ghostPid=null;
        if(borrow && (pa===borrow||pb===borrow)){
          ghostCount[round]=(ghostCount[round]||0)+1;
          if(ghostCount[round]>=2){ isGhost=true; ghostPid=borrow; }   // 2nd appearance = the ghost
        }
        const [A,B]=withMnet([da,db]);           // strokes relative to the LOWER of the two (pairwise)
        let cum=0; const sA=[];
        for(let h=0;h<18;h++){ cum+=sign(B.mnet[h]-A.mnet[h]); sA.push(cum); }
        if(isGhost){                              // borrowed player IS the ghost here: emit only the real opponent
          if(A.player!==ghostPid) emit(round,format,A.player,"ghost",A.team,sA,true);
          else                    emit(round,format,B.player,"ghost",B.team,sA.map(x=>-x),true);
        } else {
          emit(round,format,A.player,B.player,A.team,sA);
          emit(round,format,B.player,A.player,B.team,sA.map(x=>-x));
        }
      } else if(da||db){
        const present=da||db, absent=(da?players[i+1]:players[i]).player;
        matchFacts.push({year,round,format,player:present.player,opponent:absent,team:present.team,
          trajectory:null,after9:null,final:null,margin:null,won:null,halved:null,opponent_absent:true});
      }
    }
    return;
  }
  // 2-man best ball / hi-lo: one match, all 4 players → strokes relative to card min
  const data=withMnet(base);
  const A=data.filter(d=>d.team===teams[0]), B=data.filter(d=>d.team===teams[1]);
  if(!A.length||!B.length) return;
  let cum=0; const sA=[];
  for(let h=0;h<18;h++){
    const aN=A.map(d=>d.mnet[h]), bN=B.map(d=>d.mnet[h]);
    const res= format==="2man_hi_lo"
      ? sign(Math.min(...bN)-Math.min(...aN))+sign(Math.max(...bN)-Math.max(...aN))
      : sign(Math.min(...bN)-Math.min(...aN));
    cum+=res; sA.push(cum);
  }
  // ghost card detection (team formats): borrowed player's 2nd appearance = the ghost match
  const borrow=GHOST_BORROW[round];
  let ghostCard=false;
  if(borrow && base.some(d=>d.player===borrow)){
    ghostCount[round]=(ghostCount[round]||0)+1;
    if(ghostCount[round]>=2) ghostCard=true;
  }
  const oppName=arr=>arr.map(x=>(ghostCard&&x.player===borrow)?"ghost":x.player).join("+");
  for(const d of A){ if(ghostCard&&d.player===borrow) continue;   // ghost slot: no fact
    emit(round,format,d.player,oppName(B),teams[0],sA,ghostCard); }
  for(const d of B){ if(ghostCard&&d.player===borrow) continue;
    emit(round,format,d.player,oppName(A),teams[1],sA.map(x=>-x),ghostCard); }
  if(status && (format==="2man_best_ball"||format==="shamble")){
    const refSign=status.refTeam===teams[0]?1:-1;
    const sheetFinal=status.statusAfter[17]*refSign;
    if(sheetFinal===sA[17]) xPass++; else { xFail++;
      console.log(`   \u26a0 best-ball xcheck R${round}: computed ${sA[17]} vs sheet ${sheetFinal} (teams ${teams.join("/")})`); }
  }
}

const fmtByRound={}; for(const p of PR.filter(p=>p.year===year)) fmtByRound[p.round]=p.format;
for(const [r,f] of Object.entries(fmtByRound)){
  if(!["singles","2man_best_ball","2man_hi_lo","2man_scramble","pinehurst","shamble"].includes(f)) continue;
  for(const g of ["G1","G2","G3","G4"]){ const rows=scfile(`R${r}_${g}`); if(rows) processCard(+r,f,rows); }
}

const outPath=join(DATA_DIR, "bourbon-cup-matchfacts.json");
let prior=[];
if(APPEND){ try{ prior=JSON.parse(readFileSync(outPath,"utf8")).matchFacts.filter(m=>m.year!==year); }catch{} }
// Sorted for the same reason backbone.mjs sorts: the file should be a
// function of the sheets, not of the order the years were run in.
const allFacts=[...prior,...matchFacts].sort((a,b)=>(a.year-b.year)||(a.round-b.round)||String(a.player).localeCompare(String(b.player)));
writeFileSync(outPath,JSON.stringify({matchFacts:allFacts},null,2));
writeFileSync(join(DATA_DIR, `bourbon-cup-${year}-full.json`),
  JSON.stringify({playerHole:PH.filter(h=>h.year===year),playerRound:PR.filter(p=>p.year===year),matchFacts},null,2));

console.log(`Phase 2 \u2014 ${year}: ${matchFacts.length} match rows`);
if(xPass+xFail) console.log(`   best-ball cross-check vs sheet: ${xPass}/${xPass+xFail} cards agree`);
console.log("\nResults (one row per match):");
const seen=new Set();
for(const m of matchFacts){
  const pk=m.round+"#"+[m.player,m.opponent].sort().join("|"); if(seen.has(pk))continue; seen.add(pk);
  const opp=m.opponent.split("+").map(N).join("+");
  const res= m.opponent_absent?`forfeit (${opp} DNP)`: m.final>0?`def ${opp} ${m.final}up`: m.final<0?`lost to ${opp} ${-m.final}dn`:`halved w/ ${opp}`;
  console.log(`   R${m.round} ${m.format.padEnd(15)} ${N(m.player).padEnd(8)} ${res}${m.comeback?" \u2605CB":""}${m.blew_lead?" \u25bc":""}`);
}
const trailed = t => t && Math.min(...t) < 0;
const led     = t => t && Math.max(...t) > 0;
const cb9  = [...new Set(matchFacts.filter(m=>m.won && m.after9<0).map(m=>N(m.player)))];
const cbAny= [...new Set(matchFacts.filter(m=>m.won && trailed(m.trajectory)).map(m=>N(m.player)))];
const blAny= [...new Set(matchFacts.filter(m=>m.final<0 && led(m.trajectory)).map(m=>N(m.player)))];
const ff=matchFacts.filter(m=>m.opponent_absent);
console.log(`\n   comeback — down after 9, won:        ${cb9.length?cb9.join(", "):"none"}`);
console.log(`   comeback — trailed at ANY point, won: ${cbAny.length?cbAny.join(", "):"none"}`);
console.log(`   blew lead — led at any point, lost:   ${blAny.length?blAny.join(", "):"none"}`);
if(ff.length) console.log(`   forfeits (opponent absent): ${ff.map(m=>`${N(m.player)} (opp ${N(m.opponent)} DNP)`).join(", ")}`);
