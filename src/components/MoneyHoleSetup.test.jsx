/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The money hole is not offered on a shared ball
// ══════════════════════════════════════════════════════════════════
//
// It is lowest NET on one designated hole, and on a scramble or a Pinehurst a
// side plays one ball between them. Both partners post that ball's gross, but
// every side game in lib/betting allocates off each man's OWN full Course
// Handicap — so the weaker half of every pair beats his partner on a ball he
// only half hit, and takes a share of the pot for it.
//
// That was a director's switch, defaulting to ON, with a warning strip telling
// him to flip it. A warning a director has to act on is a warning a director
// forgets, and this one costs money on a Sunday. So it is a rule, and the
// thing that has to be true on screen is that there is no control to flip:
// the round still draws a row — a director looking for round 3 has to find it
// — and that row is not a switch.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";

import { MoneyHoleSetup } from "./MoneyHoleSetup";
import { moneyHolePars } from "../lib/betting";

afterEach(cleanup);

const course = {
  id: "c1", par: 72,
  hole_pars: Array(18).fill(4),
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
};
// Round 3 is the scramble; the other three are played with a man's own ball.
const tRounds = [
  { round_number: 1, course_id: "c1", format: "singles" },
  { round_number: 2, course_id: "c1", format: "best_ball" },
  { round_number: 3, course_id: "c1", format: "scramble" },
  { round_number: 4, course_id: "c1", format: "team_best_ball" },
];

const setup = (props = {}) => {
  const onToggleRound = vi.fn();
  const utils = render(
    <MoneyHoleSetup
      hole={18}
      pars={moneyHolePars({ rounds: [1, 2, 3, 4], hole: 18, tRounds, courses: [course], roundLocks: {} })}
      only={null}
      players={[]}
      amount={0}
      ids={null}
      onSetHole={() => {}}
      onToggleRound={onToggleRound}
      onChangeBuyIn={() => {}}
      {...props}
    />,
  );
  const rowFor = (n) => utils.getByText(new RegExp(`^RD ${n} · `)).closest("div, button");
  return { ...utils, onToggleRound, rowFor };
};

describe("MoneyHoleSetup — the rounds", () => {
  it("draws a switch for every round a man plays his own ball in", () => {
    const { container } = setup();
    const switches = container.querySelectorAll('[role="switch"]');
    expect([...switches].map(s => s.textContent.match(/^RD (\d)/)[1])).toEqual(["1", "2", "4"]);
    expect([...switches].every(s => s.getAttribute("aria-checked") === "true")).toBe(true);
  });

  it("draws the scramble round as a row with no switch on it", () => {
    const { rowFor } = setup();
    const row = rowFor(3);
    expect(row.tagName).toBe("DIV");
    expect(row.getAttribute("role")).toBeNull();
    // It reads OFF, and the format line says why — the one line in this
    // console a director cannot act without.
    expect(within(row).getByText("OFF")).toBeTruthy();
    expect(row.textContent).toContain("2-Man Scramble · one ball, not offered");
  });

  it("cannot be switched back on", () => {
    const { rowFor, onToggleRound } = setup();
    fireEvent.click(rowFor(3));
    expect(onToggleRound).not.toHaveBeenCalled();
  });

  // The stored list is the director's own answer and knows nothing about
  // formats — see lib/betting. A round he named is still not offered, and a
  // round he declined still draws its switch, off.
  it("ignores a stored list that names the scramble, and keeps the rest switchable", () => {
    const { rowFor, onToggleRound } = setup({ only: [1, 3] });
    expect(rowFor(3).tagName).toBe("DIV");
    expect(rowFor(1).getAttribute("aria-checked")).toBe("true");
    expect(rowFor(2).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(rowFor(2));
    expect(onToggleRound).toHaveBeenCalledWith(2, true);
  });

  // The strip that told him to switch the scramble off is gone with the
  // switch. What is left is the par 3 warning, which IS still his call.
  it("no longer tells the director to switch anything off", () => {
    const { queryByText } = setup();
    expect(queryByText(/A SHARED BALL/)).toBeNull();
    expect(queryByText(/unless you mean it/)).toBeNull();
  });

  it("still warns about a par 3, on the rounds it is played in", () => {
    const par3 = { ...course, hole_pars: Array(18).fill(4).map((p, i) => (i === 17 ? 3 : p)) };
    const { getByText } = setup({
      pars: moneyHolePars({ rounds: [1, 2, 3, 4], hole: 18, tRounds, courses: [par3], roundLocks: {} }),
    });
    // Rounds 1, 2 and 4 — not the scramble, which is not being played for.
    expect(getByText(/HOLE 18 IS A PAR 3 ON ROUNDS 1, 2, 4/)).toBeTruthy();
  });
});
