// ══════════════════════════════════════════════════════════════════
//  ctp — reading a pin's standing tag against the order of play.
// ══════════════════════════════════════════════════════════════════
//
// Closest to the pin is tournament-wide: one winner per par 3 per round, held
// by whichever group has tagged the closest ball SO FAR. The comparison is on
// feet, not on who typed first, so the winner survives groups entering their
// scores out of order — a group that walks in half an hour late with a
// shorter ball still takes the pin.
//
// What does NOT survive is the group's understanding of what they are looking
// at. A group rushing to the next tee puts a par 3 in fifteen minutes later,
// by which time the group BEHIND them has finished the same hole and tagged
// it. The prompt then shows them a "current CTP" that did not exist when they
// were on the green, from players who were still walking up as they left.
//
// Two things go wrong when nobody says so:
//
//   • They read the number as the group AHEAD of them, and take it as the
//     mark to beat rather than as a hole that is still being played out.
//   • A tie goes to whoever wrote first, which here is the group that played
//     LAST. The prompt says the earlier tag holds and means earlier by the
//     clock on the phone, which is not the order the shots were hit in.
//
// So the tag carries the group that made it, and this is where that gets
// compared to the group being asked. Tee order — a group's index in the
// round's draw (src/lib/groups.js) — is the only ordering the app has that
// matches the order the holes were actually played in, and it is the one the
// whole app already counts groups by (`Group ${index + 1}`).
//
// Ported from WBC's lib/ctp.js so the two apps read a pin the same way.

// A playing group's identity, independent of the order its players were
// listed in. Two devices scoring the same foursome must produce the same
// string, or a group would warn itself about its own tag.
export const groupKey = (pids) =>
  (pids || []).filter(Boolean).slice().sort().join("|") || null;

// What the whole app calls a group. Spelled once here so the CTP prompt says
// the same "Group 3" the tee sheet and the pairings editor do.
export const groupLabel = (order) => (order == null ? "another group" : `Group ${order + 1}`);

// Was the standing tag made by a group that plays BEHIND the one being asked?
//
// Returns null when there is nothing to say, and that covers more cases than
// the plain "no, they were ahead":
//
//   • no tag yet, or a tag with no group on it (a director's pick from the
//     Betting tab, or a document written before tags carried their group)
//   • either group missing from the draw, so there is no order to compare
//   • the same group — one device scoring its own hole twice
//
// An UNKNOWN order says nothing rather than guessing, because the warning is
// only worth showing when it is certainly true. A group wrongly told the
// field is out of order will stop trusting the prompt.
export function tagAheadOfPlay({ leaderOrder, leaderKey, myOrder, myKey }) {
  if (leaderOrder == null || myOrder == null) return null;
  if (leaderKey && myKey && leaderKey === myKey) return null;
  if (leaderOrder <= myOrder) return null;
  return { leaderOrder, label: groupLabel(leaderOrder) };
}

// ══════════════════════════════════════════════════════════════════
//  The pin document: one CLAIM per group, not one winner per pin.
// ══════════════════════════════════════════════════════════════════
//
// A pin used to be stored as the ANSWER — player, feet, who typed it — and
// every group that answered the prompt overwrote the whole thing. That is
// last-write-wins on a document four phones write to, and it loses in three
// separate ways:
//
//   • TWO GROUPS TAGGING AT ONCE. Both compare against the tag their own
//     phone currently holds, both pass their own check, and the second write
//     lands on top. A nine-footer overwrites a five-footer and the closest
//     ball loses the pin, which is the one thing this game is.
//   • TWO GROUPS CONFIRMING AT ONCE. `confirmed_by` was read out of the live
//     map, appended to and written back WHOLE, so a confirmation that had not
//     yet arrived on this phone was erased by the one that had.
//   • A TIE. Resolved by write order, which on a course is the order the
//     groups got signal in — not the order they played the hole. The prompt
//     said "the earlier tag holds" and meant earlier by the clock.
//
// So nobody writes the answer any more. Each group writes ITS OWN claim,
// under its own group key, and the answer is derived by reading them all.
// Firestore merges a map field key by key — `db.upsert` is `setDoc(…, { merge:
// true })` — so two groups writing at the same moment write to two different
// keys and neither can erase the other. There is no transaction and no
// read-before-write, which matters more here than the elegance does: this is a
// phone in a hollow with one bar, and a transaction would FAIL offline where a
// merge quietly queues.
//
// A claim is what one group said when it was asked:
//
//   { kind: "tag",     player_id, distance_ft, order, by, by_name, at }
//   { kind: "confirm", order, by, by_name, at }   the standing tag is right
//   { kind: "pass",    order, by, by_name, at }   none of us was close
//
// `order` is the claiming group's tee order, carried ON the claim rather than
// looked up later, because the draw can be edited after the round is played
// and the pin belongs to the order it was actually played in.
//
// ── What this buys beyond the races ──
// A PASS IS NOW WRITTEN DOWN. It used to be the one answer that recorded
// nothing on an untagged hole, so a hole every group played and nobody got
// close to was indistinguishable from a hole the prompt never reached.

// The kinds of answer a group can give. Anything else in a stored claim is
// ignored rather than guessed at.
const KINDS = new Set(["tag", "confirm", "pass", "override"]);

// A stored claims map, normalised. Rubbish keys and rubbish values are
// dropped: this is read straight off Firestore, and a half-written document
// must not take a screen down.
//
// Both spellings are accepted on the way in. The app writes snake_case like
// every other field in this project; the camelCase arm is what lets a claim
// written by a future port from WBC read here without a migration.
export function readClaims(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  Object.keys(src).forEach(key => {
    const c = src[key];
    if (!c || typeof c !== "object") return;
    if (!KINDS.has(c.kind)) return;
    out[key] = {
      kind: c.kind,
      playerId: c.player_id || c.playerId || null,
      distanceFt: Number.isFinite(c.distance_ft) ? c.distance_ft
        : Number.isFinite(c.distanceFt) ? c.distanceFt : null,
      order: Number.isInteger(c.order) ? c.order : null,
      by: c.by || null,
      byName: c.by_name || c.byName || "",
      at: c.at || "",
    };
  });
  return out;
}

// The key a director's override is filed under. It is not a group — it is the
// one answer that is not a group's — and it beats every claim under it, which
// is the whole point of a correction.
export const OVERRIDE_KEY = "director";

// ── Which claim holds the pin ──────────────────────────────────────
// Closest ball wins. A tie goes to the group that PLAYED IT FIRST, which is
// the lower tee order — not the lower clock, which is what write order was
// standing in for and is exactly backwards for a group that walked off to
// make its tee time. A claim with no tee order cannot win a tie, for the same
// reason tagAheadOfPlay stays quiet on an unknown order: guessing which of
// two groups played first is how the wrong man gets paid.
//
// The last tiebreak is the group key, alphabetically. It settles nothing real
// — two groups, same distance, neither in the draw — but it has to be STABLE,
// because four phones deriving the winner independently have to derive the
// same one.
export function winningClaim(claims) {
  // Normalised on the way in rather than trusted. readClaims accepts either
  // spelling and is idempotent, so this is free for the app's own call (which
  // has already been through it) and stops a caller that hands over a RAW
  // Firestore map from being told, quite silently, that nobody holds the pin.
  const cs = readClaims(claims);
  if (cs[OVERRIDE_KEY]?.playerId) return { key: OVERRIDE_KEY, ...cs[OVERRIDE_KEY] };
  const tags = Object.keys(cs)
    .filter(k => k !== OVERRIDE_KEY && cs[k].kind === "tag" && cs[k].playerId)
    .map(k => ({ key: k, ...cs[k] }));
  if (tags.length === 0) return null;
  tags.sort((a, b) => {
    // A tag with no distance is a claim nobody measured; it loses to any
    // measured one rather than sorting as zero feet.
    const af = a.distanceFt == null ? Infinity : a.distanceFt;
    const bf = b.distanceFt == null ? Infinity : b.distanceFt;
    if (af !== bf) return af - bf;
    const ao = a.order == null ? Infinity : a.order;
    const bo = b.order == null ? Infinity : b.order;
    if (ao !== bo) return ao - bo;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return tags[0];
}

// Every group that has answered the prompt for this pin, whatever it said.
// The director's override is not a group and is not counted: it says a pin was
// corrected, not that a group was asked.
export const answeredGroups = (claims) =>
  Object.keys(claims || {}).filter(k => k !== OVERRIDE_KEY);

// ── The pin, as the app reads it ───────────────────────────────────
// Claims are the truth where they exist. `legacy` is the flat winner the
// document used to carry — a pin tagged before this existed, and any pin a
// year's import brought in — and it stands in unchanged when there are no
// claims, so an old edition still shows its pins.
//
// The shape returned is the app's own record, snake_case, exactly as every
// screen already reads it out of `ctpData`. That is deliberate: resolving at
// the subscription boundary means the prompt, the director's grid and
// lib/betting all keep working untouched and simply start getting the RIGHT
// winner. `claims` and `answered_groups` ride along for the two callers that
// want them.
export function resolvePin({ claims, legacy } = {}) {
  const cs = readClaims(claims);
  const answered = answeredGroups(cs);
  const win = winningClaim(cs);
  const lg = legacy || {};

  // A hole is settled when the director has overridden it, and — for a
  // document written before claims existed — when the flat flag says so.
  const approved = lg.approved === true || !!cs[OVERRIDE_KEY]?.playerId;

  // Who has walked off this green, seen the standing tag and let it stand.
  // Legacy ids first so a document part-written under the old shape and part
  // under the new reads as one list.
  const confirmed_by = [...new Set([
    ...(Array.isArray(lg.confirmed_by) ? lg.confirmed_by : []),
    ...Object.keys(cs).filter(k => cs[k].kind === "confirm").map(k => cs[k].by).filter(Boolean),
  ])];

  const base = { approved, confirmed_by, answered_groups: answered, claims: cs };

  if (!win) {
    // No claim holds the pin. The groups that passed still ANSWERED, and that
    // is the difference between "nobody has been asked" and "the field played
    // it and nobody was close" — but answering is not the same as taking it
    // away from somebody.
    //
    // So a legacy winner stands here rather than being cleared. Only a TAG or
    // a director's override can displace one, which is what `win` already
    // means; a pass or a confirm is a group agreeing with what is on the hole,
    // and on a pin tagged before claims existed the thing they are agreeing
    // with IS the flat field. Clearing it on their agreement would delete the
    // winner at the exact moment the field confirmed him — and this project
    // has live pins carrying flat winners today, so that path is reachable
    // rather than theoretical.
    if (!lg.player_id) {
      return { ...base, player_id: null, distance_ft: null, tagged_by: null,
               tagged_group_key: null, tagged_group_order: null };
    }
    return {
      ...base,
      player_id: lg.player_id,
      distance_ft: lg.distance_ft ?? null,
      tagged_by: lg.tagged_by || null,
      tagged_group_key: lg.tagged_group_key || null,
      tagged_group_order: Number.isInteger(lg.tagged_group_order) ? lg.tagged_group_order : null,
    };
  }

  return {
    ...base,
    player_id: win.playerId,
    distance_ft: win.distanceFt,
    tagged_by: win.by,
    // An override is not a group, so it carries no order — and this file's
    // rule is that an unknown order says nothing rather than guessing.
    tagged_group_key: win.key === OVERRIDE_KEY ? null : win.key,
    tagged_group_order: win.key === OVERRIDE_KEY ? null : win.order,
  };
}

// ── Can this group take the pin? ───────────────────────────────────
// Strictly closer always wins. A TIE is claimable only by a group that played
// the hole FIRST, which is the same rule winningClaim settles it by — the two
// have to agree, or the prompt offers a tag the board then refuses to honour.
//
// Undecided is not "beats it": until a distance is chosen there is nothing to
// compare, so the question simply has not been answered.
export function canTakePin({ leaderFt, leaderOrder, myFt, myOrder }) {
  if (myFt == null) return false;
  if (leaderFt == null) return true;
  if (myFt < leaderFt) return true;
  if (myFt > leaderFt) return false;
  // Tied. Only an order we are sure of can break it.
  if (myOrder == null || leaderOrder == null) return false;
  return myOrder < leaderOrder;
}
