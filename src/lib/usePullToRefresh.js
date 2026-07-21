// ══════════════════════════════════════════════════════════════════
//  usePullToRefresh — iOS-style pull-down-to-refresh on document body.
// ══════════════════════════════════════════════════════════════════
//
// Extracted verbatim from App.jsx's ~135-line inline implementation.
// The gesture logic is unchanged — same 0.4x dampening, 120px max
// pull, 80px trigger threshold, 2px "at top" tolerance, and the iOS
// Safari bounce fix (preventDefault on every at-top downward move so
// the native overscroll can't steal the gesture). Lifting it here
// leaves App.jsx with a one-line consumer call and gives BC the same
// hook shape MNQ/WBC use, so the gesture stays identical across all
// three apps.
//
// What stays with the caller (App.jsx owns these, passes them in):
//   • popupOpenRef        — a ref that reads true whenever a top-level
//                           modal/menu is open, so the gesture no-ops
//                           and doesn't fight the modal's own scroll.
//                           Read via .current inside the handlers so a
//                           popup toggle never forces handler re-install.
//   • hasNewBundle        — async () => boolean. Checks whether a newer
//                           Vite build has shipped; when true the hook
//                           hard-reloads so the user picks up the latest
//                           code. BC's implementation fetches index.html
//                           and diffs the hashed asset URLs.
//   • onRefresh (optional)— called when there's NO new bundle. BC's data
//                           is live via onSnapshot, so BC passes nothing
//                           and the gesture just shows a confirmation
//                           spin. Other apps can pass a refetch here.
//   • scrollClass         — className of the main scroll container the
//                           handlers walk up to find. Defaults to the
//                           'bc-app-body' class already on BC's body div.
//
// Returns { pullY, refreshing, resetPull, PULL_THRESHOLD }. App.jsx's
// indicator render reads pullY / refreshing / PULL_THRESHOLD directly.

import { useState, useRef, useCallback, useEffect } from "react";

const PULL_THRESHOLD = 80;   // px of pull needed to trigger a refresh
const MAX_PULL = 120;        // indicator can't drift past this
const DRAG_RATE = 0.4;       // finger-to-indicator dampening
const AT_TOP_TOL = 2;        // scrollTop <= this counts as "at top" (iOS subpixel)
const START_SLOP = 5;        // downward px before the pull actually begins
const HARD_SAFETY_MS = 8000; // force-reset if the refresh work hangs
const SOFT_WATCHDOG_MS = 2000; // reset a pull that got stuck > 0 with no refresh
const REFRESH_DELAY_MS = 600;  // brief hold so the spin reads as intentional

export function usePullToRefresh({
  popupOpenRef,
  hasNewBundle,
  onRefresh,
  scrollClass = "bc-app-body",
} = {}) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const pullYRef = useRef(0);
  const pullingRef = useRef(false);

  // Manual reset escape hatch — used by the soft watchdog below and
  // exported in case the caller needs to abort a stuck pull.
  const resetPull = useCallback(() => {
    setPullY(0);
    pullYRef.current = 0;
    touchStartY.current = 0;
    pullingRef.current = false;
  }, []);

  // Touch handler effect — installs document-level touchstart/move/end
  // listeners that watch for a downward drag at the top of the scroll
  // container. Suppressed entirely while `refreshing` is true (one
  // refresh at a time) and while a popup is open. The "at top" check
  // walks up from the touch target to find the scrollClass element — if
  // the target isn't inside it, the gesture is ignored (touches inside
  // the slide menu, the login screen, or a modal). passive:false on
  // touchmove is required because we preventDefault() to stop the
  // browser's native overscroll bounce while the user is pulling.
  useEffect(() => {
    if (refreshing) return;

    const findScrollEl = (target) => {
      let el = target;
      while (el) {
        if (el.classList && el.classList.contains(scrollClass)) return el;
        el = el.parentElement;
      }
      return null;
    };
    let activeScrollEl = null;

    const handleStart = (e) => {
      if (popupOpenRef?.current) { touchStartY.current = 0; return; }
      activeScrollEl = findScrollEl(e.target);
      if (!activeScrollEl) { touchStartY.current = 0; return; }
      touchStartY.current = e.touches[0].clientY;
      pullingRef.current = false;
    };

    const handleMove = (e) => {
      if (!touchStartY.current) return;
      if (popupOpenRef?.current) {
        if (pullingRef.current) { pullingRef.current = false; pullYRef.current = 0; setPullY(0); }
        touchStartY.current = 0;
        return;
      }
      // 2px tolerance absorbs subpixel scrollTop rounding on iOS (with
      // safe-area-inset + momentum cleanup, 1px was too strict and the
      // gesture failed when visually at top but scrollTop reported ~1.5).
      const atTop = activeScrollEl ? activeScrollEl.scrollTop <= AT_TOP_TOL : false;
      const currentY = e.touches[0].clientY;
      const diff = currentY - touchStartY.current;

      if (pullingRef.current) {
        if (diff <= 0 || !atTop) {
          pullingRef.current = false;
          pullYRef.current = 0;
          setPullY(0);
          touchStartY.current = currentY;
        } else {
          // 0.4x dampening gives the pull a sense of tension; capped at
          // MAX_PULL so the indicator can't drift indefinitely.
          e.preventDefault();
          const val = Math.min(diff * DRAG_RATE, MAX_PULL);
          pullYRef.current = val;
          setPullY(val);
        }
      } else if (atTop && diff > 0) {
        // CRITICAL iOS fix: preventDefault on EVERY at-top downward
        // touchmove, not only after the threshold. iOS Safari's native
        // overscroll bounce begins on the very first downward move at
        // scrollTop=0; once that animation starts, later preventDefault
        // calls are ignored and the bounce overrides the custom pull.
        // Shutting it down before the START_SLOP threshold is what keeps
        // the gesture from feeling "stuck" when begun on some elements.
        e.preventDefault();
        if (diff > START_SLOP) {
          touchStartY.current = currentY;
          pullingRef.current = true;
          pullYRef.current = 0;
          setPullY(0);
        }
      } else if (!atTop) {
        touchStartY.current = currentY;
      }
    };

    const handleEnd = () => {
      if (popupOpenRef?.current) {
        pullingRef.current = false;
        pullYRef.current = 0;
        setPullY(0);
        touchStartY.current = 0;
        activeScrollEl = null;
        return;
      }
      pullingRef.current = false;
      activeScrollEl = null;
      if (pullYRef.current >= PULL_THRESHOLD) {
        // Threshold met — commit. Pin the indicator at threshold height
        // while the work runs so it doesn't snap back mid-spin. 8s hard
        // safety in case the bundle check or the work itself hangs.
        setPullY(PULL_THRESHOLD); pullYRef.current = PULL_THRESHOLD;
        setRefreshing(true);
        const hardSafety = setTimeout(() => {
          setRefreshing(false); setPullY(0); pullYRef.current = 0; touchStartY.current = 0;
        }, HARD_SAFETY_MS);
        setTimeout(async () => {
          try {
            const needsUpdate = hasNewBundle ? await hasNewBundle() : false;
            if (needsUpdate) { clearTimeout(hardSafety); window.location.reload(); return; }
            // No new build — refresh any non-realtime reads. BC leaves
            // this undefined (data is live via onSnapshot); the 600ms
            // hold above already gave the user visual confirmation.
            if (onRefresh) await onRefresh();
          } catch { /* swallow — finally still resets the UI */ } finally {
            clearTimeout(hardSafety);
            setRefreshing(false); setPullY(0); pullYRef.current = 0; touchStartY.current = 0;
          }
        }, REFRESH_DELAY_MS);
      } else {
        setPullY(0); pullYRef.current = 0; touchStartY.current = 0;
      }
    };

    document.addEventListener("touchstart", handleStart, { passive: true });
    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("touchend", handleEnd, { passive: true });
    document.addEventListener("touchcancel", handleEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", handleStart);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
      document.removeEventListener("touchcancel", handleEnd);
    };
  }, [refreshing, hasNewBundle, onRefresh, popupOpenRef, scrollClass]);

  // Soft safety watchdog (additive vs. the old inline code): if pullY
  // drifts above zero without a refresh running, reset it after 2s.
  // Catches the rare case where touchend/touchcancel doesn't fire and
  // the indicator gets stuck part-way down. 2s is long enough that a
  // legitimate sub-threshold pull isn't cut off.
  useEffect(() => {
    if (pullY > 0 && !refreshing) {
      const safety = setTimeout(resetPull, SOFT_WATCHDOG_MS);
      return () => clearTimeout(safety);
    }
  }, [pullY, refreshing, resetPull]);

  return { pullY, refreshing, resetPull, PULL_THRESHOLD };
}
