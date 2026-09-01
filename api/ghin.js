// /api/ghin.js
//
// Vercel serverless function that proxies the unofficial GHIN endpoints used
// by the GHIN mobile app. The browser can't talk to api2.ghin.com directly
// (CORS), and we don't want the director's GHIN credentials shipped to the
// client anyway — both reasons this lives server-side.
//
// The flow is two hops:
//   1. POST /api/v1/golfer_login.json with the director's GHIN email + password
//      → returns a session token (golfer_user_token)
//   2. For each requested ghin_number, GET /api/v1/golfers/{n}.json with that
//      token in the Authorization header → returns name + handicap_index
//
// We log in once per request and reuse the token across every lookup, so a
// 16-player refresh is one auth call + 16 cheap reads.
//
// ── Env vars (set in Vercel project settings) ──
//   GHIN_EMAIL     The director's GHIN email (or GHIN number works too)
//   GHIN_PASSWORD  The director's GHIN password
//
// ── Caveats ──
// These endpoints are not officially documented by the USGA. They've been
// stable for years (used by the GHIN app, MagicMirror plugins, the @spicygolf
// npm wrapper, etc.) but could change. If a refresh ever returns 401/404
// across the board, the endpoint shape probably moved — check the response
// shape returned from the /api/v1/golfers/{n}.json call below.
//
// ── Request shapes ──
//   POST /api/ghin                         (batch sync — existing)
//     Body: { ghin_numbers: ["1234567", "8901234", ...] }
//
//   GET  /api/ghin?search=<name|number>    (search / link — added)
//     Finds candidate golfers so a player can be matched to their GHIN
//     number in the first place. This is the "link" half; the POST batch
//     above is the "sync" half that runs once a number is stored.
//
//   GET  /api/ghin?diagnose=1[&ghin=<n>]   (why did a sync fail?)
//     Reproduces both hops and reports what each one actually answered —
//     statuses, response key names, and an upstream body only when that hop
//     ERRORED. Returns no credential and no golfer data. This is the answer
//     to "16 failed" with no reason attached; see diagnose() below.
//
// ── Response shapes ──
//   POST → 200 OK
//     { results: [
//         { ghin_number, handicap_index, first_name, last_name, last_revision_date },
//         { ghin_number, error: "..." },   // per-golfer failure, doesn't kill the batch
//         ...
//       ] }
//
//   GET  → 200 OK
//     { results: [
//         { ghin_number, name, first_name, last_name, club_name, state,
//           handicap_index, last_revision_date },
//         ...
//       ] }

const GHIN_BASE = "https://api2.ghin.com/api/v1";

// The login request itself, returned raw so both the normal path and the
// `?diagnose=` probe can read the SAME response. They used to be one function
// that threw a string, which is why a login that answered 200 with a shape we
// no longer recognise was indistinguishable from one that answered 401.
async function loginRequest() {
  const email = process.env.GHIN_EMAIL;
  const password = process.env.GHIN_PASSWORD;
  if (!email || !password) {
    throw new Error("GHIN_EMAIL and GHIN_PASSWORD env vars must be set in Vercel");
  }

  const r = await fetch(`${GHIN_BASE}/golfer_login.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      user: {
        email_or_ghin: email,
        password: password,
        remember_me: "true",
      },
      // The GHIN API requires this `token` field at the top level. The value
      // is arbitrary — it's a vestigial app-identifier, not a secret.
      token: "bourbon-cup",
    }),
  });

  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* an HTML error page, not JSON */ }

  // WHICH field the token came out of is worth knowing, because the last
  // fallback (`data.token`) is the one that can hand back a non-session
  // value: we send a top-level `token` on the way in, so a response that
  // echoes it would look like a successful login and then 401 on every
  // single golfer read — which is exactly the "N failed, no reason given"
  // shape this file keeps producing.
  const field =
    json?.golfer_user?.golfer_user_token ? "golfer_user.golfer_user_token"
    : json?.golfer_user_token ? "golfer_user_token"
    : json?.token ? "token"
    : null;
  const token =
    json?.golfer_user?.golfer_user_token ||
    json?.golfer_user_token ||
    json?.token ||
    null;

  return { res: r, text, json, token, field };
}

async function loginToGhin() {
  const { res, text, token, field } = await loginRequest();

  if (!res.ok) {
    throw new Error(`GHIN login failed: HTTP ${res.status} — ${snippet(text)}`);
  }
  if (!token) {
    throw new Error("GHIN login succeeded but no token in response");
  }
  if (field === "token" && token === "bourbon-cup") {
    // The response echoed our own app-identifier back. Treat that as no
    // token at all rather than authenticating 16 reads with it.
    throw new Error("GHIN login echoed the request token — no session token in response");
  }
  return token;
}

// Trim an upstream error body down to something a toast can carry. GHIN
// answers a bad token with JSON and a proxy in front of it with HTML, and
// both are worth a glance — the first word of either says which.
function snippet(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

// One authenticated read, with the body kept as text so a non-JSON error page
// doesn't throw inside `r.json()` and surface as a generic 500.
async function ghinGet(url, token) {
  const r = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML error page, not JSON */ }
  return { ok: r.ok, status: r.status, text, json };
}

// The index arrives under one of SEVERAL field names depending on endpoint
// version (handicap_index / hi_value / hi_display / display). Only reading
// `handicap_index` once made batch sync report every golfer as "failed" even
// though the data was present, so this is shared by both lookup paths and by
// the search path's normalizeGolfer().
function readHI(g) {
  return g?.handicap_index ?? g?.hi_value ?? g?.hi_display ?? g?.display ?? g?.handicap ?? null;
}

function shapeGolfer(ghinNumber, g, via) {
  return {
    ghin_number: String(ghinNumber),
    handicap_index: readHI(g),
    first_name: g.first_name || g.player_first_name || null,
    last_name: g.last_name || g.player_last_name || null,
    club_name: g.club_name || g.primary_club_name || g.club || null,
    // GHIN returns this under different names in different responses.
    last_revision_date:
      g.revision_date || g.last_revision_date || g.handicap_revision_date || g.hi_date || null,
    low_hi: g.low_hi || g.low_handicap_index || null,
    // Which of the two endpoints answered. Costs nothing and is the first
    // thing worth knowing when one of them moves.
    via,
  };
}

// Look one golfer up by number.
//
// TWO endpoints are tried, in order, because a whole-batch failure has always
// meant one endpoint moved and there was nothing to fall back to:
//
//   1. /golfers/{n}.json   — the direct read. Cheapest, and what has always
//      been used here.
//   2. /golfers/search.json?golfer_id={n} — the SAME endpoint the name search
//      uses, filtered to one golfer. If (1) has moved or started refusing the
//      token, this is the path already proven to work elsewhere in the file.
//
// The second only runs when the first produced nothing, so a healthy sync is
// still one read per golfer. When both fail the returned `error` carries BOTH
// statuses and the upstream body — "16 failed" with no reason is what made
// this untroubleshootable from a phone.
async function fetchGolfer(ghinNumber, token) {
  const n = String(ghinNumber).trim();
  const reasons = [];

  // ── 1. direct read ──
  const direct = await ghinGet(`${GHIN_BASE}/golfers/${encodeURIComponent(n)}.json`, token);
  if (direct.ok) {
    // Either { golfer: {...} }, { golfers: [...] } or just {...}.
    const g = direct.json?.golfer || direct.json?.golfers?.[0] || direct.json;
    if (g && readHI(g) != null) return shapeGolfer(n, g, "golfers/{n}.json");
    reasons.push(
      `golfers/{n}.json: 200 but no handicap field (keys: ${
        direct.json ? Object.keys(direct.json).slice(0, 12).join(",") : "non-JSON body"
      })`
    );
  } else {
    reasons.push(`golfers/{n}.json: HTTP ${direct.status} — ${snippet(direct.text)}`);
  }

  // ── 2. the search endpoint, filtered to this one number ──
  const params = new URLSearchParams({
    golfer_id: n,
    status: "Active",
    from_ghin: "true",
    per_page: "1",
    page: "1",
  });
  const viaSearch = await ghinGet(`${GHIN_BASE}/golfers/search.json?${params.toString()}`, token);
  if (viaSearch.ok) {
    const list = viaSearch.json?.golfers || viaSearch.json?.golfer ||
      (Array.isArray(viaSearch.json) ? viaSearch.json : []);
    const g = Array.isArray(list) ? list[0] : list;
    if (g && readHI(g) != null) return shapeGolfer(n, g, "search.json?golfer_id");
    reasons.push("search.json?golfer_id: 200 but no matching golfer");
  } else {
    reasons.push(`search.json?golfer_id: HTTP ${viaSearch.status} — ${snippet(viaSearch.text)}`);
  }

  return { ghin_number: n, error: reasons.join(" | ") };
}

// Golfer search — the "link" half. Given a name (or a raw GHIN number),
// return candidate golfers so the director/player can pick the right match
// and store the ghin_number. Uses the same login token as batch sync.
//
// NOTE: like the rest of this file these endpoints are unofficial. The
// search path is /api/v1/golfers/search.json. If it ever returns 4xx across
// the board, inspect the live response shape and adjust the param names /
// result mapping below.
// Normalize one raw GHIN golfer record into the client shape.
function normalizeGolfer(g) {
  const ghin_number = String(g.ghin || g.ghin_number || g.id || "").trim();
  if (!ghin_number) return null;
  const name =
    [g.first_name, g.last_name].filter(Boolean).join(" ").trim() ||
    g.player_name || g.full_name || "";
  return {
    ghin_number,
    name,
    first_name: g.first_name || null,
    last_name: g.last_name || null,
    club_name: g.club_name || g.primary_club_name || g.club || null,
    state: g.state || g.club_state || null,
    // Passed through raw (may be "12.3" or "+2.1"); the client parses it.
    handicap_index: readHI(g),
    last_revision_date:
      g.revision_date || g.last_revision_date || g.rev_date || g.hi_date || null,
  };
}

// Search for candidate golfers.
//
// Two distinct code paths, because GHIN treats them very differently:
//
//   • A GHIN NUMBER goes straight to the proven per-golfer endpoint
//     (/golfers/{n}.json — the same one batch sync uses). This is the
//     reliable path and always works given a valid token.
//
//   • A NAME goes to /golfers/search.json, which REQUIRES one of:
//         last_name + state,  last_name + country,
//         association_id,  or  club_id
//     (a bare name returns HTTP 400). We always send last_name + a country
//     default so the minimum combo is satisfied, and pass through an
//     optional state when the caller provides one for tighter matching.
//
//   `state` is an optional 2-letter code from the caller (?state=).
async function searchGolfers(queryStr, token, state) {
  const q = String(queryStr).trim();
  const byNumber = /^\d{6,8}$/.test(q);

  // ── GHIN number → proven single-golfer lookup ──
  if (byNumber) {
    const g = await fetchGolfer(q, token);
    if (g.error || g.handicap_index == null) return [];
    return [normalizeGolfer({
      ghin: g.ghin_number,
      first_name: g.first_name,
      last_name: g.last_name,
      club_name: g.club_name,
      handicap_index: g.handicap_index,
      revision_date: g.last_revision_date,
    })].filter(Boolean);
  }

  // ── Name → search.json (needs last_name + state|country) ──
  const parts = q.split(/\s+/);
  const last_name = parts.length > 1 ? parts[parts.length - 1] : q;
  const first_name = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";

  const params = new URLSearchParams({
    status: "Active",
    from_ghin: "true",
    per_page: "25",
    page: "1",
    sorting_criteria: "full_name",
    order: "asc",
    country: process.env.GHIN_COUNTRY || "USA", // satisfies "last_name + country"
    last_name,
  });
  if (first_name) params.set("first_name", first_name);
  if (state && String(state).trim()) params.set("state", String(state).trim().toUpperCase());

  const r = await fetch(`${GHIN_BASE}/golfers/search.json?${params.toString()}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`GHIN search failed: HTTP ${r.status} — ${body.slice(0, 200)}`);
  }

  const data = await r.json();
  const list = data?.golfers || data?.golfer || (Array.isArray(data) ? data : []);
  return list.map(normalizeGolfer).filter(Boolean);
}

// ── ?diagnose=1 ─────────────────────────────────────────────────────
// A batch sync that answers "16 failed" leaves nobody anything to act on:
// the reason was computed upstream and thrown away, and the credentials that
// would let you reproduce it by hand only exist inside this function. So this
// probe reproduces the two hops and reports what each one actually said.
//
// Open it in any browser — it needs a Vercel deploy but no app build, which
// matters because the phone that hit the failure is running a bundle inside
// a binary and cannot be patched today.
//
//   /api/ghin?diagnose=1              login only
//   /api/ghin?diagnose=1&ghin=1234567 login + one golfer read, both endpoints
//
// NOTHING here returns a credential. The env vars are reported as booleans,
// the token as its length and the field it came out of, and an upstream body
// is echoed only when that response was an ERROR — which is a page saying
// "unauthorized", never golfer data. A successful response is reported by its
// KEY NAMES, which is what identifies a shape change without printing PII.
async function diagnose(ghinNumber) {
  const out = {
    checked_at: new Date().toISOString(),
    env: {
      GHIN_EMAIL: process.env.GHIN_EMAIL ? "set" : "MISSING",
      GHIN_PASSWORD: process.env.GHIN_PASSWORD ? "set" : "MISSING",
      GHIN_COUNTRY: process.env.GHIN_COUNTRY || "(unset — defaults to USA)",
    },
  };

  let token = null;
  try {
    const { res, text, json, token: t, field } = await loginRequest();
    token = t;
    out.login = {
      status: res.status,
      ok: res.ok,
      token_found: !!t,
      token_field: field,
      token_length: t ? String(t).length : 0,
      // A token that is our own "bourbon-cup" string echoed back authenticates
      // nothing, and looks exactly like a healthy login from the outside.
      token_is_echo: t === "bourbon-cup",
      response_keys: json ? Object.keys(json) : null,
      golfer_user_keys: json?.golfer_user ? Object.keys(json.golfer_user) : null,
      body: res.ok ? undefined : snippet(text),
    };
  } catch (e) {
    out.login = { error: e.message || String(e) };
  }

  if (!token) {
    out.verdict = "Login produced no usable token — every golfer read would fail. " +
      "Check GHIN_EMAIL / GHIN_PASSWORD in Vercel, then the login response keys above.";
    return out;
  }

  const n = String(ghinNumber || "").trim();
  if (!n) {
    out.verdict = "Login is healthy. Re-run with &ghin=<a linked number> to test a golfer read.";
    return out;
  }

  const direct = await ghinGet(`${GHIN_BASE}/golfers/${encodeURIComponent(n)}.json`, token);
  out.golfer_direct = {
    endpoint: "golfers/{n}.json",
    status: direct.status,
    ok: direct.ok,
    response_keys: direct.json ? Object.keys(direct.json).slice(0, 20) : null,
    handicap_field_found:
      readHI(direct.json?.golfer || direct.json?.golfers?.[0] || direct.json) != null,
    body: direct.ok ? undefined : snippet(direct.text),
  };

  const params = new URLSearchParams({
    golfer_id: n, status: "Active", from_ghin: "true", per_page: "1", page: "1",
  });
  const viaSearch = await ghinGet(`${GHIN_BASE}/golfers/search.json?${params.toString()}`, token);
  const list = viaSearch.json?.golfers || viaSearch.json?.golfer ||
    (Array.isArray(viaSearch.json) ? viaSearch.json : []);
  out.golfer_search = {
    endpoint: "search.json?golfer_id",
    status: viaSearch.status,
    ok: viaSearch.ok,
    count: Array.isArray(list) ? list.length : (list ? 1 : 0),
    response_keys: viaSearch.json ? Object.keys(viaSearch.json).slice(0, 20) : null,
    handicap_field_found: readHI(Array.isArray(list) ? list[0] : list) != null,
    body: viaSearch.ok ? undefined : snippet(viaSearch.text),
  };

  const ok = out.golfer_direct.handicap_field_found || out.golfer_search.handicap_field_found;
  out.verdict = ok
    ? "At least one golfer endpoint returns a handicap — batch sync should work for this number."
    : "Login works but NEITHER golfer endpoint returned a handicap. Compare response_keys above " +
      "against what readHI() looks for; if the keys are unfamiliar, the endpoint shape moved.";
  return out;
}

export default async function handler(req, res) {
  // Allow same-origin from claude's app — Vercel auto-handles this for the
  // app's own deployment, but explicit is safer.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET: golfer search (link step) ──
  if (req.method === "GET") {
    // ?diagnose=1 — why did a sync fail? See diagnose() above.
    if (req.query?.diagnose != null) {
      try {
        return res.status(200).json(await diagnose(req.query?.ghin));
      } catch (err) {
        console.error("[/api/ghin] diagnose error:", err);
        return res.status(500).json({ error: err.message || "Unknown error" });
      }
    }

    const search = req.query?.search;
    if (!search || !String(search).trim()) {
      return res.status(400).json({ error: "Provide a ?search= name or GHIN number" });
    }
    try {
      const token = await loginToGhin();
      const results = await searchGolfers(search, token, req.query?.state);
      return res.status(200).json({ results });
    } catch (err) {
      console.error("[/api/ghin] search error:", err);
      return res.status(500).json({ error: err.message || "Unknown error" });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Vercel parses JSON bodies automatically when content-type is set, but
  // fall back to manual parse if needed.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const ghinNumbers = Array.isArray(body?.ghin_numbers) ? body.ghin_numbers : null;
  if (!ghinNumbers || ghinNumbers.length === 0) {
    return res.status(400).json({ error: "Provide a non-empty ghin_numbers array" });
  }

  // Sanity cap — this is a 16-player tournament. Anything past 50 is a bug
  // or a misuse, and we want to fail fast rather than DoS the GHIN endpoint.
  if (ghinNumbers.length > 50) {
    return res.status(400).json({ error: "Too many ghin_numbers (max 50)" });
  }

  try {
    const token = await loginToGhin();
    const results = await Promise.all(
      ghinNumbers.map(n => fetchGolfer(String(n).trim(), token))
    );
    return res.status(200).json({ results });
  } catch (err) {
    console.error("[/api/ghin] error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
