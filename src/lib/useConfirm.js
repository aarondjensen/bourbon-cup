// ══════════════════════════════════════════════════════════════════
//  useConfirm — promise-based confirmations on the shared ConfirmModal.
// ══════════════════════════════════════════════════════════════════
//
// Drop-in, themed replacement for the blocking `window.confirm()`:
//
//   const { confirm, confirmModal } = useConfirm();
//   ...
//   if (await confirm({ title, message, confirmLabel, destructive })) { ... }
//   // gated behind a typed word:
//   if (await confirm({ title, message, requireText: "AMEND" })) { ... }
//   // asking WHY — resolves the trimmed reason, or null on cancel:
//   const why = await confirm({ title, reasonPrompt: { label: "Reason" } });
//   if (why == null) return;   // cancelled — note `== null`, since "" is not
//   // or shorthand:  if (await confirm("Remove this?")) { ... }
//   ...
//   // render ONCE, anywhere in the component's tree:
//   <ConfirmModal modal={confirmModal} />
//
// `confirm` returns a Promise<boolean> that resolves true on confirm and
// false on cancel / backdrop / ESC. The dialog is non-blocking (unlike
// window.confirm) so the rest of the app keeps painting behind it, and it
// picks up the live BC theme — one confirmation look for the whole app.
import { useCallback, useRef, useState } from "react";

export function useConfirm() {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);
  // What a CANCEL settles the currently-open confirm with. Held in a ref
  // rather than read off `opts` at settle time because the pre-emption below
  // fires from inside the NEXT confirm's call, when `opts` has already been
  // replaced. A reasonPrompt confirm cancels as null and an ordinary one as
  // false, and pre-empting one with the other's value is how a caller
  // checking `== null` silently receives `false` as its reason string.
  const cancelValue = useRef(false);

  const confirm = useCallback((options) => {
    const o = typeof options === "string" ? { message: options } : (options || {});
    return new Promise((resolve) => {
      // A confirm raised while another is already open would otherwise strand
      // the first promise unresolved forever, and any `await confirm(...)`
      // sitting behind it never returns — the caller's code after the await
      // simply never runs, with nothing on screen to suggest why. Settle the
      // outgoing one as a cancel before taking its place. (Came back from WBC,
      // which hit it first.)
      if (resolver.current) resolver.current(cancelValue.current);
      resolver.current = resolve;
      cancelValue.current = o.reasonPrompt ? null : false;
      setOpts(o);
    });
  }, []);

  const settle = useCallback((result) => {
    setOpts(null);
    const r = resolver.current;
    resolver.current = null;
    if (r) r(result);
  }, []);

  // Shaped for <ConfirmModal modal={…}/> — null when idle so it renders
  // nothing. A title always exists so ConfirmModal never no-ops on us.
  const confirmModal = opts && {
    title: opts.title || "Are you sure?",
    message: opts.message,
    confirmLabel: opts.confirmLabel,
    cancelLabel: opts.cancelLabel,
    destructive: opts.destructive,
    eyebrow: opts.eyebrow,
    alert: opts.alert,
    // Typed confirmation — see ConfirmModal. Holds Confirm disabled until
    // the director types the word, for the rare irreversible actions where
    // a one-tap confirm is the reflex rather than the check.
    requireText: opts.requireText,
    // Asking WHY. When set, ConfirmModal renders a required free-text box and
    // hands its contents to onConfirm, which is what changes this promise's
    // resolution from a boolean to the reason string (null on cancel).
    reasonPrompt: opts.reasonPrompt,
    // With a reasonPrompt the RESULT is the reason, so cancel has to settle
    // as null rather than false — `false` and `""` are both falsy and the
    // caller has to be able to tell "they backed out" from "they typed
    // nothing", which is why the box is required in the first place.
    onConfirm: (reason) => settle(opts.reasonPrompt ? (reason ?? "") : true),
    onCancel: () => settle(cancelValue.current),
  };

  return { confirm, confirmModal };
}
