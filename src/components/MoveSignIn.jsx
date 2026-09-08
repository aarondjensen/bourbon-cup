// ══════════════════════════════════════════════════════════════════
//  MoveSignIn — handing your name to a new sign-in.
// ══════════════════════════════════════════════════════════════════
//
// A man signs in with Google one summer and taps Apple the next — new phone,
// muscle memory, whichever button is on top. That is a different uid, and his
// name on the roster is already claimed by the old one.
//
// This is the OFFER half, on the account that still holds the name: it asks
// the server for a code and puts it on screen. The claim half is on the claim
// screen, where somebody who has just signed in on the new account types it.
// See lib/authPairing for what a code is and, more importantly, what it is
// not — it moves a roster link between two accounts that are BOTH already in
// the tournament, and is not a second door into the cup.
//
// Deliberately not a popup. The two devices are in the same pair of hands and
// the code has to stay readable while the other one is being typed on; a
// modal that has to be dismissed to look at anything else is the wrong shape
// for a number you are copying.
import { useEffect, useState } from "react";
import { BC, ALPHA, FS, FONT } from "../theme";
import { offerPairing, formatCode, expiryLabel } from "../lib/authPairing";

export function MoveSignIn({ notify }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState(null);   // { code, expiresAt, name }
  const [now, setNow] = useState(() => Date.now());

  // The countdown only runs while a code is on screen, and it is derived from
  // the expiry rather than latched by a timeout — the same shape useSyncStatus
  // uses, and for the same reason: a latch would set state inside its own
  // effect.
  useEffect(() => {
    if (!offer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [offer]);

  const dead = offer && offer.expiresAt <= now;

  const ask = async () => {
    setBusy(true);
    const res = await offerPairing();
    setBusy(false);
    if (!res.ok) { notify?.(res.error, "error"); return; }
    setNow(Date.now());
    setOffer(res);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(offer.code);
      notify?.("Code copied", "success");
    } catch {
      // Clipboard is refused outside a secure context and in some in-app
      // browsers. The code is on screen either way, which is the point.
      notify?.("Couldn't copy — read it off the screen", "error");
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%", padding: "12px 0", borderRadius: 10,
          background: BC.inp, border: `1px solid ${BC.bdr}`,
          color: BC.t1, fontSize: FS.body, fontWeight: 800,
          cursor: "pointer", fontFamily: FONT,
        }}
      >
        Move to a New Sign-In
      </button>
    );
  }

  return (
    <div style={{
      border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 10,
      background: BC.amber + ALPHA.wash, padding: "12px 14px", fontFamily: FONT,
    }}>
      <div style={{ fontSize: FS.label, color: BC.t2, lineHeight: 1.5, marginBottom: 10 }}>
        Signing in with a different Google or Apple account next time? Get a
        code here, then on the new one <strong style={{ color: BC.t1 }}>sign in,
        enter the tournament invite code</strong>, and type this on the claim
        screen. Your name, scores and cards come with you.
      </div>

      {!offer ? (
        <button
          onClick={ask}
          disabled={busy}
          style={{
            width: "100%", padding: "11px 0", borderRadius: 9,
            background: BC.amber, border: "none", color: BC.card,
            fontSize: FS.body, fontWeight: 800, fontFamily: FONT,
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Getting a code…" : "Get a Move Code"}
        </button>
      ) : (
        <>
          <button
            onClick={copy}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 9, marginBottom: 6,
              background: BC.card, border: `1px solid ${dead ? BC.bdr : BC.amber}`,
              color: dead ? BC.t3 : BC.amberInk, fontFamily: FONT,
              fontSize: FS.title, fontWeight: 800, letterSpacing: 3,
              cursor: "pointer", textDecoration: dead ? "line-through" : "none",
            }}
          >
            {formatCode(offer.code)}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, fontSize: FS.label, color: dead ? BC.danger : BC.t3 }}>
              {expiryLabel(offer.expiresAt, now)}
            </span>
            <button
              onClick={ask}
              disabled={busy}
              style={{
                flexShrink: 0, fontSize: FS.label, fontWeight: 700, padding: "5px 10px",
                borderRadius: 7, background: "transparent",
                border: `1px solid ${BC.bdr}`, color: BC.t2,
                cursor: busy ? "default" : "pointer", fontFamily: FONT,
              }}
            >
              New code
            </button>
          </div>
        </>
      )}
    </div>
  );
}
