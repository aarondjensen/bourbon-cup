// ══════════════════════════════════════════════════════════════════
//  authPairing — moving a claimed name to a new sign-in.
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC. A man signs in with Google one summer and taps Apple the
// next — new phone, muscle memory, whichever button sits on top. That is a
// different uid, and his name on the roster is already claimed by the old
// one, so the claim screen has nothing to offer him.
//
// The manual fix already exists and stays the fallback: a director unlinks
// the row in Admin → Players and he re-claims it. This makes it self-service,
// which is what matters on a Thursday when the director is driving.
//
// ── What a code is, and what it is not ──
// It moves a ROSTER LINK between two accounts that are both already in the
// tournament — the claiming account has to hold a membership, which means it
// has already been through the invite code. So this is not a second door into
// the cup, and a leaked code buys nothing the invite code does not already
// gate. The functions enforce that; this file is the client half.
//
// Everything here is pure apart from the two callables at the bottom, which
// is what lets the wording and the validation be pinned by tests.

// No I, O, 0 or 1 — the four that get mistyped when a code is read off one
// phone and typed into another. Must match PAIRING_ALPHABET in
// functions/index.js, and `normalizeCode` is what makes a mismatch harmless
// rather than a silent rejection.
export const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_LENGTH = 8;

// What the box does to what somebody types. Upper-cased because the code is
// generated upper-case and nobody thinks about that, and spaces and dashes
// stripped because a code SHOWN as "ABCD EFGH" gets typed back with the gap
// in it.
//
// There is deliberately no fold for I, O, 0 and 1. An earlier pass here
// folded 0→O and 1→I, which is wrong in a way worth writing down: the
// alphabet excludes ALL FOUR, so folding produces a character a real code can
// never contain and turns a typo into a different typo. Excluding all four is
// what makes a fold unnecessary in the first place — none of them can appear,
// so none of them can be confused for another. The exclusion IS the fix.
export const cleanCode = (raw) =>
  String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, PAIRING_LENGTH);

// Is this something worth sending? A short code is somebody still typing, not
// an error to shout about, so the button is simply not ready yet.
export const isCompleteCode = (raw) => {
  const c = cleanCode(raw);
  return c.length === PAIRING_LENGTH && [...c].every(ch => PAIRING_ALPHABET.includes(ch));
};

// How the code is SHOWN — one gap in the middle, because eight unbroken
// characters get lost halfway through when read aloud across a table.
export const formatCode = (raw) => {
  const c = cleanCode(raw);
  return c.length > 4 ? `${c.slice(0, 4)} ${c.slice(4)}` : c;
};

// How long is left on a code, in the words on the button. Codes live fifteen
// minutes; the number matters far less than whether it is still alive.
export const expiryLabel = (expiresAt, now = Date.now()) => {
  const ms = Number(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "Expired";
  const mins = Math.ceil(ms / 60000);
  return mins === 1 ? "Expires in 1 minute" : `Expires in ${mins} minutes`;
};

// ── What a failure means, in words somebody can act on ──────────────
// The callables throw `functions/<code>` and every one of these has a
// different fix. "Try again" is a lie for most of them.
export const pairingError = (e, fallback = "That didn't work — try again.") => {
  const code = e?.code || "";
  const msg = e?.message || "";
  // The functions are deployed by hand, like the rules. Until they are, this
  // is the failure, and no amount of retrying will change it.
  //
  // `not-found` means exactly that and nothing else: an unknown pairing code
  // comes back as `invalid-argument` from the function, deliberately, because
  // the two would otherwise be indistinguishable here and the advice for them
  // is opposite — one is "ask for a new code", the other is "nobody has
  // deployed this yet and no code will ever work".
  if (code === "functions/not-found") {
    return "Moving a sign-in isn't deployed yet — ask the tournament director to deploy the Cloud Functions.";
  }
  if (code === "functions/unauthenticated") return "Your sign-in expired. Sign in again, then try.";
  if (code === "functions/deadline-exceeded") return "That code has expired. Ask for a new one.";
  // These two carry a message written for the person reading it.
  if (code === "functions/failed-precondition" || code === "functions/invalid-argument") {
    return msg || fallback;
  }
  if (code === "functions/permission-denied") {
    return "That code isn't valid. Ask for a new one.";
  }
  return msg || fallback;
};

// ── The two calls ───────────────────────────────────────────────────
// firebase/functions is imported on demand for the same reason messaging is:
// it has no business on the critical path for a leaderboard.
const callable = async (name, payload) => {
  const [{ getFunctions, httpsCallable }, { getApp }] = await Promise.all([
    import("firebase/functions"),
    import("firebase/app"),
  ]);
  return httpsCallable(getFunctions(getApp()), name)(payload);
};

// Ask for a code on the account that HOLDS the name.
export async function offerPairing() {
  try {
    const res = await callable("offerAuthPairing");
    return { ok: true, ...(res?.data || {}) };
  } catch (e) {
    return { ok: false, error: pairingError(e, "Couldn't make a code — try again.") };
  }
}

// Spend it on the account that WANTS the name.
export async function claimPairing(rawCode) {
  const code = cleanCode(rawCode);
  if (!isCompleteCode(code)) return { ok: false, error: "That code doesn't look right — it's eight characters." };
  try {
    const res = await callable("claimAuthPairing", { code });
    return { ok: true, ...(res?.data || {}) };
  } catch (e) {
    return { ok: false, error: pairingError(e, "Couldn't move your name — try again.") };
  }
}
