#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  Bourbon Cup — each year's team colours, off the SCOREBOARD banner.
// ══════════════════════════════════════════════════════════════════
//
// The workbooks carry one piece of team identity the CSV exports throw away:
// the SCOREBOARD tab opens with the two team names in a coloured banner, and
// that colour is the team's. 2024's Silver Foxes are #086FB2 — the blue behind
// the fox in their logo — and the Administration is black.
//
// Nothing else in the sheet says it. The Master Input's team cell is
// highlighted yellow because it is an input cell, and the rest of the
// workbook's colour is the template's own: four round headers, red ink for
// over par, green fills for birdies. So this reads the banner and nothing but
// the banner.
//
// pipeline/editions.mjs calls this as part of the build, so the colours are
// part of an edition rather than something stamped on afterwards — run on its
// own it just prints what it finds:
//
//   node pipeline/team-brand.mjs
//
// Written for the ACCENT only. A logo is a separate thing and only 2024's
// workbook has one embedded; extracting those needs a director's decision
// about that edition, not a pipeline pass.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const SHEETS_DIR = join(DATA_DIR, "historical sheets");
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// The banner sits in the first few rows. Below that is the scoreboard proper,
// whose colour is the template's.
const BANNER_ROWS = 6;

// Read a cell's fill and ink out of the workbook's style tables.
const styleReader = (dir) => {
  const styles = readFileSync(join(dir, "xl/styles.xml"), "utf8");
  const xfs = (/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] || "")
    .match(/<xf [^>]*\/>|<xf [\s\S]*?<\/xf>/g) || [];
  const fills = (/<fills count="\d+">([\s\S]*?)<\/fills>/.exec(styles)?.[1] || "")
    .match(/<fill>[\s\S]*?<\/fill>/g) || [];
  const fonts = (/<fonts count="\d+">([\s\S]*?)<\/fonts>/.exec(styles)?.[1] || "")
    .match(/<font>[\s\S]*?<\/font>/g) || [];
  const hex = (rgb) => (rgb ? "#" + rgb.slice(2).toUpperCase() : null);
  return (s) => {
    const e = xfs[s] || "";
    return {
      fill: hex(/rgb="([0-9A-Fa-f]{8})"/.exec(fills[Number(/fillId="(\d+)"/.exec(e)?.[1] ?? 0)] || "")?.[1]),
      ink: hex(/<color rgb="([0-9A-Fa-f]{8})"/.exec(fonts[Number(/fontId="(\d+)"/.exec(e)?.[1] ?? 0)] || "")?.[1]),
    };
  };
};

// A colour that identifies a side. The sheet's own furniture does not: the
// yellow input highlight, the greys it rules cells with, and the four shades
// the template paints round headers and group blocks in. Those appear in every
// year, including the ones that never had team colours at all.
const FURNITURE = new Set([
  "#FFFF00", "#FFFFFF", "#CCCCCC", "#D9D9D9", "#EFEFEF", "#F3F3F3", "#666666", "#434343",
  "#EA9999", "#6FA8DC", "#F6B26B", "#93C47D", "#F9CB9C", "#FFE599",
]);
const isIdentity = (hex) => !!hex && !FURNITURE.has(hex);

// How dark a fill has to be before it stops working as an accent. Three teams
// picked black — the Administration, WEEZ, Shot Callers — and a black accent
// on a dark screen is not a colour, it is an absence.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
const saturation = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
};

// The colour a side is actually rendered in. A black banner hands over to its
// TYPE, which is where a black team keeps its colour — Shot Callers' banner is
// black lettered in teal, and teal is what the app has always drawn them in.
// A black banner in black and white has no colour to give, and says so: the
// app's own palette is a better answer than a swatch nobody can see.
export const accentFrom = ({ fill, ink }) => {
  if (fill && luminance(fill) > 0.12) return fill;
  if (ink && luminance(ink) > 0.12 && saturation(ink) > 0.15) return ink;
  return null;
};

// Stored as the sheet has it, dark navy and all. The app lifts a brand colour
// for the dark theme and walks it down for the light one (theme.withBrand), so
// the document keeps the true colour and only the display is adjusted.

// ── What the banner does not say ──────────────────────────────────
// 2022 wrote its teams in coloured TYPE on a grey banner, and only got half
// way: Sautering Irons are lettered navy, HileDrivers in the default black.
// Aaron named the missing one — "irons are navy and drivers are red" — and the
// red is the sheet's own #CC0000, the colour that year uses for Drivers points
// further down the scoreboard, rather than a hex invented here.
//
// A year belongs in this table only when the workbook genuinely does not carry
// the colour. Everything else is read.
const NAMED_BY_HAND = {
  2022: { B: "#CC0000" },   // Drivers, red
};

export function teamBrandFor(year, teams) {
  const dir = join(SHEETS_DIR, String(year));
  const file = existsSync(dir) && readdirSync(dir).find((f) => f.endsWith(".xlsx"));
  if (!file) return null;
  const tmp = mkdtempSync(join(tmpdir(), `bc-${year}-`));
  try {
    execSync(`cd "${tmp}" && unzip -o -q "${join(dir, file)}"`);
    const wb = readFileSync(join(tmp, "xl/workbook.xml"), "utf8");
    const rels = readFileSync(join(tmp, "xl/_rels/workbook.xml.rels"), "utf8");
    const rid = /<sheet [^>]*id="(rId\d+)"/.exec(wb)?.[1];
    const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
    if (!target) return null;
    const styleOf = styleReader(tmp);
    const shared = readFileSync(join(tmp, "xl/sharedStrings.xml"), "utf8");
    const text = (shared.match(/<si>[\s\S]*?<\/si>/g) || [])
      .map((s) => (s.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(" ").trim());

    const xml = readFileSync(join(tmp, "xl", target.replace(/^\/?xl\//, "")), "utf8");
    const found = [];
    for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)" s="(\d+)" t="s"[^>]*><v>(\d+)<\/v>/g)) {
      if (Number(m[2]) > BANNER_ROWS) continue;
      const val = text[Number(m[4])];
      if (!val) continue;
      const { fill, ink } = styleOf(Number(m[3]));
      // A banner says its colour with a fill or with its TYPE. 2022 used type
      // on a grey banner, so a cell whose fill is furniture still counts when
      // it is lettered in something.
      const painted = isIdentity(fill) ? fill : null;
      if (!painted && !(isIdentity(ink) && saturation(ink) > 0.15)) continue;
      found.push({ col: m[1], text: val, fill: painted, ink });
    }
    if (!found.length) return null;

    // Match a banner to a side by name where the two agree — the scoreboard
    // writes a team out in full ("The Administration") where the Master Input
    // abbreviates it ("Admin"), so it is matched on either containing the
    // other rather than on equality.
    const matches = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
    const pick = (name) => found.find((f) => matches(f.text, name));
    let A = pick(teams.A), B = pick(teams.B);
    // Nothing matched by name: fall back to the two leftmost coloured cells,
    // in column order, which is the order the banner puts the sides in.
    if (!A && !B) {
      const distinct = [];
      for (const f of found.sort((a, b) => a.col.length - b.col.length || a.col.localeCompare(b.col))) {
        if (!distinct.some((d) => accentFrom(d) === accentFrom(f))) distinct.push(f);
      }
      [A, B] = distinct;
    }
    const told = NAMED_BY_HAND[year] || {};
    const side = (hit, named) => {
      const accent = named || (hit ? accentFrom(hit) : null);
      return accent || hit ? { text: hit?.text || "named by hand", fill: hit?.fill ?? null, accent } : null;
    };
    const out = { A: side(A, told.A), B: side(B, told.B) };
    if (!out.A || !out.B) return null;
    // Two sides painted the same colour is the banner saying nothing about
    // either of them — a template shade this file has not learned to ignore.
    if (out.A.accent && out.A.accent === out.B.accent) return null;
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── run ───────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const doc = JSON.parse(readFileSync(join(DATA_DIR, "bourbon-cup-editions.json"), "utf8"));
  for (const ed of doc.editions) {
    const brand = teamBrandFor(ed.year, ed.teams);
    if (!brand) { console.log(`${ed.year}  —  no banner colour in the workbook`); continue; }
    const line = (side, name) => `${name.padEnd(15)} banner ${String(brand[side].fill).padEnd(8)}` +
      ` → accent ${brand[side].accent || "(none — the app's own)"}   as "${brand[side].text.replace(/\s+/g, " ")}"`;
    console.log(`${ed.year}  ${line("A", ed.teams.A)}\n      ${line("B", ed.teams.B)}`);
  }
  console.log("\nThese are built into data/bourbon-cup-editions.json by `npm run build:editions`.");
}
