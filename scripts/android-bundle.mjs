// ══════════════════════════════════════════════════════════════════
//  android-bundle — the release AAB, from any shell.
// ══════════════════════════════════════════════════════════════════
//
//   npm run android:bundle
//
// Wraps three commands that are individually simple and collectively a trap
// for anybody not in bash:
//
//   npm run build && npx cap sync android && cd android && ./gradlew bundleRelease
//
// `&&` is not a statement separator in Windows PowerShell 5.1, and `./gradlew`
// is a shell script that Windows cannot run — it wants `gradlew.bat`. This
// repo has a Windows developer and the docs kept being written in bash, twice
// producing a paste that failed on the first character. An npm script sidesteps
// the whole question: node spawns the right wrapper for the platform and the
// shell never gets a say.
//
// It also front-loads the check that Gradle only whispers. A release build with
// no signing configured SUCCEEDS and emits an unsigned bundle; the warning
// scrolls past in a hundred lines of Gradle output, and Play is where you find
// out. This refuses before building instead.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ANDROID = join(ROOT, "android");
const isWindows = process.platform === "win32";

const die = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

const run = (cmd, args, opts = {}) => {
  console.log(`\n  › ${cmd} ${args.join(" ")}`);
  // shell:true on Windows so `npm`/`npx` resolve through their .cmd shims,
  // which node will not find otherwise.
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: isWindows, ...opts });
  if (r.status !== 0) die(`\`${cmd} ${args.join(" ")}\` exited ${r.status ?? "abnormally"}.`);
};

if (!existsSync(ANDROID)) die("there is no android/ directory. Run `npx cap add android` first.");

// ── Is this going to come out signed? ───────────────────────────────
// Either keystore.properties has all four values or the environment does.
// Checked here rather than trusted to Gradle's warning, because an unsigned
// AAB is indistinguishable from a signed one until Play rejects it.
const ENV_KEYS = ["BC_KEYSTORE_FILE", "BC_KEYSTORE_PASSWORD", "BC_KEY_ALIAS", "BC_KEY_PASSWORD"];
const fromEnv = ENV_KEYS.every((k) => (process.env[k] || "").trim());

const propsPath = join(ANDROID, "keystore.properties");
let fromFile = false;
let keystoreMissing = null;
if (existsSync(propsPath)) {
  const props = Object.fromEntries(
    readFileSync(propsPath, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
  fromFile = ["storeFile", "storePassword", "keyAlias", "keyPassword"].every((k) => props[k]);
  // A relative storeFile resolves against android/, matching build.gradle.
  if (fromFile) {
    const p = join(ANDROID, props.storeFile);
    if (!existsSync(p) && !existsSync(props.storeFile)) keystoreMissing = props.storeFile;
  }
}

if (!fromEnv && !fromFile) {
  die("no release signing configured, so this would build an UNSIGNED bundle that Play refuses.\n"
    + "  Create a keystore and fill in android/keystore.properties:\n\n"
    + "      keytool -genkey -v -keystore android/bourbon-cup.keystore \\\n"
    + "        -alias bourbon-cup -keyalg RSA -keysize 2048 -validity 10000\n\n"
    + "  Then copy android/keystore.properties.example to android/keystore.properties\n"
    + `  and fill it in — or set ${ENV_KEYS.join(", ")}.`);
}
if (keystoreMissing) {
  die(`keystore.properties names \`${keystoreMissing}\`, and there is no file there.\n`
    + "  The path is resolved relative to android/. A key sitting beside\n"
    + "  keystore.properties is just its filename.");
}

console.log(`\n  Signing: ${fromEnv ? "environment variables" : "android/keystore.properties"}`);

run("npm", ["run", "build"]);
run("npx", ["cap", "sync", "android"]);
// `gradlew.bat` on Windows, `./gradlew` everywhere else — the actual thing the
// shell difference was about.
run(isWindows ? "gradlew.bat" : "./gradlew", ["bundleRelease"], { cwd: ANDROID });

const aab = join(ANDROID, "app", "build", "outputs", "bundle", "release", "app-release.aab");
if (!existsSync(aab)) {
  die("Gradle finished but there is no bundle at\n"
    + `  ${aab}\n`
    + "  Check the output above for what it built instead.");
}
const mb = (readFileSync(aab).length / 1024 / 1024).toFixed(1);
console.log(`\n  ✓ ${aab}`);
console.log(`    ${mb} MB, signed. Upload it to Play → Testing → Internal testing.\n`);
console.log("    Remember: versionCode in android/app/build.gradle must go up");
console.log("    before the NEXT upload. Play refuses a re-used one.\n");
