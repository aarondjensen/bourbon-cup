// ── Hole outcome → cell fill ──────────────────────────────────────
// THE definition of what a played hole looks like. The Leaderboard's match
// cards and the Scoring tab's status bar both paint their cells from here,
// so a hole can never be drawn one way on one screen and another way on the
// next.
//
// Most formats settle a hole once: A won it, B won it, or it was halved.
// Double Dot settles it TWICE — the low-ball match and the high-ball match
// each hand out a dot, and either can be tied away. That's four outcomes per
// hole rather than three, and the fill says which:
//
//   2 dots to one side  →  solid team colour
//   1 dot each          →  diagonal split, half of each team's colour
//   1 dot and a tie     →  diagonal split, the winner's half against grey
//   both tied           →  solid grey, exactly like any halved hole
//
// A format that only hands out one unit per hole can only ever produce the
// first and last of those, so it renders precisely as it always did.
//
// ── The format to pass ─────────────────────────────────────────────
// `format` here is the format the hole was SCORED under — scoring.js's
// holeFormatFor(match, format) — NEVER the round's format on its own. A round
// whose HOLE SCORING axis is set to best_ball hands back net strokes no matter
// what format it is called, and reading a Double Dot round's net 4 and 5 as
// "one dot each" paints every played hole as a split when nothing was split.
import { BC, ink, teamColor } from "../theme";

// Formats where a hole is worth two units instead of one. A set rather than a
// boolean so a second dot format costs one line.
const TWO_UNIT_FORMATS = new Set(["double_dot"]);

// What each side took from this hole, normalised across formats. For a dot
// format that's the dots themselves (already sitting in aScore/bScore); for
// everything else it's the single unit the hole is worth, to whoever won it.
export function holeUnits(hole, format) {
  const played = !!hole?.played;
  if (TWO_UNIT_FORMATS.has(format)) {
    return {
      played,
      a: played ? (hole.aScore ?? 0) : 0,
      b: played ? (hole.bScore ?? 0) : 0,
      max: 2,
    };
  }
  return {
    played,
    a: played && hole.winner === "A" ? 1 : 0,
    b: played && hole.winner === "B" ? 1 : 0,
    max: 1,
  };
}

// The cell's background (and border, when there's nothing to show yet).
// `settled` dims a still-moving result — the same in-play language the rest
// of the board speaks.
export function holeFill(hole, format, settled = true) {
  const { played, a, b, max } = holeUnits(hole, format);
  if (!played) return { background: "transparent", border: `1px solid ${BC.bdr}` };

  const HALVED = `${BC.t3}55`;
  if (!a && !b) return { background: HALVED, border: "none" };

  const A = ink(teamColor("A"), settled);
  const B = ink(teamColor("B"), settled);
  if (a === max) return { background: A, border: "none" };
  if (b === max) return { background: B, border: "none" };

  // Split hole. The seam runs bottom-left to top-right, putting team A in the
  // upper-left wedge and team B in the lower-right — the same left/right
  // geometry the match rows use, so the wedge a colour sits in already tells
  // you whose side of the card it belongs to. A side that won only one of the
  // two dots shares the cell with halved grey.
  //
  // 135deg is the axis, not the seam: CSS measures the gradient's direction
  // (down-right here), and the colour boundary sits perpendicular to it.
  return {
    background: `linear-gradient(135deg, ${a ? A : HALVED} 0 50%, ${b ? B : HALVED} 50% 100%)`,
    border: "none",
  };
}
