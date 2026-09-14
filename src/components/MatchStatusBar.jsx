// ══════════════════════════════════════════════════════════════════
//  MatchStatusBar — the title bar on a match box
// ══════════════════════════════════════════════════════════════════
//
//  A singles tee group is TWO matches (lib/groups.scoringUnits), so the
//  Scoring tab draws each of them as its own bordered box and this is the
//  band across the top of one: what the match is doing, and how its nines
//  stand. The border groups the two men; this says what they are doing to
//  each other.
//
//  ── It is absolute, and every other verdict in the app is not ──────
//  `verdictText` answers from the READER's side — "2 UP" on one phone is
//  "2 DN" on the other — which is right for a chip belonging to one of the
//  two men on the card. It is wrong here, because this screen now holds a
//  match the reader may be in neither side of: a director scoring another
//  group, or the man in the OTHER match of this foursome, would read a
//  relative verdict as his own. So the bar names the leader instead —
//  `statusText` is already absolute (it answers from Team A's side, and the
//  name in front of it is what settles which side that is).
//
//  Level is TIED, with no name in front of it, because there is nobody to
//  name. That word is the app's, not golf's — see scoring.statusText.
//
//  ── No OVERALL chip ───────────────────────────────────────────────
//  The Nassau badge row prints FRONT / OVERALL / BACK, and OVERALL is the
//  whole-match margin — which is what the bar's own primary text says, eight
//  points smaller and a few pixels to the right of it. It is the longest of
//  the three labels, and the row is sized to content BECAUSE of it (see the
//  note on the badge row in App). Promoting it to the title retires the chip
//  and the workaround together, and leaves room to spell the other two out.
//
//  On most rounds there are no chips at all: nassauSegmentVisibility shows
//  FRONT and BACK only where the round is actually played as a Nassau, so a
//  round that is not leaves the bar as one line of text. That is the best
//  version of it, and it is the common case.
//
//  No match number. The Matches tab, the Leaderboard and the sign sheet all
//  call this Match 3; this screen is the one place the number answers nothing
//  — the two names are directly underneath it.

import { BC, ALPHA, FS, R, teamColor } from "../theme";

// The band's own ground: a wash of the leading side's colour, or the sunken
// input grey when nobody leads. Deliberately the container and not the type
// — a coloured letter inside a name is what came off this screen, and this is
// a surface you read before you read anything on it.
const bandStyle = (leader, settled) => {
  if (!leader) return { background: BC.inp, borderBottom: `1px solid ${BC.bdr}` };
  const c = teamColor(leader);
  return {
    background: `${c}${settled ? ALPHA.tint : ALPHA.wash}`,
    borderBottom: `1px solid ${c}${settled ? ALPHA.line : ALPHA.hair}`,
  };
};

// `segments` is [{ key, label, verdict, leader }] — already resolved by the
// caller through the same segmentState the engine settles on, so this cannot
// second-guess what a hole was worth.
//
// `style` is the one escape hatch, and it exists for exactly one difference:
// the band heads a match BOX on the scoring screen, where the box's own
// overflow rounds its top corners and the bottom border is what separates it
// from the cards — and it floats free inside the turn card's popup, where it
// wants edges of its own. Everything that makes it the same bar in both
// places, the wording and the colour, stays here rather than being drawn a
// second time by whoever needs the other shape.
export function MatchStatusBar({ verdict, leader = null, settled = false, segments = [], style }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, height: 22, padding: "0 9px",
      flexShrink: 0, ...bandStyle(leader, settled), ...style,
    }}>
      <span style={{
        fontSize: FS.small, fontWeight: 800, letterSpacing: 0.6, lineHeight: 1,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        color: leader ? teamColor(leader) : BC.t2,
      }}>
        {verdict}
      </span>
      {segments.length > 0 && (
        <span style={{ display: "flex", gap: 4, marginLeft: "auto", flexShrink: 0 }}>
          {segments.map(s => (
            <span key={s.key} style={{
              fontSize: FS.micro + 1, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1,
              padding: "2.5px 6px", borderRadius: R.sm + 1, whiteSpace: "nowrap",
              background: s.leader ? `${teamColor(s.leader)}${ALPHA.tint}` : BC.bdr,
              color: s.leader ? teamColor(s.leader) : BC.t3,
            }}>
              {s.label} {s.verdict}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
