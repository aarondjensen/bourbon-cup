import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ══════════════════════════════════════════════════════════════════
//  The iOS project, guarded — because nothing else here can compile it.
// ══════════════════════════════════════════════════════════════════
//
// `ios/` is committed and hand-edited, and every file in it is a plist or a
// pbxproj that no test, type checker or build step in this repo reads. The
// feedback loop on getting one of them wrong runs through a Mac, an archive,
// an upload and sometimes a human reviewer — days, in the worst case, for a
// deleted line.
//
// So this suite reads them as files. It cannot tell you the app compiles;
// nothing on Linux can. It can tell you that the settings somebody worked out
// once are still there, which is the failure mode that actually happens: a
// `cap add ios` regenerating over them, a merge dropping a key, or a future
// session "simplifying" the config in a way that costs a review cycle.
//
// Everything asserted here is explained in docs/app-store.md. If a test fails,
// read the section it names before changing the test.

const read = (p) => readFileSync(p, "utf8");
const json = (p) => JSON.parse(read(p));

// ── A deliberately small plist reader ───────────────────────────────
// Not a plist parser, and not trying to be. These are four files this repo
// writes and controls, and what the tests need is "is this key still here,
// and what element follows it" — which is a regex on our own XML, not a
// reason to take on a dependency. A real parser would also happily accept a
// file with the key nested somewhere useless.
const valueAfter = (xml, key) => {
  const m = xml.match(
    new RegExp(`<key>${key}</key>\\s*(<[^>]+/>|<(string|integer|array|dict|true|false)>[\\s\\S]*?</\\2>)`)
  );
  return m ? m[1].trim() : null;
};
const hasKey = (xml, key) => xml.includes(`<key>${key}</key>`);
const stringValue = (xml, key) => {
  const v = valueAfter(xml, key);
  const m = v && v.match(/^<string>([\s\S]*)<\/string>$/);
  return m ? m[1] : null;
};

const INFO = read("ios/App/App/Info.plist");
const ENTITLEMENTS = read("ios/App/App/App.entitlements");
const PRIVACY = read("ios/App/App/PrivacyInfo.xcprivacy");
const PBXPROJ = read("ios/App/App.xcodeproj/project.pbxproj");
const CAP = json("capacitor.config.json");

describe("capacitor.config.json", () => {
  it("does not point the webview at a remote URL", () => {
    // THE 4.2 TRAP, and the one most likely to be reintroduced — pointing
    // `server.url` at thebourboncup.com makes iterating enormously easier and
    // turns the app into a browser showing a website, which is the exact thing
    // guideline 4.2 rejects. It is also a one-line change somebody makes while
    // debugging and forgets. See docs/app-store.md §1.
    expect(CAP.server?.url).toBeUndefined();
    expect(CAP.webDir).toBe("dist");
  });

  it("leaves the Firebase session to the JS SDK", () => {
    // skipNativeAuth false would sign the NATIVE Firebase SDK in as well, and
    // the session this app runs on — the one Firestore and the security rules
    // read a token from — is the JS SDK's. Two SDKs each holding half a login
    // is the bug that shape invites. docs/app-store.md §2.1.
    expect(CAP.plugins?.FirebaseAuthentication?.skipNativeAuth).toBe(true);
  });

  it("lets iOS draw foreground notification banners", () => {
    // Without these the OS shows nothing while the app is open, and
    // initForegroundNotifications returns early on native precisely because
    // it expects the OS to do it. Remove them and foreground pushes vanish
    // rather than doubling. docs/app-store.md §2.2.
    expect(CAP.plugins?.FirebaseMessaging?.presentationOptions).toContain("alert");
  });

  it("keeps the status bar out of the web view's way", () => {
    // The native restatement of the index.html status-bar finding. With
    // overlaysWebView true the app starts under the bar and the nav can never
    // reach the physical bottom edge. docs/app-store.md §2.4.
    expect(CAP.plugins?.StatusBar?.overlaysWebView).toBe(false);
  });
});

describe("Info.plist", () => {
  // A missing usage string is a CRASH the first time the picker opens, not a
  // warning — and on a submitted build it is the reviewer who finds it.
  it.each([
    ["NSCameraUsageDescription"],
    ["NSPhotoLibraryUsageDescription"],
    ["NSPhotoLibraryAddUsageDescription"],
  ])("has a non-empty %s", (key) => {
    const v = stringValue(INFO, key);
    expect(v, `${key} is missing from Info.plist`).toBeTruthy();
    // Apple rejects placeholder-grade strings; more usefully, a real sentence
    // is what the person tapping Allow actually reads.
    expect(v.length).toBeGreaterThan(20);
  });

  it("declares no non-exempt encryption", () => {
    // The app speaks HTTPS and nothing else. Set, this skips the
    // export-compliance question on every single upload; absent, somebody
    // answers it by hand every time and eventually answers it wrong.
    expect(valueAfter(INFO, "ITSAppUsesNonExemptEncryption")).toBe("<false/>");
  });

  it("hands the status bar to the plugin rather than to a view controller", () => {
    // MUST be false or StatusBar.setStyle silently does nothing, which is
    // exactly the sort of thing that gets "fixed" back to true because true
    // is the Xcode default. docs/app-store.md §2.4.
    expect(valueAfter(INFO, "UIViewControllerBasedStatusBarAppearance")).toBe("<false/>");
  });

  it("is portrait only, with no iPad orientations", () => {
    const orientations = valueAfter(INFO, "UISupportedInterfaceOrientations") || "";
    expect(orientations).toContain("UIInterfaceOrientationPortrait");
    expect(orientations).not.toContain("Landscape");
    expect(hasKey(INFO, "UISupportedInterfaceOrientations~ipad")).toBe(false);
  });

  it("still carries a URL scheme slot for the reversed Google client id", () => {
    // Deliberately asserts the SLOT, not a real value. The placeholder is what
    // is committed — the real id comes out of GoogleService-Info.plist, which
    // is gitignored — and a test that failed on the placeholder would be red
    // on a clean checkout, which is a test everybody learns to ignore.
    //
    // What it catches is the slot being deleted. Without it the Google sheet
    // opens and never comes back. docs/app-store.md §5 step 2.
    expect(hasKey(INFO, "CFBundleURLTypes")).toBe(true);
    expect(INFO).toMatch(/REPLACE_WITH_REVERSED_GOOGLE_CLIENT_ID|com\.googleusercontent\.apps\./);
  });
});

describe("App.entitlements", () => {
  it("requests push", () => {
    // "development" is correct in the repo: Xcode rewrites it to production
    // on archive, and hard-coding production breaks push on every cable build.
    expect(stringValue(ENTITLEMENTS, "aps-environment")).toBe("development");
  });

  it("requests Sign in with Apple", () => {
    // Guideline 4.8 needs the button; the BUILD needs this entitlement, and
    // without it signing fails with a mismatch that says nothing about Apple.
    expect(hasKey(ENTITLEMENTS, "com.apple.developer.applesignin")).toBe(true);
  });
});

describe("PrivacyInfo.xcprivacy", () => {
  it("declares no tracking", () => {
    expect(valueAfter(PRIVACY, "NSPrivacyTracking")).toBe("<false/>");
    expect(valueAfter(PRIVACY, "NSPrivacyTrackingDomains")).toBe("<array/>");
  });

  it("declares every data type the app actually collects", () => {
    // The list that must agree with App Store Connect's App Privacy answers
    // and with docs/store-submission.md §2. Disagreeing with the store form
    // is a policy problem, not a build one, so nothing else would catch it.
    for (const t of [
      "NSPrivacyCollectedDataTypeEmailAddress",
      "NSPrivacyCollectedDataTypeName",
      "NSPrivacyCollectedDataTypeUserID",
      "NSPrivacyCollectedDataTypePhotosorVideos",
      "NSPrivacyCollectedDataTypeDeviceID",
      "NSPrivacyCollectedDataTypeOtherUserContent",
    ]) {
      expect(PRIVACY, `${t} missing from the privacy manifest`).toContain(t);
    }
  });

  it("gives a reason for every required-reason API it touches", () => {
    // Missing one of these is an UPLOAD rejection — before any human sees the
    // build, with an email that names the API and not the file.
    expect(PRIVACY).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
    expect(PRIVACY).toContain("CA92.1");
    expect(PRIVACY).toContain("NSPrivacyAccessedAPICategoryFileTimestamp");
  });

  it("is copied into the bundle rather than sitting in the repo", () => {
    // A privacy manifest that is not in the Resources build phase ships
    // nowhere and fails the upload exactly as if it did not exist.
    expect(PBXPROJ).toContain("PrivacyInfo.xcprivacy in Resources");
  });
});

describe("the Xcode project", () => {
  it("is iPhone only", () => {
    // "1,2" means a reviewer opens it on an iPad, and every layout decision in
    // this app was made for a phone held one-handed on a tee box.
    expect(PBXPROJ).toContain('TARGETED_DEVICE_FAMILY = "1";');
    expect(PBXPROJ).not.toContain('TARGETED_DEVICE_FAMILY = "1,2";');
  });

  it("signs with the entitlements file", () => {
    // Present but unreferenced is the quiet failure: push and Sign in with
    // Apple both stop working and nothing says why.
    const refs = PBXPROJ.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) || [];
    expect(refs.length, "expected the entitlements path on both build configs").toBe(2);
  });
});

describe("the app icon", () => {
  // Read straight out of the PNG header rather than through an image library:
  // IHDR is the first chunk, width and height are big-endian 32-bit at bytes
  // 16 and 20, and byte 25 is the colour type. Type 2 is RGB and type 6 is
  // RGBA — which is the whole question, because Apple rejects the upload for
  // the alpha CHANNEL being present, not for any pixel being transparent.
  const png = readFileSync("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");

  it("is 1024x1024", () => {
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
  });

  it("has no alpha channel", () => {
    const COLOUR_TYPE = { 0: "grayscale", 2: "rgb", 3: "palette", 4: "grayscale+alpha", 6: "rgba" };
    const type = png[25];
    expect(
      [0, 2, 3].includes(type),
      `icon colour type is ${COLOUR_TYPE[type] || type}; App Store uploads are rejected for an alpha channel. Run npm run build:ios-icons`
    ).toBe(true);
  });

  it("is not still Capacitor's placeholder logo", () => {
    // `cap add ios` seeds the catalog with the Capacitor mark, and it looks
    // enough like a real icon in the Xcode navigator to reach TestFlight.
    // The placeholder is a small, mostly-flat PNG; the rendered brand mark is
    // a full-bleed gradient and an order of magnitude larger.
    expect(png.length).toBeGreaterThan(60_000);
  });
});
