// ══════════════════════════════════════════════════════════════════
//  playerActivity — who has actually signed in, and who will get a push.
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC. A director's answer to the two questions that come up the
// week before a tournament and that nothing in this app could answer:
//
//   "has he even signed in yet?"   → the roster row's own auth link
//   "will he get the tee time?"    → whether a push token exists for him
//
// Both are joins, and neither collection is about players:
//
//   bc_players                 carries `auth_uid` / `auth_provider` /
//                              `auth_linked_at` once a man has claimed his
//                              name (see lib/accounts). One row per ENTRY.
//   bc_notification_tokens     one row per (player, device). Its presence is
//                              the only honest answer to "is push on" —
//                              browser permission stays "granted" forever
//                              once given, including for somebody who has
//                              since switched notifications off. See
//                              lib/notifications for why that distinction is
//                              the whole feature.
//
// ── Why it reads nothing new ──
// Every fact here is already on a document the app subscribes to or may read:
// the roster is edition data, and bc_notification_tokens is `allow read: if
// isOpen()`. So this needs no rules change, no new write, and no login stamp
// that a player would have to be granted permission to write about himself.
//
// `last_seen_at` on a token is the closest thing to "last opened the app", and
// it is honest about what it is: it is stamped when the app registers or
// refreshes a token, so it exists for the men who turned push ON and for
// nobody else. A player with no token has no last-seen, and this says so
// rather than showing a blank that reads as "never".
//
// Pure. The component does the subscribing.

// ── toMillis ────────────────────────────────────────────────────────
// The timestamps in these collections were written by three different
// generations of this app: `registered_at`/`last_seen_at` are Date.now()
// numbers, `auth_linked_at` and `joined_at` are ISO strings, and anything
// written from a Cloud Function is a Firestore Timestamp. All three mean the
// same thing and only one of them sorts.
export const toMillis = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === "object") return typeof v.seconds === "number" ? v.seconds * 1000 : null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

// How long ago, in the words somebody reads at a glance. Deliberately coarse:
// the question is "is this man set up", not "when exactly".
export const timeAgo = (ts, now = Date.now()) => {
  const ms = toMillis(ts);
  if (ms == null) return "";
  const secs = Math.round((now - ms) / 1000);
  if (secs < 0) return "just now";
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
};

// ── The devices a man is carrying ───────────────────────────────────
// One row per (player, device), so a man with a phone and an iPad has two.
// The newest last-seen wins for the summary, because the question is whether
// ANY device of his will buzz.
export const devicesByPlayer = (tokens = []) => {
  const out = {};
  (tokens || []).forEach(t => {
    const pid = t?.player_id;
    if (!pid) return;
    (out[pid] ||= []).push({
      platform: t.platform || (t.is_ios ? "ios" : "web"),
      standalone: t.is_standalone === true,
      lastSeen: toMillis(t.last_seen_at) ?? toMillis(t.registered_at),
    });
  });
  Object.keys(out).forEach(pid => {
    out[pid].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  });
  return out;
};

// What the store build a man is carrying is called on screen. `platform` is
// written by platformName(), which is the field that exists precisely so an
// Android phone is not filed as an iPhone — see lib/platform.
export const PLATFORM_LABEL = { ios: "iOS", android: "Android", web: "Web" };
export const platformLabel = (p) => PLATFORM_LABEL[p] || "Web";

// ── One row per man on the roster ───────────────────────────────────
// `signedIn` is the roster row's own auth link, which is what claiming a name
// writes (lib/accounts). It is the honest answer to "has he been through the
// door", and unlike a login stamp it costs nothing and needs no new rule.
export const buildActivity = ({ players = [], tokens = [], now = Date.now() } = {}) => {
  const devices = devicesByPlayer(tokens);
  return (players || []).map(p => {
    const ds = devices[p.player_id] || [];
    const lastSeen = ds.length ? ds[0].lastSeen : null;
    return {
      playerId: p.player_id,
      name: p.name || p.player_id,
      team: p.team ?? null,
      signedIn: !!p.auth_uid,
      provider: p.auth_provider || null,
      email: p.auth_email || null,
      linkedAt: toMillis(p.auth_linked_at),
      // Push is on when a token exists. Nothing else can be trusted: a
      // permission is granted once and never revoked back to the page.
      pushOn: ds.length > 0,
      devices: ds,
      platforms: [...new Set(ds.map(d => d.platform))],
      lastSeen,
      lastSeenLabel: lastSeen == null ? "" : timeAgo(lastSeen, now),
    };
  });
};

// The line a director reads first: how much of the field is actually set up.
export const activitySummary = (rows = []) => ({
  total: rows.length,
  signedIn: rows.filter(r => r.signedIn).length,
  pushOn: rows.filter(r => r.pushOn).length,
  // The two lists worth acting on — these are who to text.
  notSignedIn: rows.filter(r => !r.signedIn).map(r => r.name),
  noPush: rows.filter(r => r.signedIn && !r.pushOn).map(r => r.name),
});
