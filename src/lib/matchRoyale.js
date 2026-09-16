// ══════════════════════════════════════════════════════════════════
//  matchRoyale — every golfer against every other golfer, every hole.
// ══════════════════════════════════════════════════════════════════
//
// The cup's own metric, lifted off the Google Sheets workbook the tournament
// ran on before this app. The definition is the workbook's, written in its
// own notes:
//
//   "Match Royale is a player's winning percentage against every other player
//    on every hole. Think of this as an All Play (or W-L-T record) winning
//    percentage across each and every hole."
//
// So it is not about the match a man was drawn into. On every hole he plays
// the other fifteen at once, and his score for the round is the share of
// those little matches he won — half credit for a tie, the same way a halved
// match is half a point.
//
// ── Why it is worth having ────────────────────────────────────────
// Every other measure on the Data tab is filtered through the draw. Win a
// four-ball because your partner went round in 71 and you get the same point
// as the man who won it himself; draw the best player in the field in the
// singles and a good round is a loss. Match Royale asks the one question the
// draw cannot touch — how did he play against the whole field — and it is why
// the sheets carried it for ten years.
//
// ── On the app's own net card ─────────────────────────────────────
// Net here is what it is everywhere else on this tab: his full course
// handicap allocated down the stroke index, the card lib/scoresExport prints.
// Not the workbook's own net column, which is why the numbers are very close
// to the sheets rather than identical — see matchRoyale.fidelity.test.js,
// which measures the gap against all 630 rounds the workbook recorded.
//
// The reason is CLAUDE.md's, and it is the same one that made the birdie
// counts gross: the workbook's net column does not survive being checked (on
// eight of the forty rounds its net is not its own gross less its own strokes),
// and a number only the sheets can produce dies the moment the app is the
// thing keeping the record. A metric this app can compute for 2026 beats a
// metric it can only copy for 2016.
//
// Pure — no Firebase, no React, no scoring engine. Both producers call it:
// pipeline/archive.mjs for the ten finished years, lib/archiveLive for the one
// being played.

// ── One round ─────────────────────────────────────────────────────
// `nets` is { playerId: { holeIndex: netScore } } for everybody who played
// that round — the whole field, not one match, which is the point.
//
// Returns { playerId: fraction }, or no entry at all for a man with nothing
// to compare: an unplayed hole is skipped on both sides, so a card that is
// half finished is scored on the half that exists rather than being counted
// as losses.
export const matchRoyale = (nets = {}) => {
  const ids = Object.keys(nets);
  const out = {};
  // A field of one is a man playing himself, which is 50% by construction and
  // means nothing. It is left out rather than reported as average.
  if (ids.length < 2) return out;

  ids.forEach((id) => {
    let won = 0;
    let played = 0;
    const mine = nets[id] || {};
    Object.keys(mine).forEach((h) => {
      const me = mine[h];
      if (me == null) return;
      ids.forEach((other) => {
        if (other === id) return;
        const theirs = nets[other]?.[h];
        if (theirs == null) return;
        played += 1;
        // Lower is better, and a tie is half — a halved hole is worth what a
        // halved match is.
        won += me < theirs ? 1 : me > theirs ? 0 : 0.5;
      });
    });
    if (played) out[id] = won / played;
  });
  return out;
};

// ── The net card, hole by hole ────────────────────────────────────
// A small helper both producers want: gross less the strokes that fall on the
// hole. `strokes` is a buildStrokeMap result, keyed by hole index.
export const netByHole = (gross = {}, strokes = {}) => {
  const out = {};
  Object.keys(gross).forEach((h) => {
    const g = gross[h];
    if (g == null || !(g > 0)) return;
    out[h] = g - (strokes[h] || 0);
  });
  return out;
};

// On screen it is read as "holes' worth of the field beaten", which is the
// form the workbook printed it in and the one people quote: a fraction times
// eighteen. 9.0 is dead average, because half of fifteen opponents over
// eighteen holes is nine.
export const ROYALE_SCALE = 18;
export const royaleHoles = (fraction) =>
  fraction == null ? null : fraction * ROYALE_SCALE;
