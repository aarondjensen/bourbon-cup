// Bourbon Cup — canonical player identity, shared across all years.
// canonical_id : { name (display), aliases:[year-variant names], first, last }
// Resolver normalizes (lowercase, strip non-alphanumerics) so "Aaron J" / "Aaron Jensen" → jensen.
//
// ── first / last ──────────────────────────────────────────────────
// The app shows every player as FIRST NAME + LAST INITIAL — "Kevin J" — and
// stores that on the roster row (see toDisplayName in AdminView). The sheets
// did not: the early years wrote people that way, the later ones went to
// handles, so the registry's display name is "KJ" for one man and "Nick S" for
// the one beside him.
//
// So the real name is recorded here, once, and `formalName` builds the app's
// form from it. Only the handles need an entry — a display name that is
// already "First L" is read as first + initial and needs nothing.
//
// Six players have no entry because nothing in the sheets or the aliases says
// what their name is: Telly, House, Elger, T-Mo, Hile, Weezy. They keep their
// handle until somebody who knows fills it in, which is the honest failure —
// a guessed surname is worse than a nickname.
export const PLAYERS = {
  // core (2020/2023/2025 era)
  jensen:{name:"Jensen",  aliases:["Aaron J","Aaron Jensen"], first:"Aaron", last:"Jensen"},
  kj:    {name:"KJ",      aliases:["Kevin J","Kevin Jensen"], first:"Kevin", last:"Jensen"},
  telly: {name:"Telly",   aliases:[]},
  rmac:  {name:"R-Mac",   aliases:["RMac","Ryan M"], first:"Ryan", last:"M"},
  house: {name:"House",   aliases:[]},
  tjsc:  {name:"TJSC",    aliases:["Tj Crawforth","TJ"], first:"TJ", last:"Crawforth"},
  dk:    {name:"DK",      aliases:["Dave K","David Kelley"], first:"Dave", last:"Kelley"},
  saugy: {name:"Saugy",   aliases:["Paul Sauter","Paul S"], first:"Paul", last:"Sauter"},   // Paul S = Saugy: confirmed same person
  elger: {name:"Elger",   aliases:[]},
  andy:  {name:"Andy",    aliases:["Andy H","Andrew Harris"], first:"Andy", last:"Harris"},
  pace:  {name:"Pace",    aliases:["Adam P","Adam Pace"], first:"Adam", last:"Pace"},
  tmo:   {name:"T-Mo",    aliases:[]},
  joeo:  {name:"Joe O",   aliases:["Joe O'Connell"], first:"Joe", last:"O'Connell"},
  hile:  {name:"Hile",    aliases:[]},
  weezy: {name:"Weezy",   aliases:[]},
  // introduced in 2016 roster
  bent:  {name:"Ben T",   aliases:[]},
  daveb: {name:"Dave B",  aliases:[]},
  paulw: {name:"Paul W",  aliases:[]},
  timc:  {name:"Tim C",   aliases:[]},
  jimh:  {name:"Jim H",   aliases:[]},
  johns: {name:"John S",  aliases:[]},   // 2016 CH -4 confirmed genuine (scratch-plus player), not a data error
  petec: {name:"Pete C",  aliases:["Carp"]},   // = Carp: confirmed same person (handle changed ~2022; carp folded → petec)
  // introduced in 2017 roster
  kylem: {name:"Kyle M",  aliases:[]},
  matth: {name:"Matt H",  aliases:[]},
  grants:{name:"Grant S", aliases:[]},
  nicks: {name:"Nick S",  aliases:["CuzNick"]},   // = CuzNick: confirmed same person (handle changed ~2022; cuznick folded → nicks)
  // introduced in 2018 roster
  shaunw:{name:"Shaun W", aliases:[]},
  // introduced in 2020 roster (Julius P, Scott R — both confirmed real players; 2020 only)
  juliusp:{name:"Julius P", aliases:[]},
  scottr: {name:"Scott R",  aliases:[]},
};

export const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function buildResolver(extraAliases = {}) {
  const map = new Map();
  for (const [id, {name, aliases}] of Object.entries(PLAYERS)) {
    map.set(norm(name), id); map.set(norm(id), id);
    for (const a of aliases) map.set(norm(a), id);
  }
  for (const [a, id] of Object.entries(extraAliases)) map.set(norm(a), id);
  return raw => map.get(norm(raw)) ?? null;
}

export const displayName = id => PLAYERS[id]?.name ?? id;

// ── The name the app shows ────────────────────────────────────────
// First name + last initial, which is what every screen outside the admin
// console renders and what AdminView writes onto a roster row.
//
// Three sources, in order: the recorded real name; a display name that is
// already in that form ("Nick S" — the early sheets wrote everybody this way);
// otherwise the handle, unchanged, because a made-up surname would be worse
// than a nickname.
const ALREADY_FORMAL = /^(.+) ([A-Za-z])$/;

export const realName = (id) => {
  const p = PLAYERS[id];
  if (!p) return null;
  if (p.first) return { first: p.first, last: p.last || "" };
  const m = ALREADY_FORMAL.exec(p.name || "");
  return m ? { first: m[1], last: m[2] } : null;
};

export const formalName = (id) => {
  const real = realName(id);
  if (!real) return displayName(id);
  return real.last ? `${real.first} ${real.last[0].toUpperCase()}` : real.first;
};
