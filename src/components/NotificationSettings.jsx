// ══════════════════════════════════════════════════════════════════
//  Notifications — the one screen that owns the permission dance.
// ══════════════════════════════════════════════════════════════════
//
// Ported from the MnQ golf league app's settings page, minus its sign-in
// linking (this app has no accounts) and its native branch (no Capacitor
// build). What is left is the part that matters: turning push on is four
// different conversations depending on the device, and every one of them
// has to end with the user knowing what to do next.
//
//   0. iOS below 16.4 → no Push API at all. Say so; installing won't help.
//   0b. iOS in a Safari tab → push only works from a home-screen install.
//       Walk through Add to Home Screen rather than showing a toggle that
//       cannot work.
//   1. Supported → the toggle, the list of what will be sent, and a test.
//   2. Denied → no toggle. The browser will not re-prompt after a denial;
//      the only way back is through device settings, so explain that
//      instead of offering a button that silently does nothing.
//   3. Unsupported browser → say which ones work.
//
// The status card reads SUBSCRIBED, not PERMISSION. The two diverge: a user
// who turns notifications off here has their token deleted but keeps the
// browser grant, so permission stays "granted" forever while the honest
// answer is "off". Only the presence of a token says whether anything will
// actually arrive.
import { useState, useEffect } from "react";
import { BC, FONT, ALPHA, FS } from "../theme";
import {
  registerForPush, unsubscribeFromPush, getNotificationPermissionState, refreshPermissionState, canSubscribe, testPushOutcome,
  isStandalonePWA, isIOSPushCapable, checkSubscriptionStatus,
  getCachedSubscriptionStatus, readTypePrefs, saveTypePrefs,
  getCachedTypePrefs, normalizeTypePrefs,
} from "../lib/notifications";

// What actually gets sent, and now what each one can be switched off from.
// A user deciding whether to allow notifications is entitled to know what
// they are agreeing to receive, and "golf app would like to send you
// notifications" does not tell them.
//
// `key` is the `type` the Cloud Functions stamp into the payload and the
// value sendToPlayer gates on — the list of keys lives in lib/notifications,
// which is the one place the two halves agree.
//
// THE EMOJI ARE GONE. They were decoration on a row that had nothing to do:
// three glyphs in three different visual styles, doing the work a heading
// already did. Now the row has a control on the right, and the icon was
// competing with it for the same job of saying which line you are looking at.
const TYPES = [
  { key: "attest_ready", title: "Time to attest your card", sub: "Someone in your match signed it" },
  { key: "card_final", title: "Your card is final", sub: "Everyone has attested" },
  { key: "round_final", title: "A round is final", sub: "Handicaps frozen, next round open" },
];

const Card = ({ children, style }) => (
  <div style={{
    background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 10,
    padding: "14px 16px", ...style,
  }}>{children}</div>
);

// `small` is the per-type row's switch. A step down from the master's,
// because it IS a step down from it: the three types are gated by the one
// above them, and two switches at identical weight would read as three peers
// where one of them silently overrules the others.
//
// `disabled` and `busy` look the same and mean different things — nothing to
// act on versus a write in flight — so they share the dimming but only busy
// is temporary.
function Toggle({ on, busy, disabled, small, onChange, label }) {
  const w = small ? 42 : 52, h = small ? 24 : 30, k = h - 6;
  const off = disabled || busy;
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      onClick={off ? undefined : onChange} disabled={off}
      style={{
        width: w, height: h, borderRadius: h / 2, border: "none", padding: 0,
        background: on ? BC.green : BC.bdr, position: "relative", flexShrink: 0,
        cursor: off ? "default" : "pointer", opacity: off ? 0.5 : 1,
        transition: "background .2s ease, opacity .2s ease",
      }}>
      <span style={{
        position: "absolute", top: 3, left: on ? w - k - 3 : 3, width: k, height: k,
        borderRadius: "50%", background: "#fff", transition: "left .2s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,.3)",
      }} />
    </button>
  );
}

export function NotificationSettings({ user, notify }) {
  const [permission, setPermission] = useState("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [iosOk, setIosOk] = useState(true);
  const [testing, setTesting] = useState(false);
  // Which pushes this player wants. All on until something says otherwise —
  // see normalizeTypePrefs, which is where "absent means on" is decided.
  const [types, setTypes] = useState(() => normalizeTypePrefs(null));
  const [typeBusy, setTypeBusy] = useState(null);

  const pid = user?.player_id;

  useEffect(() => {
    setPermission(getNotificationPermissionState());
    // On the web the line above is already the final answer. On the native
    // build the permission state lives in the OS and cannot be read
    // synchronously, so the call above returns a cache that this refreshes —
    // see the note in lib/notifications. Resolves to the same value it just
    // set on the web, so there is no platform branch here.
    let live = true;
    refreshPermissionState().then(p => { if (live) setPermission(p); });
    setStandalone(isStandalonePWA());
    setIosOk(isIOSPushCapable());
    if (!pid) return () => { live = false; };
    // Paint the device's last known answer first so the card does not read
    // "Off" for the length of a Firestore round-trip at someone who is on,
    // then correct from the server. A null result means the READ failed —
    // leave the state alone rather than nagging a subscribed user.
    const cached = getCachedSubscriptionStatus(pid);
    if (cached !== null) setSubscribed(cached);
    checkSubscriptionStatus(pid).then(sub => { if (sub !== null) setSubscribed(sub); });
    // Same two-step for the three switches, and for the same reason: three
    // controls that paint ON and flick OFF a moment later look broken.
    const cachedTypes = getCachedTypePrefs(pid);
    if (cachedTypes) setTypes(cachedTypes);
    readTypePrefs(pid).then(p => { if (p) setTypes(p); });
    return () => { live = false; };
  }, [pid]);

  // Optimistic, and it PUTS IT BACK if the write is refused. A preference
  // switch that stays where it was flicked while the push keeps arriving is
  // the one failure this screen cannot have — there is nothing on screen to
  // disagree with, so nobody would ever find out by looking.
  const handleType = async (key) => {
    if (typeBusy || !pid) return;
    const before = types;
    const next = { ...types, [key]: !types[key] };
    setTypeBusy(key);
    setTypes(next);
    const res = await saveTypePrefs(pid, next);
    if (!res?.ok) {
      setTypes(before);
      notify?.(res?.error || "Couldn't save that — try again", "error");
    }
    setTypeBusy(null);
  };

  const handleToggle = async () => {
    if (busy || !pid) return;
    setBusy(true);
    if (subscribed) {
      await unsubscribeFromPush(pid);
      setSubscribed(false);
      notify("Notifications off", "success");
    } else {
      const res = await registerForPush(pid);
      if (res.success) {
        setSubscribed(true);
        notify("Notifications on", "success");
      } else if (res.error === "vapid_key_missing") {
        // A deployment problem, not a user one, and worth saying plainly —
        // it looks identical to a browser refusal from the outside.
        notify("Push isn't configured on this deployment yet", "error");
      } else if (res.state !== "denied" && res.state !== "unsupported") {
        // Those two are explained by the card below; a red toast on top of
        // the explanation is just noise. Anything else is unexpected and
        // needs to be visible.
        notify(`Couldn't enable: ${res.error || res.state}`, "error");
      }
    }
    setPermission(getNotificationPermissionState());
    setBusy(false);
  };

  // The test send. Every iOS PWA push failure looks the same from this
  // screen — a toggle reading On — so without this the first time anyone
  // finds out is the round it mattered.
  const sendTest = async () => {
    if (!pid || testing) return;
    setTesting(true);
    try {
      const [{ getFunctions, httpsCallable }, { getApp }] = await Promise.all([
        import("firebase/functions"),
        import("firebase/app"),
      ]);
      const res = await httpsCallable(getFunctions(getApp()), "sendTestPush")({ playerId: pid });
      // The report is read WHOLE — see testPushOutcome. Reading only `sent`
      // reported a refused delivery as an absent device, which sends somebody
      // looking for the cause in the one place it isn't.
      const { tone, text } = testPushOutcome(res?.data);
      notify(text, tone);
    } catch (e) {
      notify(`Test failed: ${e?.message || e}`, "error");
    } finally { setTesting(false); }
  };

  const wrap = (children) => (
    <div style={{ fontFamily: FONT, padding: "4px 2px 20px", overflowY: "auto" }}>
      {/* Centred, like every other head on My Account — this section is
          embedded in that screen and nowhere else, so it has to match the
          ones above and below it. */}
      <div style={{
        fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5,
        color: BC.amberInk, marginBottom: 10, textAlign: "center",
      }}>
        NOTIFICATIONS
      </div>
      {children}
    </div>
  );

  // ── Nobody to address ──
  // Before every device check below, because this one is about WHO is reading
  // rather than what they are holding. A spectator and a bootstrap director
  // are signed-in members, so the token write succeeds and everything on this
  // screen then agrees that notifications are on — while `sendToPlayer`
  // addresses pushes by player_id and never addresses either of them. See
  // canSubscribe in lib/notifications.
  //
  // Found on a real phone, which is the only place it can be found: a test
  // push that went nowhere, and one token row in the whole project filed under
  // "spectator".
  if (!canSubscribe(pid)) return wrap(
    <Card>
      <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.t1, marginBottom: 6 }}>Claim your name first</div>
      <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.5 }}>
        Notifications are sent to a player on the roster, so this device has to
        be linked to one. You&rsquo;re viewing a tournament you aren&rsquo;t in
        — open yours from ☰ → Tournaments and pick your name.
      </div>
    </Card>
  );

  // ── iOS, too old ──
  if (!iosOk) return wrap(
    <Card>
      <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.t1, marginBottom: 6 }}>iOS update needed</div>
      <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.5 }}>
        Push notifications need iOS 16.4 or later. Settings → General → Software Update.
      </div>
    </Card>
  );

  // ── iOS, in a Safari tab ──
  // Detected rather than assumed: iOS Safari exposes no Notification API in
  // a normal tab, which is why the permission state reads "unsupported"
  // there and "default" once installed.
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent || "");
  if (isIOS && !standalone && permission === "unsupported") return wrap(
    <Card>
      <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.t1, marginBottom: 6 }}>Add to your home screen first</div>
      <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.5, marginBottom: 10 }}>
        On iPhone, notifications only work when the app is installed. It takes about ten seconds:
      </div>
      <ol style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
        <li>Tap <strong style={{ color: BC.t1 }}>Share</strong> at the bottom of Safari.</li>
        <li>Scroll down, tap <strong style={{ color: BC.t1 }}>Add to Home Screen</strong>.</li>
        <li>Open the app from your home screen, not from Safari.</li>
        <li>Come back here and turn the switch on.</li>
      </ol>
    </Card>
  );

  return wrap(
    <>
      <Card style={{ marginBottom: 10 }}>
        {permission === "denied" ? (
          <>
            <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.warn, marginBottom: 4 }}>Blocked</div>
            <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.5 }}>
              Notifications were blocked for this app. Your browser won&apos;t ask again — allow them
              in your device or browser settings, then come back to this page.
            </div>
          </>
        ) : permission === "unsupported" ? (
          <>
            <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.t1, marginBottom: 4 }}>Not supported here</div>
            <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.5 }}>
              This browser can&apos;t do push notifications. Chrome, Edge, or Safari on iOS 16.4+
              installed to the home screen all can.
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: FS.body, fontWeight: 800, color: subscribed ? BC.green : BC.t1, minWidth: 0 }}>
              {subscribed ? "Notifications on" : "Notifications off"}
            </div>
            <Toggle on={subscribed} busy={busy} onChange={handleToggle} />
          </div>
        )}
      </Card>

      {/* One row per push, each with its own switch. The list used to be a
          read-only manifest — here is what we will send you — and the switch
          is what turns it into a choice: the man who wants to know his round
          is final but not that a partner signed a card can now say so,
          instead of taking all three or none.

          DISABLED, NOT HIDDEN, while the master is off. The rows still show
          what this player has chosen, so switching push back on holds no
          surprise; they simply cannot be moved while there is nothing to
          receive. Hiding them would make the choices look forgotten. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {TYPES.map((t) => (
          <Card key={t.key} style={{ padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: FS.small, fontWeight: 700,
                  color: subscribed ? BC.t1 : BC.t2,
                }}>{t.title}</div>
                <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 1 }}>{t.sub}</div>
              </div>
              <Toggle
                small
                label={t.title}
                on={types[t.key]}
                busy={typeBusy === t.key}
                disabled={!subscribed}
                onChange={() => handleType(t.key)}
              />
            </div>
          </Card>
        ))}
      </div>

      {subscribed && (
        <button onClick={sendTest} disabled={testing} style={{
          width: "100%", padding: "10px 0", marginTop: 10, borderRadius: 8,
          background: `${BC.hcpBlue}${ALPHA.wash}`, border: `1px solid ${BC.hcpBlue}${ALPHA.line}`,
          color: BC.hcpBlue, fontSize: FS.small, fontWeight: 800,
          cursor: testing ? "default" : "pointer", opacity: testing ? 0.6 : 1, fontFamily: FONT,
        }}>
          {testing ? "Sending…" : "Send a test notification"}
        </button>
      )}

      {/* The one thing people get wrong. A phone and a laptop are separate
          subscriptions; turning it on here does not turn it on there. */}
      <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.6, marginTop: 12, padding: "0 2px" }}>
        Notifications are per device — turn them on separately on each phone or browser.
      </div>
    </>
  );
}
