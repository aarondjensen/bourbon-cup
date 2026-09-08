// ══════════════════════════════════════════════════════════════════
//  useSyncStatus — the connection banner's state, as a hook.
// ══════════════════════════════════════════════════════════════════
//
// The judgement calls live here; the wording and the counting live in
// lib/connection, which is pure and tested. This file is the part that has to
// touch the browser.
//
// ── On navigator.onLine, and why it is not the whole answer ──
// `navigator.onLine` is false only when the OS is certain there is no network
// at all — flight mode, wifi off. It is cheerfully TRUE on a course with one
// bar that is passing nothing, and true on a clubhouse wifi that wants you to
// accept its terms first. So it catches the obvious case and misses the case
// this app was written for.
//
// The pending-write count is what catches the rest. A write that has not been
// acknowledged after a few seconds is the real signal that this phone is
// alone, whatever the OS thinks — and it is measured on the app's own traffic
// rather than on a heartbeat we would otherwise have to invent.
//
// STALL_MS is deliberately several seconds. A score normally lands in well
// under one, and a bar that blinks on every hole would be noise; something
// still outstanding after four is worth a sentence.
//
// A REFUSED write needs none of that judgement and gets none: it is not a
// timing question, the server has already answered no, and the banner says so
// on the spot. See lib/connection.
import { useEffect, useState } from "react";
import { syncStatus } from "./connection";

export const STALL_MS = 4000;

const readOnline = () => {
  try { return typeof navigator === "undefined" ? true : navigator.onLine !== false; }
  catch { return true; }
};

const EMPTY = { pending: 0, kinds: {}, since: null, refused: 0, refusedKinds: {} };

export function useSyncStatus(tracker) {
  const [online, setOnline] = useState(readOnline);
  const [writes, setWrites] = useState(() => (tracker ? tracker.state() : EMPTY));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => (tracker ? tracker.subscribe(setWrites) : undefined), [tracker]);

  // The stall clock, and it only runs while there is something to time. A
  // phone whose writes are landing normally never starts it, so the ordinary
  // case costs one comparison per render and no timers at all.
  //
  // `stalled` is DERIVED from the queue's own start time rather than latched
  // by a timeout, which is what keeps this effect from setting state during
  // its own run — the cascading-render shape the linter rejects, and the one
  // this file would otherwise have reached for.
  const since = writes.since;
  useEffect(() => {
    if (since == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);

  const stalled = since != null && now - since >= STALL_MS;
  return syncStatus({
    online, pending: writes.pending, kinds: writes.kinds, stalled,
    refused: writes.refused, refusedKinds: writes.refusedKinds,
  });
}
