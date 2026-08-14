// ── GHIN client helpers ──────────────────────────────────────────────
// Thin wrappers over /api/ghin (the serverless proxy that holds the GHIN
// credentials). Two operations, matching the two halves of the feature:
//
//   searchGhinGolfers(query)   → GET  /api/ghin?search=   (link: find a number)
//   syncGhinNumbers(numbers)   → POST /api/ghin           (sync: numbers → index)
//
// Never call api2.ghin.com from the browser — CORS blocks it and the
// credentials must stay server-side. Everything goes through the proxy.
//
// Field naming matches the proxy + player docs: `ghin_number` is the stored
// link; `handicap_index` is the value that flows back into the roster.
//
// The paths go through `apiUrl` rather than being fetched raw, and that is
// entirely about the iOS build: it runs from `capacitor://localhost`, where a
// relative "/api/ghin" resolves inside the app bundle and 404s instead of
// reaching Vercel. On the web `apiUrl` returns the path unchanged, so this is
// the same same-origin call it has always been. See lib/platform.
import { apiUrl } from "./platform";

// GHIN encodes plus-handicaps as "+2.1" (a better-than-scratch player). The
// app models those as NEGATIVE indexes (see scoring.js / John S), so convert
// on the way in. "NH" / blank / null → null (no handicap on file).
export function parseGhinHI(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (s === "" || s.toUpperCase() === "NH") return null;
  if (s.startsWith("+")) return -parseFloat(s.slice(1));
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Display helper: render a stored/parsed index the way golfers expect, with
// plus handicaps shown as "+2.1" rather than "-2.1".
export function fmtHI(v) {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  return n < 0 ? `+${Math.abs(n)}` : `${n}`;
}

export async function searchGhinGolfers(query, state) {
  const params = new URLSearchParams({ search: query });
  if (state && String(state).trim()) params.set("state", String(state).trim());
  const r = await fetch(apiUrl(`/api/ghin?${params.toString()}`));
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `GHIN search failed (${r.status})`);
  }
  const data = await r.json();
  // [{ ghin_number, name, first_name, last_name, club_name, state,
  //    handicap_index (raw), last_revision_date }]
  return Array.isArray(data?.results) ? data.results : [];
}

// Batch-sync one or more GHIN numbers. Returns a map keyed by ghin_number so
// callers can update the matching player docs. One login + N reads server-side.
export async function syncGhinNumbers(numbers) {
  const list = (numbers || []).map(n => String(n).trim()).filter(Boolean);
  if (!list.length) return {};

  const r = await fetch(apiUrl("/api/ghin"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ghin_numbers: list }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `GHIN sync failed (${r.status})`);
  }

  const data = await r.json();
  const byNumber = {};
  for (const res of (data?.results || [])) {
    if (res?.ghin_number) byNumber[String(res.ghin_number)] = res;
  }
  return byNumber;
}
