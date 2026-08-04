// ══════════════════════════════════════════════════════════════════
//  CtpPrompt — the closest-to-the-pin tag popup.
// ══════════════════════════════════════════════════════════════════
//
//  Mirrors WBC's on-course CTP prompt (its OnCourseScoring block), which
//  is itself the MNQ prompt grown up. The workflow:
//
//    Every group that finishes a par 3 gets this popup on the device
//    that entered the last score. It shows the tag that is currently
//    standing so the group can see the number to beat, and asks TWO
//    questions in order — who, then how close — with the second one
//    hidden until the first is answered. A group whose answer is "none
//    of us" never sees the wheel at all.
//
//  Three things this asks that the earlier version didn't:
//
//  • A DISTANCE IS REQUIRED to tag. A name with no number is a claim
//    nobody measured, and it would go onto the card looking like one
//    somebody did. Undecided is not a distance: the wheel parks on the
//    standing tag so "beat it" is a short scroll rather than a hunt
//    from a cold 10 ft, and parking is not answering — only a real
//    gesture (thumb, stylus, trackpad) counts as choosing.
//
//  • BEATING THE STANDING TAG MEANS STRICTLY SHORTER. Level isn't
//    closer, so a tie keeps the earlier group's tag — first to hole it
//    holds the pin. The Tag button stays dead until the number clears
//    it, and says why rather than sitting mysteriously grey.
//
//  • PASSING IS AN ANSWER, not a dismissal. A group that walks off
//    without getting inside is saying the standing tag is right, and
//    recording that is the only thing that tells "nobody has been
//    asked" apart from "everybody has been asked and it stands".
//
//  The pass button says two different things depending on whether the
//  hole has been tagged yet, because on an untagged hole there is no
//  "closer" to be: until the first tag lands, every group through is
//  answering "did anyone in our group hit the green at all?". Once a
//  tag stands the question narrows to whether they beat it, and the
//  button becomes the confirmation above.
//
//  Player-entered tags are provisional (`approved: false` on the
//  record); the director's Betting → CTP grid is the approval step, and
//  an approved hole stops prompting. Nothing here decides who wins —
//  the group with the tape measure does, and this is the form they fill
//  in. No backdrop dismiss, for the same reason: we want a real answer.
// ══════════════════════════════════════════════════════════════════

import { useRef, useState } from "react";
import { Popup } from "./Popup";
import { BC, ALPHA, ON_AMBER, FS } from "../theme";

// Wheel geometry. WHEEL_H must leave a whole number of item slots above
// and below the selection band, hence the (WHEEL_H - WHEEL_ITEM) / 2
// padding on the scroller. A ball outside 60 ft on a par 3 is not
// winning a closest-to-pin, so the wheel caps there rather than
// scrolling forever.
const WHEEL_ITEM = 36;
const WHEEL_H = 150;
const MAX_FT = 60;

const clampFeet = (ft) => Math.max(1, Math.min(MAX_FT, Math.round(ft) || 0)) || 10;

export function CtpPrompt({ holeNumber, players, teams, leader, leaderName, onSave, onPass, onClose }) {
  const [pid, setPid] = useState("");
  // null means UNANSWERED — see the wheel below. Not 10, which is an
  // answer, and not the standing distance, which is somebody else's.
  const [feet, setFeet] = useState(null);
  const [busy, setBusy] = useState(false);
  // A gesture, not a scroll, is what counts as choosing. Parking the
  // wheel below fires the same scroll event a thumb does, so reading
  // scroll alone would mark the parked value as chosen the instant the
  // wheel appeared.
  const wheelTouched = useRef(false);

  const hasLeader = !!leader?.player_id;
  const leaderDist = leader?.distance_ft ? `${leader.distance_ft} ft` : "";
  // Where the wheel opens: on the number to beat, so beating it is a
  // short scroll up rather than a hunt from a cold default.
  const feetStart = leader?.distance_ft ? clampFeet(leader.distance_ft) : 10;

  const chosen = feet != null;
  // A standing tag with no distance on it (a director's hand-set winner)
  // is not a number, so there is nothing to be inside of.
  const beatsLeader = !hasLeader || !leader.distance_ft || (chosen && feet < leader.distance_ft);
  // BOTH halves, deliberately: a name without a measurement is not a tag.
  const canTag = !!pid && chosen && beatsLeader;

  // Park the wheel once, when the scroll node mounts. A useEffect would
  // fight the user's own scrolling on every re-render; the dataset flag
  // makes it a one-shot.
  const wheelRef = (el) => {
    if (el && !el.dataset.init) {
      el.dataset.init = "1";
      el.scrollTop = (feetStart - 1) * WHEEL_ITEM;
    }
  };
  const markTouched = () => { wheelTouched.current = true; };
  const onWheelScroll = (e) => {
    if (!wheelTouched.current) return;
    const v = Math.max(1, Math.min(MAX_FT, Math.round(e.currentTarget.scrollTop / WHEEL_ITEM) + 1));
    setFeet(prev => (prev === v ? prev : v));
  };

  const pick = (id) => {
    // Changing who it was un-answers the distance: the number belonged
    // to the other man's shot.
    setPid(prev => (prev === id ? "" : id));
    setFeet(null);
    wheelTouched.current = false;
  };

  const save = async () => {
    if (!canTag || busy) return;
    setBusy(true);
    await onSave(pid, feet);
  };

  const pass = async () => {
    if (busy) return;
    setBusy(true);
    // Only a standing tag can be confirmed — on an untagged hole the
    // pass is exactly as informative as it looks, and there is nothing
    // to write it against.
    if (hasLeader && onPass) { try { await onPass(); } catch { /* the pass still closes */ } }
    onClose();
  };

  const firstName = (players.find(p => p.player_id === pid)?.name || "").trim().split(/\s+/)[0] || "they";

  const hint = { fontSize: FS.label, color: BC.t3, textAlign: "center", marginBottom: 8, lineHeight: 1.4 };

  return (
    <Popup
      onClose={onClose}
      maxWidth={360}
      padding={0}
      noBackdropClose
      portal
      innerStyle={{ background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}` }}
    >
      {/* Header strip — the hole, and what is being asked about it. */}
      <div style={{
        background: BC.amber + ALPHA.wash, borderBottom: `1px solid ${BC.amber}${ALPHA.hair}`,
        padding: "14px 20px", textAlign: "center",
      }}>
        <div style={{ fontSize: FS.hero, marginBottom: 4 }}>🎯</div>
        <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.amberInk, letterSpacing: 0.3 }}>Closest to Pin</div>
        <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 2 }}>Hole {holeNumber} · Par 3</div>
      </div>

      <div style={{ padding: "14px 16px" }}>
        {/* Standing tag — the number to beat, from an earlier group. */}
        {hasLeader && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
            background: BC.warn + ALPHA.wash, border: `1px solid ${BC.warn}${ALPHA.line}`,
            borderRadius: 10, padding: "8px 10px",
          }}>
            <span style={{ fontSize: FS.body }}>⛳</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: FS.micro, fontWeight: 800, color: BC.warn, letterSpacing: 1.2 }}>
                {leader.approved ? "CTP — Final" : "Current CTP"}
              </span>
              <span style={{ display: "block", fontSize: FS.small, fontWeight: 700, color: BC.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {leaderName || "—"}
              </span>
            </span>
            {leaderDist && <span style={{ fontSize: FS.small, fontWeight: 800, color: BC.warn, flexShrink: 0 }}>{leaderDist}</span>}
          </div>
        )}

        {/* ── Who was closest ── */}
        {/* One card holding the whole first question: the names, and the
            answer for when it was none of them. Passing sitting at the
            bottom under Tag put the group's most common answer furthest
            from the question and behind a control that didn't apply. */}
        <div style={{ background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1.2, marginBottom: 8 }}>
            {hasLeader ? "Who was closer?" : "Who was closest?"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
            {players.map(p => {
              const sel = pid === p.player_id;
              const accent = teams?.[p.team]?.accent || BC.amber;
              return (
                <button
                  key={p.player_id}
                  onClick={() => pick(p.player_id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5, padding: "11px 8px", borderRadius: 10,
                    background: sel ? BC.amber + ALPHA.tint : BC.card,
                    border: `1px solid ${sel ? BC.amber : BC.bdr}`,
                    color: sel ? BC.amberInk : BC.t2,
                    fontSize: FS.small, fontWeight: 700, letterSpacing: 0.4, cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: accent, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name || p.player_id}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={pass}
            disabled={busy}
            style={{
              width: "100%", padding: "10px 8px", borderRadius: 10,
              background: BC.card, border: `1px solid ${BC.bdr}`, color: BC.t3,
              fontSize: FS.small, fontWeight: 700, letterSpacing: 0.5,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1,
            }}
          >
            {hasLeader
              ? `Confirm — ${leaderName || "the standing CTP"} keeps it`
              : "No one in our group hit the green"}
          </button>
        </div>

        {/* ── How close ── */}
        {/* Only once somebody is claiming it. Asking for a distance
            before the group has said whose shot it was is asking the
            second question first, and the group whose answer is "none of
            us" never needed it at all. */}
        {pid && (
          <>
            <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1.2, marginBottom: 6 }}>
              Approx. distance
            </div>
            <div style={{
              position: "relative", height: WHEEL_H, background: BC.inp,
              border: `1px solid ${chosen ? BC.amber + ALPHA.line : BC.bdr}`,
              borderRadius: 12, overflow: "hidden", marginBottom: 10,
            }}>
              {/* Selection band + unit label, both click-through so the
                  wheel underneath still takes the drag. Both stay grey
                  until the group has actually set a number — the band is
                  the difference between "parked here" and "we said so". */}
              <div style={{
                position: "absolute", left: 10, right: 10, top: "50%", height: WHEEL_ITEM + 2,
                transform: "translateY(-50%)",
                borderTop: `1.5px solid ${chosen ? BC.amber : BC.t3}`,
                borderBottom: `1.5px solid ${chosen ? BC.amber : BC.t3}`,
                borderRadius: 4, background: chosen ? BC.amber + ALPHA.wash : "transparent",
                pointerEvents: "none", zIndex: 2,
              }} />
              <div style={{
                position: "absolute", right: 46, top: "50%", transform: "translateY(-50%)",
                fontSize: FS.label, fontWeight: 800, color: chosen ? BC.amberInk : BC.t3,
                letterSpacing: 1.2, pointerEvents: "none", zIndex: 2,
              }}>FT</div>
              <div
                ref={wheelRef}
                onScroll={onWheelScroll}
                onPointerDown={markTouched}
                onTouchStart={markTouched}
                onWheel={markTouched}
                style={{
                  height: "100%", overflowY: "scroll", scrollSnapType: "y mandatory",
                  padding: `${(WHEEL_H - WHEEL_ITEM) / 2}px 0`,
                  WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
                }}
              >
                {Array.from({ length: MAX_FT }, (_, i) => i + 1).map(ft => (
                  <div key={ft} style={{
                    height: WHEEL_ITEM, lineHeight: `${WHEEL_ITEM}px`, textAlign: "center",
                    fontSize: ft === feet ? FS.title : FS.lead, fontWeight: ft === feet ? 800 : 700,
                    color: ft === feet ? BC.t1 : BC.t3, scrollSnapAlign: "center",
                  }}>{ft}</div>
                ))}
              </div>
              {/* Edge fades — sell the strip as a physical dial. */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 46, background: `linear-gradient(${BC.inp}, transparent)`, pointerEvents: "none" }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 46, background: `linear-gradient(transparent, ${BC.inp})`, pointerEvents: "none" }} />
            </div>

            {/* Why the Tag button is dead — surfaced, rather than leaving
                it mysteriously grey. */}
            {!chosen && (
              <div style={hint}>Spin the wheel to set how close {firstName} was.</div>
            )}
            {chosen && !beatsLeader && (
              <div style={{ ...hint, color: BC.warn }}>
                {feet === leader.distance_ft
                  ? `Tied with ${leaderName || "the current CTP"} — the earlier tag holds.`
                  : `Not inside ${leaderDist} — ${leaderName || "the current CTP"} keeps it.`}
              </div>
            )}

            <button
              onClick={save}
              disabled={!canTag || busy}
              style={{
                width: "100%", padding: 13, borderRadius: 10,
                background: canTag ? BC.amber : BC.inp,
                border: canTag ? "none" : `1px solid ${BC.bdr}`,
                color: canTag ? ON_AMBER : BC.t3,
                fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5,
                cursor: canTag && !busy ? "pointer" : "default",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {hasLeader ? "Tag New CTP" : "Tag CTP"}
            </button>
          </>
        )}
      </div>
    </Popup>
  );
}
