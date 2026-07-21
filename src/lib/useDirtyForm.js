// ══════════════════════════════════════════════════════════════════
//  useDirtyForm — local-state form with dirty tracking + explicit save.
// ══════════════════════════════════════════════════════════════════
//
// Captures user edits in local state, exposes an `isDirty` indicator,
// and commits on an explicit user action. Fixes the recurring class of
// bugs that inline "save on every tap" code tends to produce:
//
//   1. Stale-closure auto-save — two rapid taps both read the OLD state
//      and race, losing the intermediate edit.
//   2. Always-live Save button — confuses users and triggers needless
//      writes that flush realtime subscriptions and re-render everyone.
//   3. Forgotten reset-on-save — the dirty flag stays true forever.
//
// Usage
// ─────
//   const { value, setValue, isDirty, save, reset } = useDirtyForm({
//     initialValue: configFromServer,
//     onSave: async (current) => { await saveConfig(current); },
//   });
//
//   • value     — local working copy
//   • setValue  — update working copy (accepts a value or an updater fn,
//                 matching useState); flips isDirty when content differs
//   • isDirty   — true when value differs from the clean snapshot, deep-
//                 compared via key-sorted JSON so insertion-order changes
//                 in nested objects don't false-positive
//   • save      — async; calls onSave(value), then reconciles the clean
//                 snapshot so isDirty flips false on the next render
//   • reset     — discard edits, snap value back to the clean snapshot
//
// Incoming initialValue changes sync into local state ONLY when not
// dirty — if the user is mid-edit, their work is preserved and save()
// reconciles.

import { useState, useEffect, useRef, useCallback } from "react";

function stableStringify(obj) {
  return JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted = {};
      Object.keys(v).sort().forEach(k => { sorted[k] = v[k]; });
      return sorted;
    }
    return v;
  });
}

export function useDirtyForm({ initialValue, onSave }) {
  const [value, setValueRaw] = useState(initialValue);
  // Snapshot of the committed ("clean") value. A ref because nothing in
  // the render tree depends on it directly — only the dirty check reads it.
  const cleanRef = useRef(initialValue);

  // Sync incoming initialValue → local state ONLY when not dirty.
  useEffect(() => {
    const isCurrentlyDirty = stableStringify(value) !== stableStringify(cleanRef.current);
    if (!isCurrentlyDirty) {
      cleanRef.current = initialValue;
      setValueRaw(initialValue);
    }
  }, [initialValue, value]);

  const setValue = useCallback((next) => {
    setValueRaw(prev => typeof next === "function" ? next(prev) : next);
  }, []);

  const isDirty = stableStringify(value) !== stableStringify(cleanRef.current);

  const save = useCallback(async () => {
    // Snapshot the value at save time — protects against further edits
    // while the save is in flight. The snapshot becomes the new clean state.
    const snapshot = value;
    const result = await onSave(snapshot);
    cleanRef.current = snapshot;
    return result;
  }, [value, onSave]);

  const reset = useCallback(() => {
    setValueRaw(cleanRef.current);
  }, []);

  return { value, setValue, isDirty, save, reset };
}
