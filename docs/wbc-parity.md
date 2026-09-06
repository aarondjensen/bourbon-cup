# Bourbon Cup / WBC parity audit

Read against `bourbon-cup@3a5c69b` and `WBC@08adb59`, comparing `src/lib`,
`src/components`, `functions/`, `firestore.rules`, the service workers and both
`package.json`. WBC finished a played trip, so its field lessons are banked.

Format-specific divergence is deliberately excluded — WBC's scramble, pairings
and market modules against this repo's matches and teams are two genuinely
different games. What follows is where the SAME problem is solved twice,
differently, and one of the two answers is known to be wrong.

Porting has run both ways before: this repo's `lib/ctp.js` opens "Ported from
WBC", and `wbc/src/lib/scoreGuard.js` opens "Ported from Bourbon Cup."

Ranked by whether a wrong answer is visible.

---

## Tier A — it looks like it worked

Three writes that report success on a phone and leave nothing, or the wrong
thing, on the board. These are the ones CLAUDE.md's "one exception" covers:
anything that can lie to the user.

### A1 — CTP took the warning from WBC and left the rule behind

`src/lib/ctp.js` says it was ported from WBC "so the two apps read a pin the
same way". It is 61 lines; WBC's is ~350. What came across is
`tagAheadOfPlay` — the notice that the standing tag came from a group playing
behind you. What did not is the part that decides who holds the pin.

- **WBC**: one CLAIM PER GROUP, under the group's own key in a map. Firestore
  merges a map key by key, so two groups tagging at the same moment write to
  different keys and neither can erase the other. `winningClaim` derives the
  holder — closest ball wins, ties break on TEE ORDER (who played it first).
  A "pass" is written down too. Guarded by `npm run test:ctp-claims`.
- **Here**: `onSetCtp` (`App.jsx:4653`) writes the whole answer — `player_id`,
  `distance_ft`, `confirmed_by: []` — into one document per pin.

Consequences: two groups tagging at once is last-write-wins, so a nine-footer
overwrites a five-footer and the closest ball loses the pin. Ties go to
whoever's phone found signal first. A pass records nothing, so a hole
everybody played and nobody got close on is indistinguishable from a hole the
prompt never reached.

Both groups saw their own tag confirmed on screen. Nothing disagrees.

> The warning stopped being the whole remedy the moment the rule could be made
> right, and a warning standing in for a rule is what this file used to be.
> — `wbc/src/lib/ctp.js`

### A2 — no phone here can tell you its scores never left it

Firestore's `setDoc` does not fail without signal. It queues, the promise stays
pending, and it lands when a bar comes back. That is what lets a card be scored
through a dead patch, and it means the failure everybody actually hits sails
past every `try/catch` as though it had succeeded.

- **WBC**: `lib/connection.js` counts handed-over-but-unacknowledged writes by
  collection; `useSyncStatus` + `SyncBanner` render it. Silent when healthy —
  `syncStatus()` returns null, so the strip is absent rather than furniture. A
  REFUSED write outranks everything: "2 scores did not save — nobody else has
  them / Check you're signed in."
- **Here**: nothing. No write tracker, no `navigator.onLine` listener, no
  banner anywhere in `src/`. And `db.upsert` swallows a rejection into `null`
  by default (`src/firebase.js:376`); `{ loud: true }` is opt-in and used on
  the money writes only.

A refusal is the sharp end and is not the offline case: Firestore answers no
and rolls the local write BACK, so the score is gone from the phone as well as
absent from the board. That happens on a session that did not survive, a
membership that no longer exists, a locked edition — each of which looks, from
the tee, exactly like scoring normally.

Both repos already configure `persistentLocalCache` with the multi-tab
manager, so the data layer is aligned. Only the reporting is missing. CLAUDE.md
names this hazard three separate times; the remedy was written per-screen with
`loud: true`, where WBC solved it once at the door every write goes through.

### A3 — two phones appending to the same array delete each other

The same read-modify-write shape as A1, twice more, both on arrays several
people in a group write within a minute of each other:

- `onConfirmCtp` (`App.jsx:4678`) reads `confirmed_by` out of
  `ctpDataRef.current` and writes the whole array back.
- `onAttestCard` (`App.jsx:4975`) does the same with `attested_by`.

The ref is genuinely fresher than closure state and the comment is right that
it fixes staleness WITHIN one device. It cannot fix two. Two phones holding the
same snapshot each compute `[...seen, me]` and the second write lands on top —
one attestation silently dropped, on a card that then sits one short forever
while the man who tapped Attest watched it register.

The source currently asserts a property it does not have:

> Additive and idempotent, so two phones in the same group confirming at once
> converge instead of racing. — `App.jsx:4670`

WBC's per-key map merge is the fix for this whole class, not just for pins.

---

## Tier B — holds up on wifi, not on a course

### B1 — the service worker caches nothing, and most phones never register it

- **WBC**: `lib/swRegister.js` registers for EVERYONE, with dev, native and
  insecure contexts excluded by a tested pure function.
  `public/sw-cache-rules.js` is `importScripts`'d into the same worker — one
  scope, one file — giving runtime caching of the shell and hashed assets,
  capped at 60 entries.
- **Here**: `public/firebase-messaging-sw.js` has push handlers, `skipWaiting`
  and `clients.claim` — no fetch handler, no cache. It is registered in exactly
  one place, `lib/notifications.js:250`, inside the turn-on-notifications path.
  A player who never enabled notifications has no worker at all.

Firestore's persistent cache means a relaunch out of range still has the
leaderboard's NUMBERS. The CODE has no such thing, and an installed PWA on a
course cold-starts constantly — the screen locks, iOS evicts the tab, somebody
opens the camera and comes back. Opening in a car park on one bar re-fetches
the bundle and hangs.

### B2 — a man can withdraw in WBC; here there is no way to say so

- **WBC**: `WD_SENTINEL = 99`; `markPlayerWD` (`App.jsx:2400`) fills the
  unplayed holes so the card stays structurally complete, and `scoreGuard`,
  `handicap.js`, `individualBoard` and `historyImport` all exclude the
  sentinel.
- **Here**: no withdrawal anywhere in `src/`. Both `FinalizeRound.jsx:62` and
  `AdminView.jsx:1616` already talk about "a withdrawal ... leaves holes that
  will never be" filled.

So the CONSEQUENCE of a withdrawal is handled while the event itself has no
representation. A man who walks in after nine leaves a permanently incomplete
card the finalize path has to be talked past every time.

### B3 — scoring is open on every round, all week

- **WBC**: `lib/scoringGate.js` — a director always; a round a director has
  force-opened always; otherwise the round's date must be today AND the group's
  tee time within 30 minutes. Every ambiguous case fails closed and is one tap
  to open from Admin.
- **Here**: gated on `roundLocks` / `currentRoundNumber`. A finalized round is
  closed; an unplayed FUTURE round is open, carrying only the notice "Not the
  live round. Changes post straight away." (`App.jsx:1787`)

WBC wrote the gate against a specific failure: Round 3 scores posted into
Round 1 on the morning of Round 3, by somebody opening the app before the
pairings moved. Those are real documents on a real leaderboard and somebody has
to go find them.

---

## Tier C — the director's side, and the toolchain

### C1 — nothing answers "has he even opened it yet?"

WBC's `lib/playerActivity.js` and `PlayerActivityPanel` join the roster against
accounts (`lastLoginAt`) and push tokens, reporting last-seen-ago plus whether
push is genuinely on. Token presence is the honest test — browser permission
stays `granted` forever, including for somebody who has since switched
notifications off.

Here: neither. No login stamp read anywhere, no per-player token view in
`AdminView`. With sixteen men and a store build to shepherd, "will he get the
tee time?" is the week-before question with no answer in the app.

### C2 — Apple token revocation is best-effort in the browser

Same App Store requirement, two answers.

- **WBC**: `revokeAppleToken`, an `onCall` holding the `.p8` as a Functions
  secret, signing an ES256 client secret and exchanging a fresh authorization
  code (`functions/index.js:339`).
- **Here**: `revokeProviderAccess` (`lib/auth.js:531`) reauthenticates in the
  browser to obtain a token, then calls `revokeAccessToken` — "best-effort by
  construction: a blocked popup logs and the deletion proceeds."

A blocked popup leaves the app listed under Settings → Apple Account for an
account that no longer exists. The fallback is the right call given the design
— refusing to delete an account over a popup is the worse failure — but the
server-side path removes the popup from the dependency chain entirely.

### C3 — no way to move an account between providers

WBC ships `offerAuthPairing` / `claimAuthPairing` callables behind
`lib/authPairing.js`. Nothing equivalent here, so a player who signed in with
Google one year and taps Apple the next arrives as a new uid with no route back
to his roster row — and the crown, the dues override and the claim all hang off
that row.

### C4 — the rules suite has no command to run it

- **WBC**: `npm run test:rules` and `npm run test:ctp-claims`, with
  `@firebase/rules-unit-testing` as a devDependency; the scripts start and stop
  the emulator themselves.
- **Here**: `firestore.rules.test.mjs` is 43 KB and its header documents an
  `npm i --no-save` plus `firebase emulators:exec` incantation. No npm script.
  `CLAUDE.md:557` says only "Run it before deploying a rules change."

Keeping the emulator packages out of `devDependencies` is a deliberate and
reasonable call — ~600 packages and a JVM for whoever edits the rules and
nobody else. A script can still wrap the documented command.

> That is how the rules suite went months unrunnable by the command that was
> written down for it. — `wbc/CLAUDE.md`, on the same trap

### C5 — screens have almost no mount tests

- **WBC**: a mount test beside ~20 components — `AdminView`, `BettingView`,
  `LeaderboardView`, `PlayersView`, `OnCourseScoring`, `ClaimScreen`,
  `GroupsView`, `SideBets` and the rest. Not what they compute; that they
  render.
- **Here**: five — `EditionBanner`, `Leaderboard` x2, `Popup`,
  `PhotosView.report`. Nothing covers `AdminView`, `AccountView`, `DataView`,
  `Budget`, `Ledger`, `TripInfo` or `FullScorecard`.

`no-undef` cannot see JSX element names, so a component used but never imported
lints clean and builds clean. WBC's Betting tab shipped dead on tap with every
check green. `DataView` here is lazy-loaded — its chunk is fetched only when
somebody taps the row — which is exactly the case WBC says needs a mount test
most, because a broken import there cannot fail anywhere else first.

---

## Reverse — where this repo is the one that is ahead

Candidates going back to WBC, roughly by how much work is already banked here
and how little of it is format-specific.

1. **Notifications** — 744 lines against WBC's 279, plus a `ctpNotice`
   function, an `onCardAttested` trigger, typed per-category preferences and
   badge sync.
2. **The native shells** — haptics, camera, badge, status bar, keyboard and
   browser Capacitor plugins; WBC has only authentication.
3. **`platform.js`** — `platformName()` vs `isNative()`. WBC has no equivalent
   guard against filing every Android device as an iPhone in the one field you
   would consult to find out why a push never arrived.
4. **The demo edition** — and `isDemoEdition` threaded through all three places
   that span editions: the Data tab, `cloneEdition`, `bulkLockVerdict`.
5. **Budget and ledger** — per-line documents, the per-man basis toggle, and
   `budgetVsDues`, the one number that catches a trip priced before the house
   was booked.
6. **The Data tab** — a precomputed archive shipped with the app (~12 KB
   gzipped, zero Firestore reads) folded against the live year through one
   implementation of "what is a win".
7. **Trip Info and `lib/dates`** — including the single-calendar
   `DateRangePicker` and the UTC-midnight trap solved once, with tests.
8. **`historyVerify`** — scores every imported year through the app's own
   engine and refuses to write a year that does not reproduce.
9. **Guest mode that survives a relaunch** — persisted in `localStorage`
   (`bc_guest`); WBC latches it in memory, so a tester on day three of fourteen
   has lost it.

---

No code was changed by this audit. A1, A2 and A3 are the three that CLAUDE.md's
working agreement classes as flag-before-landing, because each leaves the
screen showing a result the database does not have.
