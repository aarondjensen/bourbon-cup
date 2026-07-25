#!/usr/bin/env node
// Bourbon Cup — BACKBONE parser (Phase 1). Reads the real ALL SCORES + Master Input
// layout and emits the locked player_hole + player_round facts, metrics included.
// Match-status (hole_result/status_after, comebacks, H2H) is Phase 2 off the scorecards.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildResolver, norm } from "./players.mjs";

// Generated artifacts land in the repo's data/ dir (resolved from this
// script's location, so it works regardless of the current directory) —
// not a machine-specific absolute path.
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

// ── canonical identity (shared registry) ────────────────────────────────────
const resolve = buildResolver();

// ── CSV (quote-aware) ────────────────────────────────────────────────────────
function parseCSV(t){const R=[],r=[];let c="",q=false,row=[...r];const rows=[];for(let i=0;i<t.length;i++){const ch=t[i];
  if(q){if(ch==='"'){if(t[i+1]==='"'){c+='"';i++;}else q=false;}else c+=ch;}
  else if(ch==='"')q=true; else if(ch===','){row.push(c);c="";}
  else if(ch==='\n'){row.push(c);rows.push(row);row=[];c="";} else if(ch==='\r'){} else c+=ch;}
  if(c.length||row.length){row.push(c);rows.push(row);} return rows;}
const num = v => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g,"")); return isNaN(n)?null:n; };
const file = (dir,part) => { const f = readdirSync(dir).find(x=>norm(x).includes(norm(part))&&x.endsWith(".csv")); return f?parseCSV(readFileSync(join(dir,f),"utf8")):null; };

// ── Master Input → round → {course, format, scoring_type} ───────────────────
const FMT = f => { const n=norm(f); return n.includes("stableford")?"stableford"
  : n.includes("tilt")?"tilt"
  : n.includes("dot")||n.includes("dozen")?"dots"
  : (n.includes("teambestball")||n==="teambestball"||n.includes("top4")||n.includes("8man")||n.includes("topnet"))?"contribution"
  : "match_status"; };
const FMTNAME = f => { const n=norm(f);
  return n.includes("dozen")?"dirty_dozen":
    n.includes("doubledot")?"double_dot":
    n.includes("stableford")?"2man_stableford":
    n.includes("singles")?"singles":
    n.includes("scramble")?"2man_scramble":
    n.includes("hilo")?"2man_hi_lo":
    n.includes("pinehurst")?"pinehurst":
    n.includes("shamble")?"shamble":
    n.includes("tilt")?"2man_tilt":
    (n.includes("top4")||n.includes("8man"))?"8man_top4net":
    (n.includes("2man")&&n.includes("bestball"))?"2man_best_ball":
    n.includes("bestball")?"team_best_ball": f.trim(); };
// formats by round from scorecard headers (universal: present every year, unlike the Master Input format row)
function formatsFromScorecards(dir){
  const out={};
  for(let r=1;r<=4;r++){ const rows=file(dir,`R${r}_G1`); if(!rows) continue;
    const hr=rows.find(x=>String(x[0]).trim()==="Hole:" && x[1] && /[a-z]/i.test(x[1]) && norm(x[1])!=="hole");
    if(hr) out[r]={format:FMTNAME(hr[1]), scoring_type:FMT(hr[1])};
  }
  return out;
}
function extractMaster(rows){
  const out={};
  // the "Teams, Players, Courses, & Handis" row holds course/format pairs at stride 2 from col 4
  const r = rows.find(x => norm(x[0]).includes("teamsplayerscourses"));
  if(r){ for(let rd=1;rd<=4;rd++){ const c=r[4+(rd-1)*2], f=r[5+(rd-1)*2];
    if(f && norm(f).match(/dozen|singles|scramble|bestball|hilo|dot|tilt|stableford/))
      out[rd]={course:(c||"").trim(), format:FMTNAME(f), scoring_type:FMT(f)}; } }
  return out;
}

// ── ALL SCORES → records[{player,round,ch, gross[18],net[18], grossTot,netTot,
//                          metrics:{matchRoyale,netParsOrBetter,eagles,birdies,pars,bogies,doubles},
//                          course, parHoles[18], index[18]}] ──────────────────
function extractAllScores(rows){
  const recs=[];
  // locate each round block by a col-1 "Round N" cell
  const blocks=[]; rows.forEach((r,i)=>{ const m=String(r[0]).match(/^Round ([1-4])$/); if(m) blocks.push({round:+m[1],start:i,course:(r[3]||"").trim()}); });
  for(let bi=0;bi<blocks.length;bi++){
    const b=blocks[bi]; const end=blocks[bi+1]?blocks[bi+1].start:rows.length;
    const handi = rows[b.start+2]?.slice(4,22).map(num);     // hole index row (cols 5-22)
    const par   = rows[b.start+3]?.slice(4,22).map(num);     // par row on the Player header line
    for(let i=b.start+4;i<end;i++){
      const r=rows[i]; const name=(r[0]||"").trim();
      if(!name) continue;
      if(name.match(/^(Round|GROSS|NET|Player|Hole|Handi|Par)/i)) continue;  // header/label rows
      if(/^ghost$/i.test(name)) continue;   // 2020 borrowed-scores ghost: no facts (handled as flag in Phase 2)
      const pid=resolve(name); if(!pid){ recs.push({unresolved:name,round:b.round}); continue; }
      const ch=num(r[1]); const gross=r.slice(4,22).map(num); const net=r.slice(32,50).map(num);
      if(gross.filter(x=>x!=null).length<18 || net.filter(x=>x!=null).length<18) continue;
      recs.push({ player:pid, round:b.round, ch, gross, net,
        grossTot:num(r[24]), netTot:num(r[25]),
        course:b.course, parHoles:par, index:handi,
        metrics:{ netParsOrBetter:num(r[55]), matchRoyale:num(r[56]),
          eagles:num(r[57]), birdies:num(r[58]), pars:num(r[59]), bogies:num(r[60]), doubles:num(r[61]) } });
    }
  }
  return recs;
}

const strokesOn=(ch,idx)=> ch==null||idx==null?null: Math.floor(ch/18)+(idx<=((ch%18+18)%18)?1:0);

// ── build locked facts for one year ─────────────────────────────────────────
function buildYear(dir){
  const year=+String(dir).match(/\d{4}/)?.[0];
  const master=extractMaster(file(dir,"Master_Input")||[]);
  const scFmts=formatsFromScorecards(dir);
  for(let r=1;r<=4;r++){ if(!master[r]&&scFmts[r]) master[r]=scFmts[r];        // fill missing from scorecards
    else if(master[r]&&scFmts[r]&&master[r].format==="?") master[r]={...master[r],...scFmts[r]}; }
  const recs=extractAllScores(file(dir,"ALL_SCORES")||[]);
  const playerHole=[], playerRound=[], unresolved=new Set();
  for(const s of recs){
    if(s.unresolved){ unresolved.add(s.unresolved); continue; }
    const cfg=master[s.round]||{}; const fmt=cfg.format||"?", st=cfg.scoring_type||"?", course=s.course||cfg.course;
    s.net.forEach((n,i)=>{
      const idx=s.index?.[i]??null, par=s.parHoles?.[i]??null, sr=strokesOn(s.ch,idx);
      playerHole.push({ year, round:s.round, format:fmt, scoring_type:st, course,
        player:s.player, hole:i+1, seq:i+1, par, hole_index:idx, segment:i<9?"front":"back",
        gross:s.gross[i], net:n, strokes_received:sr,
        net_vs_par: par!=null?n-par:null,
        hole_result:null, status_after:null, contribution_counted:null, involves_ghost:false });
    });
    const parTot=(s.parHoles||[]).reduce((a,b)=>a+(b||0),0)||null;
    playerRound.push({ year, round:s.round, format:fmt, scoring_type:st, course,
      player:s.player, course_handicap:s.ch, gross_total:s.grossTot, net_total:s.netTot,
      net_vs_par: parTot?s.netTot-parTot:null, ...s.metrics });
  }
  return { year, master, playerHole, playerRound, unresolved:[...unresolved] };
}

// ── self-validation ──────────────────────────────────────────────────────────
function validate(y){
  const e=[], soft=[]; const byPR={};
  for(const h of y.playerHole)(byPR[`${h.player}|${h.round}`]??=[]).push(h);
  for(const [k,hs] of Object.entries(byPR)){
    if(hs.length!==18) e.push(`${k}: ${hs.length} holes`);
    const netSum=hs.reduce((a,h)=>a+h.net,0);
    const pr=y.playerRound.find(p=>`${p.player}|${p.round}`===k);
    if(pr&&pr.net_total!=null){
      const frac = pr.net_total % 1 !== 0;                       // scramble team-handicap remainder
      const gap = Math.abs(netSum - pr.net_total);
      const tol = (pr.format==="2man_scramble" || frac) ? 1 : 0; // sub-1 allowance only for fractional formats
      if(gap > tol) e.push(`${k}: hole-net Σ ${netSum} ≠ stated net ${pr.net_total}`);
    }
    for(const h of hs) if(h.gross!=null&&h.strokes_received!=null&&h.gross-h.strokes_received!==h.net)
      soft.push(`${k} h${h.hole}`);
  }
  return { hard:e, softStrokes:soft.length };
}

// ── run ───────────────────────────────────────────────────────────────────────
const args=process.argv.slice(2);
const MERGE=args.includes("--append")||args.includes("--merge");   // opt-in: preserve existing years
const dirs=args.filter(a=>!a.startsWith("--"));
const all={playerHole:[],playerRound:[]}; let issues=0;
const incomingYears=new Set();
for(const d of dirs){
  const y=buildYear(d); const {hard,softStrokes}=validate(y);
  incomingYears.add(y.year);
  all.playerHole.push(...y.playerHole); all.playerRound.push(...y.playerRound);
  console.log(`\n${y.year}: ${y.playerHole.length} hole facts · ${y.playerRound.length} round facts`);
  console.log(`   rounds: `+Object.entries(y.master).map(([r,c])=>`R${r} ${c.format}(${c.scoring_type})`).join(" · "));
  if(y.unresolved.length) console.log(`   ⚠ unresolved: ${y.unresolved.join(", ")}`);
  if(hard.length){ issues+=hard.length; console.log("   ✗ "+hard.slice(0,6).join("\n   ✗ ")+(hard.length>6?`\n   …+${hard.length-6} more`:"")); }
  else console.log("   ✓ validation PASS — 18 holes/round, hole-net Σ = stated net total");
  if(softStrokes) console.log(`   · note: ${softStrokes} holes where derived stroke-alloc ≠ sheet net (expected in dots/scramble; sheet net is authoritative)`);
}
const outPath=join(DATA_DIR, "bourbon-cup-backbone.json");
let merged=all;
if(MERGE){
  let prior={playerHole:[],playerRound:[]};
  try{ prior=JSON.parse(readFileSync(outPath,"utf8")); }catch{}
  const keep=arr=>(arr||[]).filter(x=>!incomingYears.has(x.year));   // drop incoming years for idempotent re-runs
  merged={
    playerHole:[...keep(prior.playerHole),...all.playerHole],
    playerRound:[...keep(prior.playerRound),...all.playerRound],
  };
  const yrs=[...new Set(merged.playerRound.map(p=>p.year))].sort();
  console.log(`\n→ MERGE mode: incoming [${[...incomingYears].sort().join(",")}] into existing → years now [${yrs.join(",")}]`);
}
writeFileSync(outPath,JSON.stringify(merged,null,2));
console.log(`\n→ bourbon-cup-backbone.json (${merged.playerHole.length} hole facts, ${merged.playerRound.length} round facts)`+(issues?` · ${issues} issues`:" · clean"));