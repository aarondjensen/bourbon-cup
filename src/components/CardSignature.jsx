// ══════════════════════════════════════════════════════════════════
//  Signing a card, and attesting one.
// ══════════════════════════════════════════════════════════════════
//
// The Scoring tab's end-of-round ritual, ported from the MnQ golf league
// app. lib/cardSigs holds the model and the reasoning; this file is what
// the four players in a match actually touch.
//
// There are three screens' worth of state here and exactly one of them is
// live at a time (lib/cardSigs `cardState`):
//
//   OPEN    — the card is a draft. Scores are editable by anyone in the
//             match. When all four players have all 18, the Full Scorecard
//             button promotes to the sign CTA. Until then, MissingCard says
//             who the card is waiting on.
//   SIGNED  — one player has signed. Scores are locked, the card is on
//             screen in full, and every OTHER player is being asked to
//             agree. Anybody in the match can still unsign it.
//   FINAL   — everyone has attested. FINAL is stamped across the card and
//             nothing here moves it again; only the director can, and only
//             through Admin.
//
// WHY THE SIGNED VIEW REPLACES THE SCORING SCREEN
// -----------------------------------------------
// The Scoring tab is fit to the device rather than scrolled (useFitDensity),
// so anything added to it comes out of the score buttons' height — that is
// why the Finalize card was moved off it (see components/FinalizeRound). A
// signed card has no score buttons to protect: the numbers are locked, so
// the whole screen is free, and the card gets it. This is also MnQ's
// arrangement, and the reason it is the same one is that the constraint is
// the same one.
import { useState } from "react";
import { BC, FONT, ON_AMBER, ON_ACCENT, ALPHA, FS } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import { useConfirm } from "../lib/useConfirm";
import { playerLookup } from "../lib/players";
import { FullScorecard } from "./FullScorecard";
import { nonSignerPids, isFullyAttested } from "../lib/cardSigs";

// Both panels below render the SAME card the Scoring tab's Full Scorecard
// popup does, from the same already-resolved props — hole tables, course,
// score reader — rather than re-deriving any of it. That is the point: a
// player is being asked to swear to what is on their screen, so the card
// they sign has to be the card they were looking at, down to the stroke
// dots. See components/FullScorecard for why its props are shaped this way.

// ── The can't-sign-yet note ─────────────────────────────────────────
// Without this the sign CTA simply never appears, and the group standing
// on 18 wondering why has no way to find out. Names the players and the
// holes, so the fix is a tap away rather than an audit.
//
// Long lists are clipped rather than wrapped: a card missing forty holes is
// a card nobody is about to sign, and the count carries that better than
// forty numbers would.
export function MissingCardNote({ missing, nameOf }) {
  if (!missing?.length) return null;
  return (
    <div style={{
      width: "100%", padding: "8px 10px", borderRadius: 8, marginBottom: 6,
      background: `${BC.warn}${ALPHA.wash}`, border: `1px solid ${BC.warn}${ALPHA.line}`,
      color: BC.warn, fontFamily: FONT, boxSizing: "border-box", flexShrink: 0,
    }}>
      <div style={{ fontSize: FS.small, fontWeight: 800, marginBottom: 3 }}>
        Missing scores — can&apos;t sign yet
      </div>
      {missing.slice(0, 4).map(({ pid, holes }) => (
        <div key={pid} style={{
          fontSize: FS.label, fontWeight: 700, opacity: 0.9, lineHeight: 1.45,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {nameOf(pid)} — {holes.length > 6
            ? `${holes.length} holes`
            : `hole${holes.length > 1 ? "s" : ""} ${holes.join(", ")}`}
        </div>
      ))}
      {missing.length > 4 && (
        <div style={{ fontSize: FS.label, fontWeight: 700, opacity: 0.9 }}>
          …and {missing.length - 4} more
        </div>
      )}
    </div>
  );
}

// ── The sign sheet ──────────────────────────────────────────────────
// A confirmation that shows what is being confirmed. The whole card is on
// screen above the button, because "sign this card" is a claim about
// eighteen numbers and asking someone to make it against a summary line is
// asking them to guess.
//
// One tap signs — no second confirm behind it. The sheet IS the confirm, it
// takes a deliberate tap to open, and unsigning is one tap away for anybody
// in the match right up until the last attestation lands. Stacking a
// confirm on a modal that already is one trains the reflex that defeats
// both. (Same call, same reasoning, as FinalizeRoundSheet's.)
export function SignCardSheet({
  match, result, format, holePars, holeHcps, course, teams, tPlayers, getScore,
  viewer, userPid, onSign, onClose,
}) {
  const [busy, setBusy] = useState(false);
  const { nameOf } = playerLookup(tPlayers);
  const others = nonSignerPids(match, { signed_by: userPid });

  const doSign = async () => {
    setBusy(true);
    try { await onSign(); } finally { setBusy(false); }
  };

  return (
    <Popup onClose={busy ? undefined : onClose} maxWidth={480} padding={0} outerPadding={12} portal
      showClose={false}
      innerStyle={{ background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 12 }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BC.bdr}`, fontFamily: FONT }}>
        <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.amber, letterSpacing: 1.5 }}>
          SIGN THE CARD
        </div>
        <div style={{ fontSize: FS.small, color: BC.t2, marginTop: 2 }}>
          Round {match.round}{match.matchNumber ? ` · Match ${match.matchNumber}` : ""}
        </div>
      </div>

      <div style={{ padding: 12 }}>
        <FullScorecard
          match={match} result={result} format={format}
          holePars={holePars} holeHcps={holeHcps} course={course}
          teams={teams} tPlayers={tPlayers} getScore={getScore} viewer={viewer} />
      </div>

      {/* What signing means, in the words the ritual actually has. The
          second line is the one that matters: signing is not the end of the
          card, it is the start of everyone else checking it. */}
      <div style={{ padding: "0 14px", fontSize: FS.label, color: BC.t3, lineHeight: 1.5, fontFamily: FONT }}>
        Signing says these eighteen holes are complete and correct. It locks
        the scores{others.length > 0
          ? ` and asks ${others.map(nameOf).join(", ")} to attest.`
          : "."}
        {" "}Anyone in the match can unsign it until the last attestation lands.
      </div>

      <div style={{ padding: 14, fontFamily: FONT }}>
        <button onClick={doSign} disabled={busy} style={{
          width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
          background: BC.amber, color: ON_AMBER,
          fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5,
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: FONT,
        }}>
          {busy ? "Signing…" : "Sign Card"}
        </button>
        <button onClick={onClose} disabled={busy} style={{
          width: "100%", padding: "9px 0", marginTop: 4, background: "none", border: "none",
          color: BC.t3, fontSize: FS.small, fontWeight: 700,
          cursor: busy ? "default" : "pointer", fontFamily: FONT,
        }}>
          Go back &amp; edit
        </button>
      </div>
    </Popup>
  );
}

// ── The signed card ─────────────────────────────────────────────────
// What the Scoring tab becomes once a card is signed: the card itself, a
// row of attester chips, and whichever single action belongs to the person
// holding the phone. Nobody sees more than one primary action here —
// the signer sees none, an attester sees Attest, and once they have
// attested they see the wait.
export function SignedCardPanel({
  match, sig, result, format, holePars, holeHcps, course, teams, tPlayers, getScore,
  viewer, userPid, onAttest, onUnsign, notify,
}) {
  const { confirm, confirmModal } = useConfirm();
  const [busy, setBusy] = useState(false);
  const { nameOf, shortOf } = playerLookup(tPlayers);

  const attestedBy = sig.attested_by || [];
  const pending = nonSignerPids(match, sig);
  const final = isFullyAttested(match, sig);
  const inMatch = [...(match.teamA || []), ...(match.teamB || [])].includes(userPid);
  const iSigned = sig.signed_by === userPid;
  const iAttested = attestedBy.includes(userPid);
  const canAttest = inMatch && !iSigned && !iAttested && !final;

  const doAttest = async () => {
    setBusy(true);
    try {
      await onAttest();
      // Whether this was the last one is worth saying: it is the difference
      // between "done, walk away" and "done, but the card is still open".
      const done = pending.every(pid => pid === userPid || attestedBy.includes(pid));
      notify(done ? "Card fully attested — that's final" : "Attestation recorded", "success");
    } catch {
      notify("Could not record that — try again", "error");
    } finally { setBusy(false); }
  };

  const doUnsign = async () => {
    const ok = await confirm({
      eyebrow: `Round ${match.round}`,
      title: "Unsign this card?",
      message: [
        `${nameOf(sig.signed_by)}'s signature is removed and every attestation on it is cleared.`,
        "",
        "The scores go back to being editable by anyone in the match. Nothing already posted is deleted — the card just stops being final.",
      ].join("\n"),
      confirmLabel: "Unsign",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await onUnsign();
      notify("Card unsigned — scores are editable again", "success");
    } catch {
      notify("Could not unsign the card — try again", "error");
    } finally { setBusy(false); }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}>
      {/* The card, with FINAL stamped across it once everyone has agreed.
          Over the scorecard rather than under it, but at ALPHA.tint and
          pointer-events:none — so it reads as ink bled through the paper
          rather than a sheet laid on top, and every number stays legible
          and every scroll still goes to the card underneath. */}
      <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
        {final && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none", zIndex: 2, overflow: "hidden",
          }}>
            <div style={{
              fontSize: "clamp(56px, 20vw, 110px)", fontWeight: 800,
              color: `${BC.t3}${ALPHA.tint}`, letterSpacing: "clamp(10px, 4vw, 22px)",
              textTransform: "uppercase", userSelect: "none", whiteSpace: "nowrap",
              transform: "rotate(-18deg)",
            }}>FINAL</div>
          </div>
        )}
        <FullScorecard
          match={match} result={result} format={format}
          holePars={holePars} holeHcps={holeHcps} course={course}
          teams={teams} tPlayers={tPlayers} getScore={getScore} viewer={viewer} />
      </div>

      {/* ── The status block ── */}
      <div style={{ flexShrink: 0, paddingTop: 8 }}>
        <div style={{
          display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6,
          fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 0.5,
        }}>
          <span style={{ color: BC.amber, letterSpacing: 1.5, fontWeight: 800 }}>
            {final ? "FINAL" : "SIGNED"}
          </span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            by {nameOf(sig.signed_by)}
          </span>
          {pending.length > 0 && (
            <span style={{ marginLeft: "auto", flexShrink: 0, color: final ? BC.green : BC.warn, fontWeight: 800 }}>
              {attestedBy.length} of {pending.length} attested
            </span>
          )}
        </div>

        {/* One chip per player the card is waiting on, filled as each
            attests. The same two-state chip MnQ uses — it answers "whose
            tap are we short?" without anyone having to ask out loud. */}
        {pending.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {pending.map(pid => {
              const done = attestedBy.includes(pid);
              return (
                <div key={pid} style={{
                  fontSize: FS.label, fontWeight: 700, padding: "3px 8px", borderRadius: 5,
                  background: done ? `${BC.green}${ALPHA.wash}` : BC.inp,
                  border: `1px solid ${done ? `${BC.green}${ALPHA.line}` : BC.bdr}`,
                  color: done ? BC.green : BC.t3,
                }}>
                  {done ? "✓ " : ""}{shortOf(pid)}
                </div>
              );
            })}
          </div>
        )}

        {canAttest && (
          <button onClick={doAttest} disabled={busy} style={{
            width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
            background: BC.hcpBlue, color: ON_ACCENT,
            fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5,
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: FONT,
          }}>
            {busy ? "Working…" : "Attest Card"}
          </button>
        )}

        {iAttested && !final && (
          <div style={{ textAlign: "center", fontSize: FS.small, color: BC.t3, fontWeight: 700, padding: "8px 0" }}>
            You attested — waiting on the others
          </div>
        )}

        {iSigned && !final && (
          <div style={{ textAlign: "center", fontSize: FS.small, color: BC.t3, fontWeight: 700, padding: "8px 0" }}>
            You signed this card — waiting on {pending.filter(p => !attestedBy.includes(p)).map(shortOf).join(", ")}
          </div>
        )}

        {/* The way back, and it stays open to ANY of the four rather than to
            the signer alone: the whole point of a second signature is that
            the person who typed the scores is not the only one who gets to
            say whether they are right. Gone once the card is final —
            unpicking that is a director's job, through Admin. */}
        {inMatch && !final && (
          <button onClick={doUnsign} disabled={busy} style={{
            width: "100%", padding: "9px 0", marginTop: 6, borderRadius: 8,
            background: "transparent", border: "none", color: BC.t3,
            fontSize: FS.small, fontWeight: 700, cursor: busy ? "default" : "pointer",
            textDecoration: "underline", textUnderlineOffset: 3, fontFamily: FONT,
          }}>
            Unsign &amp; edit
          </button>
        )}
      </div>

      <ConfirmModal modal={confirmModal} />
    </div>
  );
}
