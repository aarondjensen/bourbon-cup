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
// ── Request shape ──
//   POST /api/ghin
//   Body: { ghin_numbers: ["1234567", "8901234", ...] }
//
// ── Response shape ──
//   200 OK
//   { results: [
//       { ghin_number, handicap_index, first_name, last_name, last_revision_date },
//       { ghin_number, error: "..." },   // per-golfer failure, doesn't kill the batch
//       ...
//     ] }

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

export default async function handler(req, res) {
  // Allow same-origin from claude's app — Vercel auto-handles this for the
  // app's own deployment, but explicit is safer.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
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
