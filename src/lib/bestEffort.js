// ══════════════════════════════════════════════════════════════════
//  bestEffort — an optional step that cannot hold the door
// ══════════════════════════════════════════════════════════════════
//
// A try/catch makes a step optional when it REJECTS. It does nothing at all
// about one that never settles — and "best-effort" steps are usually calls
// into somebody else's SDK across a network, which is exactly the shape that
// hangs.
//
// That is not hypothetical. On the first iOS device this app ever ran on,
// `FirebaseMessaging.deleteToken()` was called and never came back: no APNs
// key had been uploaded to Firebase yet, so the token exchange it waits on
// could not complete. It sat inside a try/catch that was written to make it
// optional, the await never resolved, nothing threw, nothing was caught, and
// Delete Account stayed on "Deleting…" for as long as anybody cared to watch.
//
// So the wrapper races the step against a clock. Two decisions in it:
//
//   • The timeout RESOLVES rather than rejects. A step declining to answer in
//     time is not an error the caller should handle — it is the step being
//     optional, which is what it was declared to be. Rejecting would just move
//     the same problem into a catch somebody has to remember to write.
//
//   • A rejection is swallowed and logged, so the caller writes one line and
//     gets both failure modes covered. A caller that needs to KNOW should not
//     be using this.
//
// Pure, and in its own module rather than beside its caller, because the
// caller imports firebase — the same split as editionLock.js and editions.js.
// The guarantee is worth pinning, and a test of it must not boot Firebase.

/**
 * Run a promise as an optional step that can never block the caller.
 *
 * @param {Promise|any} promise  The step. Non-promises are fine.
 * @param {string} label         Named in the warning, so a log says which
 *   step gave up rather than that something did.
 * @param {number} ms            How long to wait before continuing anyway.
 * @param {object} [deps]        Injection seam for the test: `{ warn }`.
 * @returns {Promise<{ ok: boolean, reason?: "failed"|"timeout" }>}
 *   Always resolves. `ok` is for logging and assertions, not control flow —
 *   every caller of this is supposed to carry on regardless.
 */
export function bestEffort(promise, label, ms = 8000, deps = {}) {
  const warn = deps.warn || ((...a) => console.warn(...a));
  let timer;

  const attempt = Promise.resolve(promise).then(
    () => ({ ok: true }),
    (e) => {
      warn(`[bestEffort] ${label} failed:`, e?.message || e);
      return { ok: false, reason: "failed" };
    }
  );

  const clock = new Promise((resolve) => {
    timer = setTimeout(() => {
      warn(`[bestEffort] ${label} did not answer in ${ms}ms — continuing`);
      resolve({ ok: false, reason: "timeout" });
    }, ms);
  });

  // clearTimeout on the way out so a resolved step does not hold a pending
  // timer — which in a test environment keeps the event loop alive, and in a
  // browser keeps a closure alive for no reason.
  return Promise.race([attempt, clock]).finally(() => clearTimeout(timer));
}
