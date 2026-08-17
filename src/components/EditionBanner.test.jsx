/** @vitest-environment jsdom */
// The row that offers the way home, and the one thing it cannot do: name a
// destination it does not go to.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EditionBanner } from "./EditionBanner";

vi.mock("../lib/editions", () => ({ switchEdition: vi.fn() }));

afterEach(cleanup);

const cup2026 = { id: "bc_2026", year: 2026, name: "The Bourbon Cup 2026" };
const cup2019 = { id: "bc_2019", year: 2019, name: "The Bourbon Cup 2019" };
const demo = { id: "bc_demo", year: 2026, name: "DEMO — Testers", is_demo: true };

describe("EditionBanner", () => {
  it("dates an ordinary year, which is what anybody names a cup by", () => {
    render(<EditionBanner viewing={cup2019} live={cup2026} />);
    expect(screen.getByRole("button").textContent).toBe("Back to 2026");
    expect(document.body.textContent).toContain("2019");
  });

  it("NAMES the demo, because its year is the real cup's year", () => {
    // Found on a phone: a director standing in bc_2026, on a store build where
    // the demo is home, was offered "Back to 2026" — the year he was already
    // in, on a button that went to the demo.
    render(<EditionBanner viewing={cup2026} live={demo} />);
    expect(screen.getByRole("button").textContent).toBe("Back to the demo");
    expect(document.body.textContent).not.toContain("Back to 2026");
  });

  it("names it from the other side too", () => {
    render(<EditionBanner viewing={demo} live={cup2026} />);
    expect(document.body.textContent).toContain("the demo");
    expect(screen.getByRole("button").textContent).toBe("Back to 2026");
  });

  it("falls back to names when two real editions share a year", () => {
    const other = { id: "bc_2026_b", year: 2026, name: "Second 2026" };
    render(<EditionBanner viewing={other} live={cup2026} />);
    expect(screen.getByRole("button").textContent).toBe("Back to The Bourbon Cup 2026");
  });

  it("renders nothing when there is nowhere to go", () => {
    const { container } = render(<EditionBanner viewing={cup2026} live={cup2026} />);
    expect(container.firstChild).toBeNull();
  });
});
