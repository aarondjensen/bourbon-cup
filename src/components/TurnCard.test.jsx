// ══════════════════════════════════════════════════════════════════
//  TurnCard — the numbers on the card, and the way back to a hole
// ══════════════════════════════════════════════════════════════════
//
// Rendered to a string, the way BC's other component tests are (see
// Popup.test.jsx): this pins SHAPE and ARITHMETIC, which is all this popup
// has. Under Node `document` is undefined, so Popup skips the portal and the
// overlay comes back inline — the `portal` prop changes nothing here.
//
// What is worth pinning is the OUT column, because a turn card that adds up
// wrong is worse than no turn card at all: it is a number four men will check
// their own memory against and agree with.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TurnCard } from "./TurnCard";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5];   // out in 36
const row = (key, names, scores) => ({ key, names, scores });

const html = (props) => renderToStaticMarkup(
  <TurnCard pars={PARS} rows={[]} onJump={() => {}} onClose={() => {}} {...props} />
);
// The rendered text, cell by cell in document order, with the markup gone.
const cells = (markup) => markup
  .replace(/<[^>]+>/g, "|")
  .split("|")
  .map(t => t.trim())
  .filter(Boolean);

describe("TurnCard", () => {
  it("adds the nine into OUT", () => {
    const out = html({ rows: [row("p1", ["Aaron J"], [4, 5, 3, 6, 4, 4, 2, 4, 5])] });
    expect(cells(out)).toContain("37");
  });

  it("totals the par row", () => {
    expect(cells(html({}))).toContain("36");
  });

  it("prints every hole number 1 through 9, and no more", () => {
    const c = cells(html({}));
    expect(c.slice(c.indexOf("HOLE") + 1, c.indexOf("OUT"))).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
    );
  });

  // Gross only. The Full Scorecard behind the Scoring tab's own button prints
  // net, strokes and the match state; this one is the "is that what you
  // shot?" card, and anything else on it is something to read past. It is
  // also what makes it safe to raise on a sealed round.
  it("says nothing about net, strokes or the match", () => {
    const out = html({ rows: [row("p1", ["Aaron J"], [4, 5, 3, 6, 4, 4, 2, 4, 5])] });
    expect(out).not.toMatch(/net|stroke|▲|▼/i);
  });

  // A shared-ball side is ONE card with ONE set of numbers — the side plays
  // one ball. Two rows here would disagree with the score buttons behind it.
  // Both names still appear, stacked, because a row nobody can put a name to
  // is a row nobody checks.
  it("draws a shared-ball side as one row carrying both names", () => {
    const out = html({ rows: [row("a_b", ["Aaron J", "Dave S"], Array(9).fill(4))] });
    expect(cells(out)).toContain("Aaron J");
    expect(cells(out)).toContain("Dave S");
    // Par's 36 and the side's 36 — two totals, not one per partner.
    expect(cells(out).filter(t => t === "36")).toHaveLength(2);
  });

  // A hole nobody has posted prints nothing rather than a 0, and OUT stays
  // blank rather than claiming a nine that is not there.
  it("leaves an unposted hole and its total blank", () => {
    const out = html({ rows: [row("p1", ["Aaron J"], Array(9).fill(0))] });
    expect(cells(out)).not.toContain("0");
  });

  it("makes every hole number a button back to that hole", () => {
    // Nine holes, plus the one CTA. Popup's own ✕ is off by default.
    expect((html({}).match(/<button/g) || []).length).toBe(10);
  });
});
