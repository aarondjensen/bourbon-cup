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

async function loginToGhin() {
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

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`GHIN login failed: HTTP ${r.status} — ${body.slice(0, 200)}`);
  }

  const data = await r.json();
  // The token field is sometimes nested under golfer_user, sometimes returned
  // as a top-level golfer_user_token. Handle both shapes.
  const token =
    data?.golfer_user?.golfer_user_token ||
    data?.golfer_user_token ||
    data?.token;

  if (!token) {
    throw new Error("GHIN login succeeded but no token in response");
  }
  return token;
}

async function fetchGolfer(ghinNumber, token) {
  const r = await fetch(
    `${GHIN_BASE}/golfers/${encodeURIComponent(ghinNumber)}.json`,
    {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    }
  );

  if (!r.ok) {
    return { ghin_number: String(ghinNumber), error: `HTTP ${r.status}` };
  }

  const data = await r.json();
  // The response can be either { golfer: {...} } or just {...}, depending on
  // which version of the endpoint we hit. Normalize.
  const g = data?.golfer || data?.golfers?.[0] || data;

  if (!g || g.handicap_index == null) {
    return { ghin_number: String(ghinNumber), error: "No handicap data in response" };
  }

  return {
    ghin_number: String(ghinNumber),
    handicap_index: g.handicap_index,
    first_name: g.first_name || null,
    last_name: g.last_name || null,
    club_name: g.club_name || null,
    // GHIN returns this under different names in different responses.
    last_revision_date:
      g.revision_date || g.last_revision_date || g.handicap_revision_date || null,
    low_hi: g.low_hi || g.low_handicap_index || null,
  };
}

// Golfer search — the "link" half. Given a name (or a raw GHIN number),
// return candidate golfers so the director/player can pick the right match
// and store the ghin_number. Uses the same login token as batch sync.
//
// NOTE: like the rest of this file these endpoints are unofficial. The
// search path is /api/v1/golfers/search.json. If it ever returns 4xx across
// the board, inspect the live response shape and adjust the param names /
// result mapping below.
async function searchGolfers(queryStr, token) {
  const q = String(queryStr).trim();
  const byNumber = /^\d{6,8}$/.test(q);

  const params = new URLSearchParams({
    status: "Active",
    from_ghin: "true",
    per_page: "25",
    page: "1",
    sorting_criteria: "full_name",
    order: "asc",
  });

  if (byNumber) {
    params.set("golfer_id", q);
  } else {
    // Some GHIN deployments want first_name/last_name split; others accept
    // a combined player_name. Send both so whichever it honors, we get a hit.
    const parts = q.split(/\s+/);
    if (parts.length > 1) {
      params.set("first_name", parts.slice(0, -1).join(" "));
      params.set("last_name", parts[parts.length - 1]);
    } else {
      params.set("last_name", q);
    }
    params.set("player_name", q);
  }

  const r = await fetch(`${GHIN_BASE}/golfers/search.json?${params.toString()}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`GHIN search failed: HTTP ${r.status} — ${body.slice(0, 200)}`);
  }

  const data = await r.json();
  const list = data?.golfers || data?.golfer || (Array.isArray(data) ? data : []);

  return list
    .map(g => {
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
        handicap_index: g.handicap_index ?? g.hi_value ?? g.hi_display ?? g.display ?? null,
        last_revision_date:
          g.revision_date || g.last_revision_date || g.rev_date || g.hi_date || null,
      };
    })
    .filter(Boolean);
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
    const search = req.query?.search;
    if (!search || !String(search).trim()) {
      return res.status(400).json({ error: "Provide a ?search= name or GHIN number" });
    }
    try {
      const token = await loginToGhin();
      const results = await searchGolfers(search, token);
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
