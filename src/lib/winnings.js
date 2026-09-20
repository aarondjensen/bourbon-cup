// ══════════════════════════════════════════════════════════════════
//  winnings — what each man is owed out of the side games
// ══════════════════════════════════════════════════════════════════
//
// The Betting tab answers "who is winning this one" a game at a time: a skins
// board, a CTP board, a low net board, a money hole board. Nobody pays out a
// game at a time. On Sunday the director hands one man one amount, and until
// now working out what that amount was meant reading four tabs and adding
// them up on a phone — which is the arithmetic this file does instead.
//
// Nothing here scores anything. Every number comes out of lib/betting's books
// (`skinWins`, `ctpWins`, `lowNetWins`, `moneyHoleWins`), which is what keeps
// the payout on this screen and the payout on the Betting tab the same payout.
// A second implementation of "what is a skin worth" is how a board and a
// settlement come to name different numbers for the same pot.
//
// ── The three games it CANNOT add up ──────────────────────────────
// SIDE BETS are not here and never will be. They are wagers between two
// players on terms the app cannot read and does not settle — see lib/sideBets.
// A total that quietly folded in an exposure figure would be reporting money
// nobody has won.
//
// The other two are the LEDGER and the BUDGET, which share the Admin tab this
// board sits on and have nothing to do with it: that is money owed to the
// director who fronted the trip, and this is money the field owes each other.
// Netting one against the other is somebody's idea every year and it is always
// wrong — a man can be square on the trip and up $140 on skins.
//
// ── Gross or net ──────────────────────────────────────────────────
// Skins are the one game here with two readings, and the app stores no answer
// to which one the field is playing — the Betting tab's Gross/Net toggle is
// screen state, not a setting. Net is the default there and is the game as
// this cup plays it, so it is the default here; the caller passes `gross` to
// read the other. The board labels which it is showing, because a payout table
// that does not say is a payout table that can be read as the wrong one.
import {
  inField, potFor, skinWins, ctpWins, lowNetWins, moneyHoleWins,
  moneyHole, moneyHoleRoundsIn, strokeMapsFor,
} from "./betting";
import { money, round2 } from "./ledger";

// Every pot, every winner and every share, in one pass. The four games come
// back in the order the Betting tab lists them, and the money hole is labelled
// with its HOLE the way that tab names it — a director who moves the game to
// the ninth gets a row reading Hole 9.
//
// `rounds` is the draw; `roster` is the field with the borrowed ball already
// out of it (the caller passes realPlayers). The remaining keys are the same
// scoring context every other surface carries — tPlayers, tRounds, courses,
// roundLocks, hcpOverrides, teeAssignments — which is what lets a locked round
// be read through its lock rather than through a course somebody re-pointed in
// October.
export const winningsBooks = ({
  roster, rounds, holeData, ctpData, buyIns, skinsPot, gross = false, ...ctx
}) => {
  const list = rounds || [];
  const field = (key) => inField(roster || [], buyIns?.[key] ?? null);

  const skinsField = field("skinsIn");
  const ctpField = field("ctpIn");
  const lowNetField = field("lowNetIn");
  const moneyHoleField = field("moneyHoleIn");

  // Skins is the only game with a typed fallback: it had a hand-entered pot
  // before buy-ins existed and a tournament already under way still has one.
  const skinsPotValue = potFor(skinsField, buyIns?.skinsAmount, skinsPot);
  const ctpPotValue = potFor(ctpField, buyIns?.ctpAmount);
  const lowNetPotValue = potFor(lowNetField, buyIns?.lowNetAmount);
  const moneyHolePotValue = potFor(moneyHoleField, buyIns?.moneyHoleAmount);

  const holeNum = moneyHole(buyIns?.moneyHoleNumber);
  // The rounds the money hole is PLAYED in — never a shared-ball round, and
  // never one the director switched off. Everything about that pot divides by
  // what is left rather than by the whole draw. See lib/betting.
  const moneyHoleRoundList = moneyHoleRoundsIn(list, buyIns?.moneyHoleRounds, ctx);

  const games = [
    {
      key: "skins",
      label: "Skins",
      pot: skinsPotValue,
      in: skinsField.length,
      buyIn: Number(buyIns?.skinsAmount) || 0,
      wins: skinWins({ rounds: list, gross, field: skinsField, holeData, pot: skinsPotValue, ...ctx }),
    },
    {
      key: "ctp",
      label: "CTP",
      pot: ctpPotValue,
      in: ctpField.length,
      buyIn: Number(buyIns?.ctpAmount) || 0,
      wins: ctpWins({ rounds: list, field: ctpField, ctpData: ctpData || {}, pot: ctpPotValue, ...ctx }),
    },
    {
      key: "lownet",
      label: "Low Net",
      pot: lowNetPotValue,
      in: lowNetField.length,
      buyIn: Number(buyIns?.lowNetAmount) || 0,
      wins: lowNetWins({ rounds: list, field: lowNetField, holeData, pot: lowNetPotValue, ...ctx }),
    },
    {
      key: "moneyhole",
      label: `Hole ${holeNum}`,
      pot: moneyHolePotValue,
      in: moneyHoleField.length,
      buyIn: Number(buyIns?.moneyHoleAmount) || 0,
      wins: moneyHoleWins({
        rounds: moneyHoleRoundList, hole: holeNum, field: moneyHoleField, holeData,
        mapsFor: (r) => strokeMapsFor({ round: r, field: moneyHoleField, ...ctx }),
        pot: moneyHolePotValue,
      }),
    },
  ].map(g => ({
    ...g,
    // What the pot has actually paid out so far. It is NOT the pot: a week
    // with pins nobody took, rounds nobody finished or a game nobody has
    // played leaves money undecided, and a board that printed the pot as
    // though it were all spoken for would have the director handing out money
    // the field has not won yet.
    paid: g.wins.reduce((n, w) => n + (w.share || 0), 0),
  }));

  // One row per man who has won something. A roster of sixteen $0 rows is a
  // screen somebody scrolls past to find the four names on it; who won nothing
  // is answered by not being on the list.
  // A win worth NOTHING is not a row. Every game produces winners whether or
  // not it has a pot — a low net is a low net on a tournament that never
  // priced one — and folding those in would list a man under "Winnings" for
  // $0, which is the board saying he is owed something he is not.
  const byPid = new Map();
  games.forEach(g => g.wins.forEach(w => {
    if (!w.pid || !(w.share > 0)) return;
    const row = byPid.get(w.pid) || { pid: w.pid, games: {}, total: 0 };
    const cell = row.games[g.key] || (row.games[g.key] = { money: 0, count: 0 });
    cell.money += w.share || 0;
    cell.count += 1;
    row.total += w.share || 0;
    byPid.set(w.pid, row);
  }));

  const named = (pid) => (roster || []).find(p => p.player_id === pid);
  const rows = [...byPid.values()]
    .map(r => {
      const p = named(r.pid);
      return { ...r, name: p?.name || r.pid, team: p?.team || null };
    })
    // Most money first — the order a director pays people out in. A man who
    // won a pin and nothing else sorts by his money, not by his count.
    .sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name)));

  return {
    games,
    rows,
    gross,
    pot: games.reduce((n, g) => n + g.pot, 0),
    paid: games.reduce((n, g) => n + g.paid, 0),
  };
};

// Is there a board to draw at all? A tournament whose director has never set a
// buy-in has four empty pots, and four $0 rows say less than one empty state.
export const hasPots = (books) => (books?.games || []).some(g => g.pot > 0);

// ══════════════════════════════════════════════════════════════════
//  The same board, as something you can send
// ══════════════════════════════════════════════════════════════════
//
// Where the money ends up is group-text news, and the screen it is on is a
// director-only tab inside an Admin nobody else can open. So it has to be able
// to leave — and what leaves is PROSE, not the table.
//
// A phone message has no columns. Anything laid out with spaces arrives with
// its alignment collapsed by whatever app is rendering it, which is why this
// is one sentence a man rather than the grid on screen. The breakdown loses
// its money and keeps its COUNT for the same reason: "4 skins, 3 low net" is
// what somebody says out loud, and the total beside his name is the news.
const UNIT = {
  skins: (n) => `${n} skin${n === 1 ? "" : "s"}`,
  ctp: (n) => `${n} CTP${n === 1 ? "" : "s"}`,
  // No plural — "3 low nets" is not a thing anybody says.
  lownet: (n) => `${n} low net`,
  // THE GAME, not the tab. The tab is named after its hole because a tab has
  // room for two characters; in a sentence the field calls it the money hole,
  // and it stays true when a director moves it to the ninth.
  moneyhole: (n) => `${n} money hole${n === 1 ? "" : "s"}`,
};

export const winningsText = (books, { title } = {}) => {
  const rows = books?.rows || [];
  const games = books?.games || [];
  const head = title ? `${title} — winnings` : "Winnings";
  if (!rows.length) return `${head}\n\nNothing won yet.`;

  const body = rows.map(r => {
    const how = games
      .filter(g => r.games[g.key])
      .map(g => (UNIT[g.key] || (n => `${n} × ${g.label}`))(r.games[g.key].count))
      .join(", ");
    return `${r.name} — ${money(r.total)}${how ? ` (${how})` : ""}`;
  });

  // What is still in the hat, which is the one thing the list cannot show: a
  // week with pins nobody hit has money nobody has won, and the men reading
  // this are the ones who can still go and take it. Dropped once the pots are
  // all spoken for, where "$360 of $360" is a sentence about nothing.
  const foot = [
    // Compared at the CENT, the way both halves of it print. A pot divided
    // three ways and added back up is $39.99999999999999, and an untouched
    // float here would print "$40 of $40 paid out" over a week where nothing
    // is left — a sentence that sends somebody looking for money that is not
    // there.
    round2(books.paid) < round2(books.pot)
      ? `${money(books.paid)} of ${money(books.pot)} paid out`
      : `${money(books.paid)} paid out`,
    // Only where there is a skins pot to qualify. Gross and net name different
    // winners, and a list that does not say which it is can be read as the
    // other one.
    games.some(g => g.key === "skins" && g.pot > 0)
      ? `skins ${books.gross ? "gross" : "net"}`
      : null,
  ].filter(Boolean).join(" · ");

  return [head, "", ...body, "", foot].join("\n");
};
