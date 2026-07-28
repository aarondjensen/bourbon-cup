// ══════════════════════════════════════════════════════════════════
//  Finalizing a round — the notification, and the sheet it opens.
// ══════════════════════════════════════════════════════════════════
//
// Finalizing is the single act that advances the tournament: it freezes
// round N's handicaps and results and opens round N+1 for entry on every
// device at once (see "The round gate" in App.jsx and lib/roundLocks.js).
// One person can do it — the director — and there is exactly one moment
// they need to.
//
// WHY THIS MOVED OFF THE SCORING SCREEN
// -------------------------------------
// It used to be a permanently-mounted card at the bottom of the Scoring
// tab: a DIRECTOR header, a progress bar, a list of who was still out and
// a full-width Finalize button, sitting under the four player cards for
// the entire round. The Scoring screen is fit to the device rather than
// scrolled (useFitDensity), so that card was not free — it came out of the
// space the score buttons had, on the one screen in the app that is worked
// from rather than read. A director who is also playing lost a slice of
// every hole they entered to a control they need once, at the end.
//
// Two pieces replace it, and neither of them is standing in front of a
// score button:
//
//   • DirectorFinalizeAlert — an app-level notification, above the tab
//     content and visible on every tab, that appears only when the round
//     is actually ready (every score in) and only for a director. This is
//     the mechanism that used to be missing: a director no longer has to
//     be standing on the Scoring tab, scrolled to the bottom, to learn
//     that the round is done. It is dismissible, and dismissal is
//     remembered per round, so postponing it is not a decision the app
//     asks about twice.
//   • FinalizeRoundSheet — the card's full contents, moved into a modal.
//     It costs nothing until it is opened, which is what lets the details
//     (per-player missing counts, the consequence line, the way back) be
//     as complete as they need to be rather than as short as the scoring
//     screen could afford.
//
// The sheet is reachable at any time from More › Finalize Round N, which
// is the early-finalize path — a withdrawal or a conceded match leaves
// holes that will never be filled, and the notification, which waits for a
// complete round, would never fire for it.
//
// FINALIZING WITH SCORES MISSING IS ALLOWED, behind a confirm that names
// who is out. A hard block reads as safer than it is: a gate with no way
// past it strands the whole field on a round nobody is playing. The
// director is trusted; they are just not allowed to do it by accident.
import { useState } from "react";
import { BC, FONT, ON_AMBER, ALPHA, FS } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import { useConfirm } from "../lib/useConfirm";
import { playerLookup } from "../lib/players";

// `progress` throughout this file is one roundScoreProgress() result
// (lib/scoreGuard) — entered / total / missing / missingBy / complete,
// counted over every player in every match of the round.

// ── The notification ────────────────────────────────────────────────
// A slim actionable bar in the app shell, under the header and above the
// tab content, so it reaches a director wherever they are standing. Two
// targets, deliberately separate: the bar itself opens the sheet, the ✕
// puts it away for this round.
//
// It is not a toast. A toast is 2.8 seconds long and finalizing is the one
// action that cannot be missed — a director walking off 18 with a phone in
// their pocket has to still find it there.
export function DirectorFinalizeAlert({ round, nextRound, progress, onOpen, onDismiss }) {
  return (
    <div style={{ flexShrink: 0, padding: "0 10px 6px", fontFamily: FONT }}>
      <style>{`@keyframes bcFinalizePulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.8); } }`}</style>
      <div style={{
        display: "flex", alignItems: "stretch",
        background: BC.amberGlow, border: `1px solid ${BC.amber}${ALPHA.line}`,
        borderRadius: 10, overflow: "hidden",
      }}>
        <button onClick={onOpen} style={{
          flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9,
          background: "transparent", border: "none", cursor: "pointer",
          padding: "7px 4px 7px 10px", textAlign: "left", fontFamily: FONT,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%", background: BC.amber, flexShrink: 0,
            animation: "bcFinalizePulse 1.8s ease-in-out infinite",
          }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              display: "block", fontSize: FS.small, fontWeight: 800, color: BC.amber,
              letterSpacing: 0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              Round {round} is ready to finalize
            </span>
            {/* One line, clipped rather than wrapped: the bar sits above
                every tab's content, so its height is a fixed cost and a
                second line is one the app pays on a narrow phone forever.
                The heading above already carries the actionable half. */}
            <span style={{
              display: "block", fontSize: FS.label, color: BC.t2, lineHeight: 1.35,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              All {progress.total} scores are in — {nextRound ? `opens Round ${nextRound}` : "closes the tournament"}
            </span>
          </span>
          <span style={{ color: BC.amber, fontSize: FS.lead, fontWeight: 700, flexShrink: 0, paddingRight: 4 }}>›</span>
        </button>
        {/* Sibling, not nested: a button inside a button is invalid markup
            and iOS resolves the tap to whichever it feels like. */}
        <button onClick={onDismiss} aria-label="Dismiss" style={{
          width: 40, flexShrink: 0, background: "transparent", border: "none",
          borderLeft: `1px solid ${BC.amber}${ALPHA.hair}`,
          color: BC.t3, fontSize: FS.small, fontWeight: 700, cursor: "pointer",
          fontFamily: FONT,
        }}>
          ✕
        </button>
      </div>
    </div>
  );
}

// ── The sheet ───────────────────────────────────────────────────────
// Everything the removed card held, with the room to say it properly.
//
// The complete-round path finalizes straight off this sheet's button, with
// no second confirm behind it. The sheet is not somewhere anybody lands by
// accident — it takes a deliberate tap on the notification or a trip
// through the More menu — and it states the consequence in full above the
// button. Stacking a confirm on top of a modal that already IS the confirm
// trains the reflex that defeats both. The two paths that are NOT routine
// keep theirs: finalizing over missing scores, and reopening a round the
// field has already moved off.
export function FinalizeRoundSheet({
  round, nextRound, lastFinal, progress, tPlayers, onFinalizeRound, notify, onClose,
}) {
  const { confirm, confirmModal } = useConfirm();
  const [busy, setBusy] = useState(false);
  const { nameOf } = playerLookup(tPlayers);

  const outList = progress.missingBy
    .slice(0, 6)
    .map(({ pid, missing }) => `• ${nameOf(pid)} — ${missing} hole${missing === 1 ? "" : "s"}`)
    .join("\n")
    + (progress.missingBy.length > 6 ? `\n• …and ${progress.missingBy.length - 6} more` : "");

  const doFinalize = async () => {
    if (!progress.complete) {
      const ok = await confirm({
        eyebrow: `Round ${round}`,
        title: `Finalize Round ${round} with scores missing?`,
        message: [
          `${progress.missing} score${progress.missing === 1 ? " is" : "s are"} still missing:\n${outList}`,
          "",
          `Finalizing freezes Round ${round}'s handicaps and results, and ${nextRound ? `opens Round ${nextRound} for scoring.` : "closes out the tournament."}`,
          "You can reopen it afterwards if you need to.",
        ].join("\n"),
        confirmLabel: "Finalize anyway",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await onFinalizeRound(round, true);
      if (res) {
        notify(nextRound
          ? `Round ${round} is final — Round ${nextRound} is now open`
          : `Round ${round} is final — that's the tournament`, "success");
        onClose();
      } else {
        notify("Could not finalize the round — try again", "error");
      }
    } catch {
      notify("Could not finalize the round — try again", "error");
    } finally { setBusy(false); }
  };

  const doReopen = async () => {
    const ok = await confirm({
      eyebrow: `Round ${lastFinal}`,
      title: `Reopen Round ${lastFinal}?`,
      message: [
        `Scoring moves back to Round ${lastFinal}${round != null && round !== lastFinal ? `, and Round ${round} closes until Round ${lastFinal} is finalized again.` : "."}`,
        "",
        "Handicaps stay frozen exactly as they are — reopening changes what can be typed, not a stroke already allocated.",
      ].join("\n"),
      confirmLabel: "Reopen",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await onFinalizeRound(lastFinal, false);
      notify(res ? `Round ${lastFinal} reopened for scoring` : "Could not reopen the round — try again", res ? "success" : "error");
      if (res) onClose();
    } catch {
      notify("Could not reopen the round — try again", "error");
    } finally { setBusy(false); }
  };

  const pct = progress.total ? Math.round((progress.entered / progress.total) * 100) : 0;

  return (
    <Popup onClose={busy ? undefined : onClose} maxWidth={380} padding={18} portal showClose={!busy}>
      <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5, color: BC.amber, marginBottom: 10 }}>
        DIRECTOR
      </div>

      {round != null ? (
        <>
          <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, marginBottom: 12 }}>
            {progress.complete ? `Round ${round} is ready` : `Finalize Round ${round}`}
          </div>

          {/* Progress — the number that decides whether Finalize is the
              routine end of a round or an override. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: FS.small, color: BC.t2, marginBottom: 4 }}>
            <span style={{ fontWeight: 700 }}>Scores in</span>
            <span style={{ color: progress.complete ? BC.green : BC.t3, fontWeight: 700 }}>
              {progress.entered} / {progress.total || 0}
            </span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: BC.inp, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: progress.complete ? BC.green : BC.amber }} />
          </div>

          {/* Who is still out, by name. The sheet has the room the card
              never did, so this is the full list rather than the first
              three and a count. */}
          {progress.total === 0 ? (
            <div style={{ fontSize: FS.small, color: BC.t3, lineHeight: 1.4, marginBottom: 12 }}>
              No matches drawn for this round yet.
            </div>
          ) : progress.complete ? (
            <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.45, marginBottom: 12 }}>
              Every score is in.
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: FS.label, fontWeight: 700, letterSpacing: 1, color: BC.t3, marginBottom: 5 }}>
                STILL OUT
              </div>
              <div style={{
                maxHeight: 132, overflowY: "auto", overscrollBehavior: "contain",
                background: BC.inp, borderRadius: 8, padding: "6px 10px",
              }}>
                {progress.missingBy.map(({ pid, missing }) => (
                  <div key={pid} style={{
                    display: "flex", justifyContent: "space-between", gap: 10,
                    fontSize: FS.small, color: BC.t2, padding: "3px 0",
                  }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(pid)}</span>
                    <span style={{ color: BC.warn, fontWeight: 700, flexShrink: 0 }}>
                      {missing} hole{missing === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The consequence, spelled out. This is what the removed confirm
              used to say, and why the routine path no longer needs one. */}
          <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.45, marginBottom: 12 }}>
            Finalizing freezes Round {round}&apos;s handicaps and results, and{" "}
            {nextRound ? `opens Round ${nextRound} for scoring.` : "closes out the tournament."}
            {" "}You can reopen it afterwards if you need to.
          </div>

          <button onClick={doFinalize} disabled={busy} style={{
            width: "100%", padding: "12px 0", borderRadius: 10, cursor: busy ? "default" : "pointer",
            border: progress.complete ? "none" : `1px solid ${BC.amber}${ALPHA.line}`,
            background: progress.complete ? BC.amber : "transparent",
            color: progress.complete ? ON_AMBER : BC.amber,
            fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5, opacity: busy ? 0.6 : 1,
            fontFamily: FONT,
          }}>
            {busy ? "Working…" : `Finalize Round ${round}`}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, marginBottom: 8 }}>
            The tournament is over
          </div>
          <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.45, marginBottom: lastFinal != null ? 8 : 0 }}>
            Every round is final. Scoring is closed for the tournament.
          </div>
        </>
      )}

      {/* The way back. Without it, one mistimed tap locks the whole field
          out of the round they are standing on. */}
      {lastFinal != null && (
        <button onClick={doReopen} disabled={busy} style={{
          width: "100%", padding: "10px 0", marginTop: 8, borderRadius: 8,
          background: "transparent", border: "none", color: BC.t3,
          fontSize: FS.small, fontWeight: 700, cursor: busy ? "default" : "pointer",
          textDecoration: "underline", textUnderlineOffset: 3, fontFamily: FONT,
        }}>
          Reopen Round {lastFinal}
        </button>
      )}

      <ConfirmModal modal={confirmModal} />
    </Popup>
  );
}
