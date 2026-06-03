// Bourbon Cup — canonical player identity, shared across all years.
// canonical_id : { name (display), aliases:[year-variant names] }
// Resolver normalizes (lowercase, strip non-alphanumerics) so "Aaron J" / "Aaron Jensen" → jensen.

export const PLAYERS = {
  // core (2020/2023/2025 era)
  jensen:{name:"Jensen",  aliases:["Aaron J","Aaron Jensen"]},
  kj:    {name:"KJ",      aliases:["Kevin J","Kevin Jensen"]},
  telly: {name:"Telly",   aliases:[]},
  cuznick:{name:"CuzNick",aliases:[]},
  rmac:  {name:"R-Mac",   aliases:["RMac","Ryan M"]},
  house: {name:"House",   aliases:[]},
  tjsc:  {name:"TJSC",    aliases:["Tj Crawforth","TJ"]},
  dk:    {name:"DK",      aliases:["Dave K","David Kelley"]},
  saugy: {name:"Saugy",   aliases:["Paul Sauter","Paul S"]},   // ⚑ Paul S (2016, CH36) ASSUMED = Saugy (CH33 '23) — confirm
  elger: {name:"Elger",   aliases:[]},
  andy:  {name:"Andy",    aliases:["Andy H","Andrew Harris"]},
  pace:  {name:"Pace",    aliases:["Adam P","Adam Pace"]},
  tmo:   {name:"T-Mo",    aliases:[]},
  joeo:  {name:"Joe O",   aliases:["Joe O'Connell"]},
  hile:  {name:"Hile",    aliases:[]},
  weezy: {name:"Weezy",   aliases:[]},
  // introduced in 2016 roster
  bent:  {name:"Ben T",   aliases:[]},
  daveb: {name:"Dave B",  aliases:[]},
  paulw: {name:"Paul W",  aliases:[]},
  timc:  {name:"Tim C",   aliases:[]},
  jimh:  {name:"Jim H",   aliases:[]},
  johns: {name:"John S",  aliases:[]},
  petec: {name:"Pete C",  aliases:[]},
  // introduced in 2017 roster
  kylem: {name:"Kyle M",  aliases:[]},
  matth: {name:"Matt H",  aliases:[]},
  grants:{name:"Grant S", aliases:[]},
  nicks: {name:"Nick S",  aliases:[]},   // ⚑ possibly = CuzNick (a cousin named Nick)? kept separate pending confirm
  // introduced in 2018 roster
  shaunw:{name:"Shaun W", aliases:[]},
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
