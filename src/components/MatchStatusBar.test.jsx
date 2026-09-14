// ══════════════════════════════════════════════════════════════════
//  MatchStatusBar — what the band over a match box says
// ══════════════════════════════════════════════════════════════════
//
// Rendered to a string, as BC's other component tests are (see
// Popup.test.jsx). What is pinned here is the SHAPE of what it prints, since
// the wording is the one thing about this bar that has to be right: it sits
// over two men in a foursome holding two matches, and a verdict that could
// be read as the other match's is worse than no verdict at all.
//
// The caller builds `verdict` — see `matchBar` in App, where the absolute
// wording is decided. This file covers what the band does with what it is
// handed, and the two rules that are the component's own: an empty segment
// list draws no chips at all, and a chip prints its label with its verdict.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchStatusBar } from "./MatchStatusBar";

const html = (props) => renderToStaticMarkup(<MatchStatusBar {...props} />);
const text = (markup) => markup
  .replace(/<[^>]+>/g, "|")
  .split("|")
  .map(t => t.trim())
  .filter(Boolean);

describe("MatchStatusBar", () => {
  it("leads with the verdict", () => {
    expect(text(html({ verdict: "Aaron J 2 UP", leader: "A" }))).toEqual(["Aaron J 2 UP"]);
  });

  // The common case, and the one the design is for: a round that is not
  // played as a Nassau has no front or back segment, so the caller hands over
  // an empty list and the band is one line of text.
  it("draws nothing but the verdict when there are no segments", () => {
    const out = html({ verdict: "TIED", leader: null });
    expect(text(out)).toEqual(["TIED"]);
    expect(out).not.toMatch(/FRONT|BACK/);
  });

  it("prints each segment as its label and its verdict", () => {
    const out = html({
      verdict: "Aaron J 2 UP", leader: "A",
      segments: [
        { key: "f", label: "FRONT", verdict: "1 UP", leader: "A" },
        { key: "b", label: "BACK", verdict: "—", leader: null },
      ],
    });
    expect(text(out)).toEqual(["Aaron J 2 UP", "FRONT 1 UP", "BACK —"]);
  });

  // OVERALL is the primary text. A chip for it would be the same number at
  // two thirds the size, eight pixels to the right of itself — which is the
  // redundancy this bar was built to retire.
  it("never carries an OVERALL chip", () => {
    const out = html({
      verdict: "Aaron J 2 UP", leader: "A",
      segments: [{ key: "f", label: "FRONT", verdict: "1 UP", leader: "A" }],
    });
    expect(out).not.toMatch(/OVERALL/);
  });

  // A level match has nobody to name and nobody to colour. The band falls
  // back to the neutral ground rather than picking a side.
  it("takes no side's colour when nobody leads", () => {
    const level = html({ verdict: "TIED", leader: null });
    const led = html({ verdict: "Aaron J 2 UP", leader: "A" });
    expect(level).not.toEqual(led);
    expect(text(level)).toEqual(["TIED"]);
  });

  // It is a band, not a control: nothing in it is tappable, so nothing in it
  // should render as a button.
  it("is not interactive", () => {
    expect(html({ verdict: "Aaron J 2 UP", leader: "A" })).not.toMatch(/<button|<a /);
  });
});
