// ══════════════════════════════════════════════════════════════════
//  tally — what a side game is worth, written without a currency
// ══════════════════════════════════════════════════════════════════
//
// The four side games (skins, CTP, low net, the money hole) and the side-bet
// ledger used to render every figure through `money` in lib/ledger: a dollar
// sign, grouped thousands, cents when there were any. They no longer do.
//
// ── Why ────────────────────────────────────────────────────────────
// App Review rejected 1.0 (4) on 8 Sep 2026 under guideline 2.3.6, holding
// that the app "includes tips, tools, predictions or other information
// related to real money gambling, real money betting, or real money
// skill-based gaming" and must therefore carry the Gambling age-rating
// descriptor. Selecting it asks the developer to confirm gambling licensing
// in every territory the app ships to, and to geo-restrict the rest — a
// declaration that is not true of sixteen men playing skins in a rented
// house, and one there is no licence to attach to.
//
// So the app stopped denominating the games in money. Nothing about them
// changed otherwise: the same buy-in, the same arithmetic, the same division
// of the same total. What is gone is the claim that the number on screen is
// dollars. It is a figure the field agreed on, the app divides it, and what
// changes hands does so between sixteen men in a house, as it always did —
// no payment ever moved through this app.
//
// ── Why there is no unit word ──────────────────────────────────────
// "Points" was the obvious label and is taken: the CUP is scored in points —
// "POINTS AT STAKE" on a match, "MOST POINTS IN A CUP" in the records, a PTS
// column on the career table. A second meaning on that word, one tab away
// from the first, is how somebody ends up asking whether their skins count
// toward the cup. "Units", "chips" and "credits" are each worse: the first
// two are gambling vocabulary, which is the thing being removed, and a
// "credit" reads as a virtual currency, which carries its own store rules.
//
// Every figure on those screens already sits under a label saying what it is
// — TOTAL, EACH, per skin, per round, per pin — so the number needs no noun
// of its own. It is a number.
//
// ── The format ─────────────────────────────────────────────────────
// Grouped thousands, and decimals ONLY when the division produced them. A
// total is a buy-in times a head count and so is almost always whole; a
// share of it is not, and 400 across seven skins is 57.14. `money` hid cents
// the same way and for the same reason — "400.00" reads as a form field
// rather than as a figure.
//
// Rounding is display only. Nothing here touches what is stored or what the
// editors seed from, so a share that shows 57.14 is still the exact quotient
// everywhere it is added up.
export const tally = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const whole = Math.floor(abs);
  const rest = Math.round((abs - whole) * 100);
  // A value whose hundredths round to 100 has to carry into the whole, or
  // 9.999 renders as "9.100".
  const [w, c] = rest === 100 ? [whole + 1, 0] : [whole, rest];
  return `${sign}${w.toLocaleString("en-US")}${c ? `.${String(c).padStart(2, "0")}` : ""}`;
};
