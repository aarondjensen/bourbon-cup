// ══════════════════════════════════════════════════════════════════
//  apple-key-check — is this the key that can revoke a sign-in?
// ══════════════════════════════════════════════════════════════════
//
// A .p8 says nothing about itself. It is a bare EC private key with no
// metadata — nothing in the file names the services it was issued for, so
// "is this the Sign in with Apple key or the APNs one" cannot be answered by
// looking at it, and both are called AuthKey_<something>.p8 in the same
// folder. Getting it wrong is not loud, either: the wrong key reaches Apple
// and comes back `invalid_client`, which reads exactly like a malformed key.
//
// So this asks Apple. Same shape as /api/ghin?diagnose=1 — a probe that
// reports what the hop actually answered instead of leaving somebody to infer
// it from a failure three layers up.
//
// ── The trick, and why it needs no authorization code ──
// Revocation normally starts from a single-use code that only exists for five
// minutes after a real sign-in, which is useless for a setup check. But Apple
// validates the CLIENT CREDENTIALS before it looks at the grant, so a request
// carrying a good client secret and a deliberately bogus refresh token comes
// back with a different error from one carrying a bad client secret:
//
//   invalid_client → the key, the key id, the team id or the client id is
//                    wrong, or the key has no Sign in with Apple on it
//   invalid_grant  → the credentials are GOOD and only the token was junk,
//                    which is exactly what we sent. This is the pass.
//
// That means it checks the whole triple, not just the file — which matters,
// because APPLE_CLIENT_ID being the App ID rather than the Services ID fails
// the same way and is the easier mistake to make.
//
// Zero dependencies: the ES256 JWT is signed with node's own crypto, so this
// runs on a machine that has never npm-installed anything.
//
//   node scripts/apple-key-check.mjs C:\dev\keys\AuthKey_9K7J7J2VGT.p8
//
// Reads the ids from functions/.env.the-bourbon-cup unless overridden:
//   --key-id, --team-id, --client-id
//
// `--client-id` is worth using twice: once with the Services ID (the web
// flow) and once with com.thebourboncup.app (the native sheet). A key can be
// valid for one and not the other, and the app sends whichever matches the
// code it holds.
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(HERE, "..", "functions", ".env.the-bourbon-cup");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

// The .env file, parsed the same way the Firebase CLI parses it: KEY=value,
// blank lines and # comments dropped.
const readEnv = () => {
  const out = {};
  const seen = new Set();
  try {
    for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      // A key assigned twice is silent, and the LAST one wins — so a stray
      // leftover blank below a filled-in line quietly empties it, and the
      // function then throws failed-precondition for a value that is sitting
      // right there in the file. Say so rather than inheriting the bug.
      if (seen.has(m[1])) console.warn(`  ! ${m[1]} is assigned more than once in ${ENV_FILE}; the last one wins.`);
      seen.add(m[1]);
      out[m[1]] = m[2].trim();
    }
  } catch { /* no file is fine; everything can come from flags */ }
  return out;
};

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ES256, signed with node's crypto rather than a library. The one thing that
// is easy to get wrong: JWS wants the signature as raw r||s (64 bytes), and
// node's default for an EC key is DER. `ieee-p1363` is the raw encoding.
const signES256 = ({ privateKey, keyId, teamId, clientId }) => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: teamId, iat: now, exp: now + 300,
    aud: "https://appleid.apple.com", sub: clientId,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign("SHA256")
    .update(signingInput)
    .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(sig)}`;
};

const main = async () => {
  const env = readEnv();
  const keyPath = process.argv.find(a => a.endsWith(".p8"));
  const keyId = arg("key-id") || env.APPLE_KEY_ID;
  const teamId = arg("team-id") || env.APPLE_TEAM_ID;
  const clientId = arg("client-id") || env.APPLE_CLIENT_ID || env.APPLE_BUNDLE_ID;

  const missing = [
    !keyPath && "a path to the .p8 (pass it as the first argument)",
    !keyId && "APPLE_KEY_ID (or --key-id)",
    !teamId && "APPLE_TEAM_ID (or --team-id)",
    !clientId && "APPLE_CLIENT_ID or APPLE_BUNDLE_ID (or --client-id)",
  ].filter(Boolean);
  if (missing.length) {
    console.error("Missing:\n  " + missing.join("\n  "));
    console.error(`\nRead from ${ENV_FILE}`);
    process.exit(2);
  }

  let privateKey;
  try { privateKey = readFileSync(keyPath, "utf8"); }
  catch (e) { console.error(`Could not read ${keyPath}\n  ${e.message}`); process.exit(2); }

  // The key id in the filename is what Apple names the file, and it is the
  // value that has to go in the JWT header. Saying so when they disagree
  // catches the copy-paste that would otherwise fail as invalid_client.
  const inName = /AuthKey_([A-Z0-9]{10})\.p8$/i.exec(keyPath.replace(/\\/g, "/").split("/").pop() || "");
  if (inName && inName[1].toUpperCase() !== String(keyId).toUpperCase()) {
    console.warn(`  ! The filename says key id ${inName[1]}, but ${keyId} is configured.`);
    console.warn("    Apple names the file AuthKey_<KEY_ID>.p8, so one of the two is wrong.\n");
  }

  console.log(`  key file  ${keyPath}`);
  console.log(`  key id    ${keyId}`);
  console.log(`  team id   ${teamId}`);
  console.log(`  client id ${clientId}`);
  console.log("");

  let clientSecret;
  try { clientSecret = signES256({ privateKey, keyId, teamId, clientId }); }
  catch (e) {
    console.error(`FAIL — that file is not a usable ES256 private key.\n  ${e.message}`);
    console.error("  A Sign in with Apple key is a PEM starting -----BEGIN PRIVATE KEY-----.");
    process.exit(1);
  }

  const resp = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      // Deliberately junk. See the note at the top: we are reading which
      // error comes back, not trying to refresh anything.
      refresh_token: "probe-not-a-real-token",
    }).toString(),
  });
  const raw = await resp.text();
  let body = {};
  try { body = JSON.parse(raw); } catch { /* not JSON — handled below */ }
  const err = body?.error || "";

  // Not Apple at all. A corporate proxy, a container egress allowlist or a
  // captive network answers here too, and its refusal looks enough like a
  // credential refusal to send somebody rewriting a key that was fine. Apple
  // always answers this endpoint with JSON.
  if (!raw.trim().startsWith("{")) {
    console.log(`CANNOT TELL — something between here and Apple answered ${resp.status}.`);
    const deny = resp.headers.get("x-deny-reason");
    if (deny) console.log(`  Proxy said: ${deny}`);
    console.log(`  ${raw.slice(0, 200).trim()}`);
    console.log("");
    console.log("  This is a network answer, not Apple's — Apple replies in JSON. Run it");
    console.log("  from a machine that can reach appleid.apple.com directly.");
    process.exit(1);
  }

  if (err === "invalid_grant") {
    console.log("PASS — Apple accepted these credentials.");
    console.log("  It rejected only the throwaway token, which is the point of the probe.");
    console.log("  This key, key id, team id and client id work together, so revocation");
    console.log("  will run once the function is deployed.");
    process.exit(0);
  }

  if (err === "invalid_client") {
    console.log("FAIL — Apple refused the credentials themselves (invalid_client).");
    console.log("  Any one of these does it, and Apple does not say which:");
    console.log(`    • the key ${keyId} has no "Sign in with Apple" service ticked on it`);
    console.log("      (an APNs key is a different key and fails exactly here)");
    console.log(`    • ${clientId} is not an identifier this key is allowed to sign for`);
    console.log("      — the Services ID is for the web flow, the bundle id for the native");
    console.log("      sheet, and the App ID is neither");
    console.log(`    • the team id ${teamId} is not the team that issued the key`);
    console.log("    • the .p8 is not the file that goes with that key id");
    process.exit(1);
  }

  console.log(`INCONCLUSIVE — Apple answered ${resp.status} ${err || "(no error field)"}`);
  console.log(`  ${JSON.stringify(body).slice(0, 300)}`);
  console.log("  Neither invalid_grant nor invalid_client, so this probe cannot say.");
  process.exit(1);
};

main().catch(e => { console.error(e?.message || e); process.exit(1); });
