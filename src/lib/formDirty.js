// ══════════════════════════════════════════════════════════════════
//  "Does this form hold anything the database does not?"
// ══════════════════════════════════════════════════════════════════
//
// A Save button is gold only when there is something to save (see `saveBtn`
// in theme.js), and for a card with three text boxes that is a comparison
// anybody can write inline. For the two Admin sheets it is not: a player
// carries eleven fields including four written by the GHIN link, and a course
// carries a scorecard and a tee list.
//
// So each is flattened to a SIGNATURE — one string per form — and the
// comparison is a string compare. Two rules make that honest:
//
//   * Both sides go through the SAME function. The form holds strings
//     (an <input> always does) and the document holds numbers, so comparing
//     them field by field reports every untouched course as edited.
//   * Only the fields the form can actually change are in it. An id, a
//     tournament_id or a stray `_source` off an API result is not an edit.
//
// Pure and unit-tested on purpose: this decides what a director sees when
// they open a sheet and change nothing, which is the case nobody tests by
// hand because nothing appears to happen.

// parseFloat/parseInt with a fallback that survives a legitimate 0 — `||`
// would turn a yardage of 0 into the default and call an untouched tee edited.
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const str = (v) => String(v ?? "").trim();

// The player sheet. `dir` is the crown, which writes to bc_accounts rather
// than the roster row but is committed by the same Save, so it belongs here.
const PLAYER_FIELDS = ["team", "first", "last", "nick", "hi", "ov", "dir",
  "ghin_number", "ghin_name", "ghin_rev_date", "ghin_synced_at"];

export function playerFormSig(form) {
  if (!form) return "";
  return JSON.stringify(PLAYER_FIELDS.map(k => {
    const v = form[k];
    if (k === "dir") return !!v;
    // hi and ov are typed numbers: "12.40" and "12.4" are the same handicap,
    // and a trailing zero is not an edit worth lighting a button for.
    if (k === "hi" || k === "ov") return str(v) === "" ? "" : num(v, str(v));
    return str(v);
  }));
}

// The course sheet. par, slope and rating are deliberately absent: the save
// derives all three from the first tee box, so a tee edit already moves them
// and comparing them as well would double-count.
export function courseFormSig(course) {
  if (!course) return "";
  return JSON.stringify([
    str(course.name), str(course.city), str(course.state),
    (course.hole_pars || []).map(v => int(v, 4)),
    (course.hole_handicaps || []).map(v => int(v, 0)),
    (course.tee_boxes || []).map(t => [
      str(t.name), str(t.color),
      num(t.rating, 72), int(t.slope, 113), int(t.par, 72), int(t.yardage, 0),
    ]),
  ]);
}
