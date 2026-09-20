// ══════════════════════════════════════════════════════════════════
//  WINNINGS — Admin → Budget → Winnings
// ══════════════════════════════════════════════════════════════════
//
// What the director hands each man at the end of the week. The Betting tab
// shows four games on four tabs and every one of them is somebody's board;
// this is the one screen that adds them up per player, which is the only form
// the money is ever actually paid out in.
//
// It writes nothing. Every number is derived in lib/winnings off lib/betting's
// books, so a figure here and the same figure on the Betting tab cannot
// disagree — there is no stored payout anywhere in this app, on purpose.
//
// It sits beside Budget and Accounting because this is the money tab, and
// nowhere else in Admin is. It is not part of either of them: those two are
// money owed to the DIRECTOR for fronting the trip, this is money the field
// owes each other, and the two are never netted.
import { useMemo, useState } from "react";
import { BC, FONT, ALPHA, FS } from "../theme";
import { SegmentedToggle } from "./ui";
import { winningsBooks, hasPots, winningsText } from "../lib/winnings";
import { money } from "../lib/ledger";
import { sendText, SAVED } from "../lib/fileSave";

const Card = ({ children, style }) => (
  <div style={{
    background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 12,
    overflow: "hidden", marginBottom: 12, ...style,
  }}>{children}</div>
);

const Head = ({ children, right }) => (
  <div style={{
    display: "flex", alignItems: "baseline", gap: 8,
    padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}`,
    fontSize: FS.label, fontWeight: 700, color: BC.gold, letterSpacing: 1,
  }}>
    <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    {right && <span style={{ color: BC.t3, letterSpacing: 0.6 }}>{right}</span>}
  </div>
);

const Empty = ({ title, sub }) => (
  <Card>
    <div style={{ padding: "48px 20px", textAlign: "center" }}>
      <div style={{ fontSize: FS.jumbo, marginBottom: 12, opacity: 0.4 }}>💰</div>
      <div style={{ fontSize: FS.lead, fontWeight: 700, color: BC.t1, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: FS.small, color: BC.t3, lineHeight: 1.5 }}>{sub}</div>
    </div>
  </Card>
);

export function WinningsAdmin({
  tPlayers, tRounds, rounds, courses, holeData, ctpData, buyIns, skinsPot,
  roundLocks, hcpOverrides, teeAssignments, teams, tournamentName, notify,
}) {
  // Skins is the only game with two readings and the app stores no answer to
  // which one the field is playing — see lib/winnings. Net is the game as this
  // cup plays it, so it is where the board opens; Gross stays the left-hand
  // option to match the Betting tab, where a reader's thumb already knows
  // which side is which.
  const [gross, setGross] = useState(false);

  const books = useMemo(() => winningsBooks({
    roster: tPlayers || [], rounds: rounds || [], holeData: holeData || {},
    ctpData: ctpData || {}, buyIns, skinsPot, gross,
    tPlayers, tRounds, courses, roundLocks, hcpOverrides, teeAssignments,
  }), [tPlayers, tRounds, rounds, courses, holeData, ctpData, buyIns, skinsPot, roundLocks, hcpOverrides, teeAssignments, gross]);

  // ── Getting it off the screen ──
  // Where the money ended up is group-text news, and this tab is inside an
  // Admin nobody but a director can open — so what the board says has to be
  // able to leave, as prose rather than as a table (see winningsText).
  //
  // The routes and their order are lib/fileSave's; what belongs here is what
  // to SAY about each one. "Copied" is not true of all three, and a man told
  // the winnings are on his clipboard when they are not finds out in front of
  // the group. A share sheet is its own confirmation and a dismissed one is
  // not a failure, so both stay silent.
  const send = async () => {
    const status = await sendText(winningsText(books, { title: tournamentName }));
    if (status === SAVED.copied) notify?.("Copied — paste it into the group text", "success");
    if (status === SAVED.failed) notify?.("Couldn't copy the winnings", "error");
  };

  if (!hasPots(books)) {
    return <Empty title="No pots yet" sub="Side-game buy-ins are set on the Betting tab." />;
  }

  const played = books.games.filter(g => g.pot > 0);

  return (
    <div style={{ fontFamily: FONT }}>
      <SegmentedToggle
        options={[[true, "Gross"], [false, "Net"]]}
        value={gross}
        onChange={setGross}
        style={{ marginBottom: 12, width: 160, marginLeft: "auto", marginRight: "auto" }}
      />

      {/* THE POTS, and how much of each has been won. The gap between the two
          columns is the whole reason this card is here rather than a single
          total: a pot is not spoken for until somebody has taken it, and pins
          nobody hit or rounds nobody finished leave money that is still in the
          hat on Sunday morning. */}
      <Card>
        <Head right="POT · WON">POTS</Head>
        {played.map(g => (
          <div key={g.key} style={{
            display: "flex", alignItems: "baseline", gap: 8,
            padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`,
          }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: FS.body, fontWeight: 600, color: BC.t1 }}>
              {g.label}
              {g.key === "skins" && (
                <span style={{ color: BC.t3, fontWeight: 500 }}> · {gross ? "gross" : "net"}</span>
              )}
            </span>
            <span style={{ fontSize: FS.small, color: BC.t3 }}>{g.in} in</span>
            <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.gold, minWidth: 58, textAlign: "right" }}>
              {money(g.pot)}
            </span>
            <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk, minWidth: 58, textAlign: "right" }}>
              {money(g.paid)}
            </span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "10px 14px" }}>
          <span style={{ flex: 1, fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1 }}>TOTAL</span>
          <span style={{ fontSize: FS.body, fontWeight: 800, color: BC.gold, minWidth: 58, textAlign: "right" }}>
            {money(books.pot)}
          </span>
          <span style={{ fontSize: FS.body, fontWeight: 800, color: BC.amberInk, minWidth: 58, textAlign: "right" }}>
            {money(books.paid)}
          </span>
        </div>
      </Card>

      {books.rows.length === 0 ? (
        <Empty title="Nothing won yet" sub="Winnings appear as the cards come in." />
      ) : (
        <Card>
          <Head right={
            <button
              type="button"
              onClick={send}
              style={{
                background: "transparent", border: "none", padding: 0,
                fontFamily: FONT, fontSize: FS.label, fontWeight: 700,
                letterSpacing: 0.6, color: BC.amberInk, cursor: "pointer",
              }}
            >COPY</button>
          }>WINNINGS</Head>
          {books.rows.map(r => (
            <div key={r.pid} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "9px 14px", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: teams?.[r.team]?.accent || BC.t3,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: FS.body, fontWeight: 600, color: BC.t1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{r.name}</div>
                {/* WHERE the money came from, named game by game. A total on
                    its own is the one thing a man will query, and the answer
                    is always "three skins and a pin".
                    The separator sits BETWEEN the games and not inside one:
                    four games on one line with a middot in each read as eight
                    things, and the count ran into the next game's name. */}
                <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 2, lineHeight: 1.5 }}>
                  {books.games
                    .filter(g => r.games[g.key])
                    .map(g => `${g.label} ${r.games[g.key].count} ${money(r.games[g.key].money)}`)
                    .join("  ·  ")}
                </div>
              </div>
              <span style={{ fontSize: FS.lead, fontWeight: 800, color: BC.gold, flexShrink: 0 }}>
                {money(r.total)}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
