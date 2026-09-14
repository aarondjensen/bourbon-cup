// ══════════════════════════════════════════════════════════════════
//  TurnCard — the numbers on the card, and what else is allowed on it
// ══════════════════════════════════════════════════════════════════
//
// Rendered to a string, the way BC's other component tests are (see
// Popup.test.jsx). Under Node `document` is undefined, so Popup skips the
// portal and the overlay comes back inline — the `portal` prop changes
// nothing here.
//
// Two things are worth pinning. The OUT column, because a turn card that adds
// up wrong is worse than no turn card at all: it is a number four men will
// check their own memory against and agree with. And what the card is allowed
// to carry BESIDES the gross — the match bar goes on it only when the caller
// says so, and the caller is the only one that knows about a sealed round.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TurnCard } from "./TurnCard";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5];   // out in 36
const row = (key, names, scores) => ({ key, names, scores });
const section = (key, rows, bar = null) => ({ key, rows, bar });
const BAR = {
  verdict: "Aaron J 2 UP", leader: "A", settled: false,
  segments: [{ key: "f", label: "FRONT", verdict: "2 UP", leader: "A" }],
};

const html = (props) => renderToStaticMarkup(
  <TurnCard pars={PARS} sections={[]} onJump={() => {}} onClose={() => {}} {...props} />
);
// The rendered text, cell by cell in document order, with the markup gone.
const cells = (markup) => markup
  .replace(/<[^>]+>/g, "|")
  .split("|")
  .map(t => t.trim())
  .filter(Boolean);

describe("TurnCard", () => {
  it("adds the nine into OUT", () => {
    const out = html({ sections: [section("m1", [row("p1", ["Aaron J"], [4, 5, 3, 6, 4, 4, 2, 4, 5])])] });
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

  // The numbers stay gross. The Full Scorecard behind the Scoring tab's own
  // button prints net, strokes and a running line under every hole; this is
  // the "is that what you shot?" card, and anything in the grid beyond the
  // raw number is something to read past.
  it("says nothing about net or strokes", () => {
    const out = html({ sections: [section("m1", [row("p1", ["Aaron J"], [4, 5, 3, 6, 4, 4, 2, 4, 5])], BAR)] });
    expect(out).not.toMatch(/net|stroke|▲|▼/i);
  });

  // ── The match bar ────────────────────────────────────────────────
  // The turn is when the front nine settles, which is the one moment the
  // match state is the reason anybody is reading the numbers.
  it("heads a section with its match's verdict and its front nine", () => {
    const out = html({ sections: [section("m1", [row("p1", ["Aaron J"], Array(9).fill(4))], BAR)] });
    expect(cells(out)).toContain("Aaron J 2 UP");
    expect(cells(out)).toContain("FRONT 2 UP");
  });

  // A sealed round, or a team round whose match is the whole side across four
  // tee times. The caller is the only one that knows either, and says so by
  // handing over no bar — the card is then the gross grid it has always been.
  it("carries no bar at all when the caller gives none", () => {
    const out = html({ sections: [section("m1", [row("p1", ["Aaron J"], Array(9).fill(4))])] });
    expect(cells(out)).toContain("Aaron J");
    expect(out).not.toMatch(/UP|DN|TIED|FRONT|BACK/);
  });

  // A singles tee group is two matches, each with its own front nine to have
  // won, and each bar belongs over its own two men.
  it("heads each match of a foursome separately", () => {
    const out = html({
      sections: [
        section("m3", [row("p1", ["Aaron J"], Array(9).fill(4)), row("p2", ["Dave S"], Array(9).fill(5))], BAR),
        section("m4", [row("p3", ["Ben T"], Array(9).fill(4)), row("p4", ["Shaun W"], Array(9).fill(4))],
          { verdict: "TIED", leader: null, settled: false, segments: [] }),
      ],
    });
    const c = cells(out);
    expect(c).toContain("Aaron J 2 UP");
    expect(c).toContain("TIED");
    // Each bar sits above the two men it is about, not all of them at the top.
    expect(c.indexOf("Aaron J 2 UP")).toBeLessThan(c.indexOf("Aaron J"));
    expect(c.indexOf("TIED")).toBeGreaterThan(c.indexOf("Dave S"));
    expect(c.indexOf("TIED")).toBeLessThan(c.indexOf("Ben T"));
  });

  // A shared-ball side is ONE card with ONE set of numbers — the side plays
  // one ball. Two rows here would disagree with the score buttons behind it.
  // Both names still appear, stacked, because a row nobody can put a name to
  // is a row nobody checks.
  it("draws a shared-ball side as one row carrying both names", () => {
    const out = html({ sections: [section("m1", [row("a_b", ["Aaron J", "Dave S"], Array(9).fill(4))])] });
    expect(cells(out)).toContain("Aaron J");
    expect(cells(out)).toContain("Dave S");
    // Par's 36 and the side's 36 — two totals, not one per partner.
    expect(cells(out).filter(t => t === "36")).toHaveLength(2);
  });

  // A hole nobody has posted prints nothing rather than a 0, and OUT stays
  // blank rather than claiming a nine that is not there.
  it("leaves an unposted hole and its total blank", () => {
    const out = html({ sections: [section("m1", [row("p1", ["Aaron J"], Array(9).fill(0))])] });
    expect(cells(out)).not.toContain("0");
  });

  it("makes every hole number a button back to that hole", () => {
    // Nine holes, plus the one CTA. Popup's own ✕ is off by default.
    expect((html({}).match(/<button/g) || []).length).toBe(10);
  });
});
