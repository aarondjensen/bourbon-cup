// ══════════════════════════════════════════════════════════════════
//  MoneyHolePrompt — the heads-up on the tee of the money hole
// ══════════════════════════════════════════════════════════════════
//
//  Fires on the device that finishes the hole BEFORE the money hole — score
//  the 17th and this is what comes up, while the group is still walking to
//  the 18th tee. It asks nothing and records nothing: unlike the CTP prompt,
//  which is a form the group fills in because the card cannot record what a
//  tape measure said, everything about the money hole is already going to be
//  on the card. The only thing the app can add is TELLING THEM IN TIME.
//
//  Which is the whole point. A pot decided on one hole is worth nothing to a
//  man who finds out on the Betting tab that evening that he three-putted it
//  for a share of $80. The other three games run all day and need no
//  announcement; this one is over in fifteen minutes and is easy to walk onto
//  without noticing.
//
//  What it says, in the order it matters standing on a tee:
//
//    • which hole, and that the money is on it
//    • what it is worth THIS ROUND — the pot divides by the rounds, so the
//      figure on the tee is the round's share, not the tournament's pot
//    • WHO IN THIS GROUP is playing for it, and what shot each of them gets
//      there. A man in the game with a stroke on the hole is playing a
//      different hole from his partner, and that is the fact most likely to
//      change how somebody plays it.
//    • that a tie splits, because it is the rule that surprises people —
//      everyone reads a one-hole pot as a skin.
//
//  A player NOT in the money hole is still shown the popup: he is in the
//  group, he is about to watch it happen, and a phone that says nothing is
//  how the man keeping the card ends up the only one who didn't know. His
//  row simply says he is out.
//
//  One button, and no backdrop dismiss — the same reason CtpPrompt has none.
//  This is a thing to be read, and a stray tap on a phone in a cart pocket
//  should not be what closes it.

import { Popup } from "./Popup";
import { BC, ALPHA, ON_AMBER, FS, teamColor } from "../theme";

export function MoneyHolePrompt({ hole, par, share, rows, onClose }) {
  const inGame = rows.filter(r => r.in);

  return (
    <Popup
      onClose={onClose}
      maxWidth={360}
      padding={0}
      noBackdropClose
      portal
      innerStyle={{ background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}` }}
    >
      <div style={{
        background: BC.amber + ALPHA.wash, borderBottom: `1px solid ${BC.amber}${ALPHA.hair}`,
        padding: "14px 20px", textAlign: "center",
      }}>
        <div style={{ fontSize: FS.hero, marginBottom: 4 }}>💰</div>
        <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.amberInk, letterSpacing: 0.3 }}>
          Next up — the Money Hole
        </div>
        <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 2 }}>
          Hole {hole}{par ? ` · Par ${par}` : ""}
        </div>
      </div>

      <div style={{ padding: "14px 16px" }}>
        {/* What it is worth on this tee. The round's share, not the pot —
            see the note above. */}
        {share > 0 && (
          <div style={{
            background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 12,
            padding: "10px 12px", marginBottom: 12, textAlign: "center",
          }}>
            <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1.2 }}>ON THIS HOLE</div>
            <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold }}>${share.toFixed(2)}</div>
          </div>
        )}

        {/* Who is in, and what shot they get there. */}
        <div style={{ background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1.2, marginBottom: 8 }}>
            {inGame.length === rows.length ? "Everyone here is in" : `${inGame.length} of ${rows.length} here are in`}
          </div>
          {rows.map(r => (
            <div key={r.pid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: teamColor(r.team), flexShrink: 0, opacity: r.in ? 1 : 0.4 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: FS.small, fontWeight: 700, color: r.in ? BC.t1 : BC.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}
              </span>
              {r.in ? (
                <span style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 0.4, color: r.strokes ? BC.hcpBlue : BC.t3, flexShrink: 0 }}>
                  {r.strokes ? `${r.strokes} shot${r.strokes !== 1 ? "s" : ""} here` : "no shot"}
                </span>
              ) : (
                <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, flexShrink: 0 }}>out</span>
              )}
            </div>
          ))}
        </div>

        {/* The rule people get wrong — everyone reads a one-hole pot as a
            skin, and a skin would carry. */}
        <div style={{ fontSize: FS.label, color: BC.t3, textAlign: "center", lineHeight: 1.5, marginBottom: 12 }}>
          Lowest <strong style={{ color: BC.t2 }}>net</strong> score takes it. A tie <strong style={{ color: BC.t2 }}>splits</strong> the money —
          it does not carry.
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%", padding: 13, borderRadius: 10, border: "none",
            background: BC.amber, color: ON_AMBER,
            fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5, cursor: "pointer",
          }}
        >
          Let&rsquo;s go
        </button>
      </div>
    </Popup>
  );
}
