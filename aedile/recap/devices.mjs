/**
 * devices.mjs -- deal this email its stylistic devices, because it cannot
 * deal them to itself.
 *
 * The archive uses a parenthetical aside in 62% of messages, asks the room a
 * question in 46%, and numbers from `0` or `-1` in 14%. Telling a generator
 * those numbers does not work, and the failure is not a wording problem:
 *
 *     device            archive   generated
 *     parenthetical         62%        100%
 *     question mark         46%        100%
 *     ALLCAPS run           62%        100%
 *     numbered list         82%        100%
 *     numbers from 0/-1     14%         70%
 *     semicolon             22%         60%
 *
 * Measured over a full burst. Every optional device pinned at or near 100%.
 * The two that landed were the ones where the archive is already almost-always
 * (exclamations, 92%) or almost-never (em-dash, 7%), which is the tell: a
 * per-message instruction can produce 0% or 100% and nothing in between.
 *
 * It cannot. Each email is one independent call with no memory of the other
 * eleven, so it has no way to ration a device across a set it cannot see. A
 * frequency is a fact about a corpus; an instruction has to be about THIS
 * email. The caller knows the frequency and can roll the dice, so it does, and
 * hands the result over as a fact about this one.
 *
 * Only presentation is dealt. Nothing here decides what the email SAYS.
 */

/** Measured over the 164 archived messages of 400-4000 characters that are
 *  MS-authored and signed -- the same pool the duel draws from. Re-derive with
 *  `style.mjs` if the pool changes; these are not guesses. */
export const DEVICES = [
  {
    // 16% of archived messages open straight into the substance with no
    // greeting at all -- "GMORNING, you wonderful, decent, kind, creative,
    // perfect people, you" is a greeting; "Some quick art guidelines for
    // digital throws." is not. A reader named the missing greeting twice in one
    // sitting while picking the real email out of a pair.
    key: 'greeting', p: 0.84,
    yes: '',
    no: 'Open straight into the substance. No greeting line at all.',
  },
  {
    key: 'numberedList', p: 0.82,
    yes: 'Number the items.',
    no: 'Do NOT number anything. Write it as prose, with a plain label if it needs one ("Clean-up: we will get as much done as we can on Sunday"). About one archived email in five is written this way, and a short one usually is.',
  },
  {
    // 0.17 not 0.14: this is gated on there being a list at all, and lists
    // are 82% of messages. 0.17 x 0.82 lands on the archive's 14% overall.
    key: 'zeroIndex', p: 0.17, requires: 'numberedList',
    yes: 'Open the numbering at `0` or `-1` -- there is a preamble item before the agenda proper.',
    no: 'Start the numbering at `1`.',
  },
  {
    key: 'parenthetical', p: 0.62,
    yes: 'Include a parenthetical aside, somewhere in the middle rather than at the end. This is where the archive puts its humour.',
    no: 'No parenthetical asides in this one.',
  },
  {
    key: 'question', p: 0.46,
    yes: 'Ask the room a direct question.',
    no: 'Do not ask a rhetorical question. (If the meeting left a real question the krewe must answer, say it as a question anyway -- content wins over this list.)',
  },
  {
    key: 'allCaps', p: 0.62,
    yes: 'Use ALL-CAPS for the one thing that must not be missed. One thing, not several.',
    no: 'No ALL-CAPS emphasis in this one.',
  },
  {
    // Likewise gated on ALL-CAPS being in play at all (62%), so 0.19 x 0.62
    // reproduces the archive's 12%.
    key: 'allCapsLine', p: 0.19, requires: 'allCaps',
    yes: 'Put one WHOLE LINE in capitals.',
    no: '',
  },
  {
    // 29% of the archive, and 0 of 24 generated emails. The largest single gap
    // the duel has turned up. Two rounds were decided on it outright -- "AI
    // censored the bondage word", "vulgarity which AI will not voluntarily do".
    // This is not coarseness added for its own sake; it is the register the
    // list has actually read for a decade, from the account that runs it.
    key: 'crude', p: 0.29,
    yes: 'Be blunt where the archive is blunt. It calls things bullshit, tells people who put a child\'s head in the cabinet that they are a fucking idiot, and writes "Butt juices." as a whole sentence. Do not sand this off, and do not reach for a politer word than the one that fits.',
    no: '',
  },
  {
    key: 'semicolon', p: 0.22,
    yes: '',
    no: 'No semicolons in this one.',
  },
];

/** A small string-seeded PRNG, so a burst reproduces exactly from its seed and
 *  a specimen always gets the same hand. Not cryptographic and does not need
 *  to be. */
function rng(seed) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

/** Rates that do not survive a change of genre.
 *
 *  Every `p` above was measured on the 400-4000 char digest pool, and
 *  AEDILE_CONTEXT.headsup.md says so in its own text: those rates "do NOT
 *  transfer to the terse heads-up register." Numbering is the one that bites,
 *  because it is dealt at 0.82 and the same spec says numbering "is NOT a
 *  lock-in trait... a single-venue heads-up should not be numbered" (it scales
 *  with length: 14% / 50% / 93% for short / mid / long). Dealing the digest's
 *  hand to a heads-up produced a numbered three-item notice on the genre's first
 *  real run, which `checks.mjs` then warned at: the dealer and the checker
 *  disagreeing about the same genre.
 *
 *  A forced `false` here, rather than a second probability, because these are
 *  not "rarer in this genre", they are wrong in it. The per-beat rates that ARE
 *  probabilities are still hand-set placeholders and stay open in #49. */
/** Per-genre probability overrides, measured -- not suppressions.
 *
 *  This started as GENRE_OFF, a list of devices forced to `false` for a heads-up on
 *  the authority of AEDILE_CONTEXT.headsup.md's prose. Measured against the 18
 *  day-before/day-of Sunday-gathering messages Abe actually sent (pre-2025, see
 *  analysis/headsup-form.mjs), that prose was wrong in both places:
 *
 *    numbering   headsup.md: "NOT a lock-in trait"        measured 44%  CI[25,66]
 *    questions   headsup.md: the nudge "drops questions"  measured 33%  CI[16,56]
 *
 *  Forcing either to zero reproduces a rule nobody follows. Both are genuinely
 *  coin-flips, which is precisely what a dealt probability is for and precisely what
 *  an instruction cannot express. Zach, 2026-09-26: "we're going to fix heads up
 *  today using actual statistical measures, triple checked, three different ways."
 *
 *  Only rates re-measured on that subpool appear here; the rest keep the 400-4000
 *  char pool's values, which is a known approximation rather than a silent one.
 */
const GENRE_P = {
  headsup: { greeting: 0.67, numberedList: 0.44, allCaps: 0.44, question: 0.33 },
};

/** Deal one email its hand. `seed` makes it reproducible; omit for a real
 *  recap, where each one should simply differ from the last. `genre` suppresses
 *  devices that belong to another register. */
export function dealDevices(seed, genre, beat) {
  const rand = seed === undefined ? Math.random : rng(seed);
  const over = GENRE_P[`${genre}:${beat}`] || GENRE_P[genre] || {};
  const hand = {};
  for (const d of DEVICES) {
    const p = over[d.key] ?? d.p;
    hand[d.key] = d.requires && !hand[d.requires] ? false : rand() < p;
  }
  return hand;
}

/** The hand, as a block to append to the system prompt. Lines with nothing to
 *  say are dropped: "no whole line in capitals" is noise, and a prompt that
 *  lists every device every time is teaching the model that every device is
 *  always in play, which is the habit being corrected. */
export function devicesBlock(hand, flourish, typo, gap, subject) {
  const lines = DEVICES
    .map(d => (hand[d.key] ? d.yes : d.no))
    .filter(Boolean)
    .map(s => `- ${s}`);
  if (subject) lines.push(`- ${subject}`);
  if (gap) {
    lines.push(`- Separate paragraphs and items with ${gap} blank line${gap === 1 ? '' : 's'}`
      + ' as the default for this email, and vary off it in a place or two rather than'
      + ' spacing the whole message identically.');
  }
  if (flourish) lines.push(`- ${flourish}`);
  if (typo) lines.push(`- ${typo.replace(/\n/g, '\n  ')}`);
  if (!lines.length) return '';
  return [
    '## For this email',
    '',
    'These devices vary from message to message in the archive. This email has',
    'been dealt the following, and the deal is how that variation is reproduced',
    'across many emails -- something no single email can do for itself. Follow it.',
    '',
    ...lines,
  ].join('\n');
}

/** A flourish is not a device.
 *
 *  Devices are things the archive does OFTEN, and the fix was to deal each at
 *  its rate. Flourishes are things it does RARELY and never the same way twice:
 *  `juuuuuuust`, `<3 <3 <3`, numbering that goes `-1, 0, 0.5`, a nested
 *  asterisk footnote answering its own joke, `really really very much really`.
 *
 *  Measured, 40% of archived messages carry at least one and the generator
 *  managed 17%. But the rate is not the interesting part: no single flourish is
 *  above 11%, so instructing any one of them would fire every time and become a
 *  tell of its own. The variety IS the trait. So one is drawn from the menu,
 *  in roughly two messages in five, and it is a different one each time.
 *
 *  Nothing here is an error. Every entry is something a person chose to write.
 *  Typos are a separate question and deliberately not in this list. */
export const FLOURISHES = [
  'Stretch a word out for emphasis, the way someone says it aloud ("we juuuuuust found out", "sooooo close").',
  'Repeat a word for stress rather than reaching for a stronger one ("we really really very much really need people").',
  'Let a laugh onto the page in capitals: HAHAHA, or HA, as its own reaction.',
  'Hang an asterisk footnote off a line, and answer it at the bottom. It may answer itself again.',
  'Number something oddly on purpose: a `0.5` between two items, or a `2b`, as though the list was written in the order it was thought of.',
  'Give one item a bare header line ("Clean-up:", "Tomorrow:") instead of a number.',
  'Let punctuation run for emphasis somewhere: "!!!" or "?!".',
  'Drop a one-word parenthetical in as an aside: "(yay)", "(ha)", "(sorry)", "(probably)".',
  'Use the spoken contraction rather than the written one: "yall", "gonna", "kinda".',
  'Answer your own sentence with a two-word one. "Butt juices." "Not certain." "Standby."',
  'Restate a sentence mid-flight rather than writing the clean version: "This build will be paced differently than the last two, which is to say: faster."',
  'Use the shorthand you would type in a hurry: "thru", "P sure", "530" for half past five.',
  'Mark a list with something other than plain numbers -- "1)" or "ITEM 3" -- as though you picked the format on the spot.',
];

/** How often the archive carries at least one, measured over the pool. */
export const FLOURISH_RATE = 0.40;

/** The line above the initials. The archive does not always write `<3`.
 *
 *  Census of every MS-signed message in the 400-4000 character window (n=219),
 *  by what sits directly above the initials:
 *
 *      `<3` alone                                   74.0%
 *      a short valence line ("Okay", "More soon!")  10.5%
 *      nothing -- last content line, then MS         7.3%
 *      xo / xoxo / XOXO                              3.7%
 *      Best                                          2.7%
 *      `<3` with words ("<3 you all,", "<3 all of u")1.8%
 *
 *  These rates are NOT from the duel pool. That pool is filtered to `<3 MS`
 *  (`duel.mjs`), so measured there the lead-in is 100% `<3` by construction and
 *  there is nothing to learn. Re-derive from `messages.jsonl` directly.
 *
 *  ONE roll, not two. The multi-heart used to be dealt by its own function
 *  alongside this, which meant a hand could say `<3 <3 <3` and `Best` at once
 *  and hand the model two sign-offs. These are mutually exclusive shapes of a
 *  single line, so they are one weighted draw.
 *
 *  The 1% ceiling on the multi-heart is kept from that earlier measurement: a
 *  reader clocked it as "faked me out with the special signature", and a
 *  signature variant is the most memorable thing in the email. */
export const SIGNOFF_LEAD_INS = [
  // The base prompt already says `<3 SM`, so the common case says nothing.
  { key: 'heart', p: 0.740, say: null },
  { key: 'valence', p: 0.105, say: 'Put a short line of your own above the sign-off instead of the `<3` -- "Okay", "More soon!", "Let\'s go!", "Good night friends". Then the initials.' },
  { key: 'none', p: 0.073, say: 'No `<3` and no closing line at all. The last item ends, and the initials are on the next line.' },
  { key: 'xo', p: 0.037, say: 'Close with `xo` or `xoxo` instead of the `<3`, then the initials.' },
  { key: 'best', p: 0.027, say: 'Close with a plain `Best` instead of the `<3`, then the initials.' },
  { key: 'multiHeart', p: 0.010, say: 'Sign off with more than one heart -- `<3 <3 <3` -- instead of the usual single one.' },
  { key: 'heartWords', p: 0.008, say: 'Put words after the heart on the closing line -- `<3 you all,` or `<3 all of u` -- then the initials.' },
];

/** Draw one lead-in. Returns the instruction, or null for the ordinary `<3`
 *  the base prompt already asks for. Seeded like the rest. */
export function dealSignoff(seed) {
  const rand = seed === undefined ? Math.random : rng(String(seed) + ':signoff');
  let r = rand();
  for (const s of SIGNOFF_LEAD_INS) {
    if (r < s.p) return s.say;
    r -= s.p;
  }
  return null;  // float slack at the tail lands on the common case
}

/** Blank-line gap size, drawn per email.
 *
 *  This was the last measured distribution shipped as a fixed instruction:
 *  AEDILE_CONTEXT.recap.md told the generator "THREE blank lines between items,
 *  most of the time", which is the failure this whole file exists to fix. An
 *  instruction that names a default produces it ~100% of the time; a frequency is
 *  a fact about a corpus, so it has to be drawn. Zach, 2026-09-26, on reading a
 *  draft spaced three throughout: "defaulting to 3 spaces as a rule is wrong, it
 *  should be stochastic."
 *
 *  Weights are the archive's measured gaps: 3 at 54%, 2 at 34%, 1 at 11%.
 *
 *  UNVERIFIED that the distribution is a person. #27 measures a step change in
 *  2020 that then held for six years, 97% of gaps quantized to 2/3/4, and gap-4
 *  correlating with what FOLLOWS it -- all of which a compose client or an export
 *  pipeline does and a typist does not. So this reproduces a measured frequency
 *  and asserts nothing about who or what produced it. If #27 resolves against
 *  Abe, the weights change here and nowhere else, which is the point of putting
 *  them in one draw instead of in prose. */
/** Gap size scales with LENGTH, so it is per genre. Modal gap by message size,
 *  MS-authored, measured 2026-09-26:
 *
 *    0-250    n=160   gap1 42%  gap0 34%  gap2 17%  gap3  8%
 *    250-400  n= 50   gap1 42%  gap2 40%  gap3 18%
 *    400-1000 n= 85   gap3 49%  gap2 27%  gap1 24%
 *    1000-2000 n= 98  gap3 58%  gap2 34%  gap1  8%
 *    2000-4000 n= 72  gap3 76%  gap2 18%  gap1  6%
 *
 *  Monotonic, no discontinuity: the 54/34/11 that AEDILE_CONTEXT.recap.md used to
 *  state as a house default is the 400-4000 DIGEST rate, and it is simply wrong
 *  for a terse notice. The hand-written Half Moon heads-up (2026-09-14, 230 chars)
 *  is single-spaced throughout, and so is 42% of its length band. Dealing 3 to a
 *  heads-up is the numberedList mistake again: a digest rate applied to a register
 *  that does not share it. */
export const GAPS = {
  recap:   [{ p: 0.54, n: 3 }, { p: 0.34, n: 2 }, { p: 0.11, n: 1 }],
  headsup: [{ p: 0.42, n: 1 }, { p: 0.40, n: 2 }, { p: 0.18, n: 3 }],
};

export function dealGap(seed, genre) {
  const table = GAPS[genre] || GAPS.recap;
  const rand = seed === undefined ? Math.random : rng(String(seed) + ':gap');
  let r = rand();
  for (const g of table) {
    if (r < g.p) return g.n;
    r -= g.p;
  }
  return table[0].n;  // float slack at the tail lands on that register's usual gap
}

/** Subject shapes, drawn per email.
 *
 *  The archive cannot teach this. `messages.jsonl` has NO subject field: the
 *  scraper built thread titles from body first lines (#30), so every "subject"
 *  statistic derivable from the vault is measuring the scrape. The shapes below
 *  come from REAL subjects in the live Sent folder, which is the only honest
 *  source, and the sample is small: about seven event announcements. Treat the
 *  weights as informed placeholders, not measurements, and re-derive them as the
 *  Sent folder grows.
 *
 *  Verbatim, the ones these are drawn from:
 *    Rapid Rewards Brunch. Sun. 1/4 @ 1pm, 920 St. Mary
 *    Rapid Rewards Brunch: Today, Sun. 1/18 @1pm, Meeting @3pm
 *    Content + Builds Tonight | 6 pm at NOLA Brewing
 *    [Carnival26] Jumpsuit Dropoff 1/21 5-8pm
 *    Wednesday: Half Moon
 *    Wings tonight at Half Moon
 *    long meeting / laser harps 2027 / clubhouse?
 *
 *  What every one of them does and aedile never has: names the THING, then the
 *  when, then the where, with real punctuation between. What aedile produced
 *  instead was `Hi friends!` (the body's opening, twice), `-1. THESE NOTES ARE
 *  FROM MEMORY...`, and four bare descriptions with no time and no venue. The
 *  slash form is attested as a human REWRITE: someone replaced a generated
 *  `Hi friends!` with `long meeting / laser harps 2027 / clubhouse?` before
 *  sending.
 *
 *  Zach, 2026-09-26: "we need a subject generator, and use the Nelson Street era
 *  messages to define it with stochastic features."
 */
export const SUBJECT_SHAPES = [
  { key: 'namedWhenWhere', p: 0.34,
    say: 'SUBJECT: name the thing, then when, then where, the way the list already does it: '
       + '`Rapid Rewards Brunch. Sun. 1/4 @ 1pm, 920 St. Mary`. Use a full stop or a colon '
       + 'between the parts and `@` before a time. Carry the venue.' },
  { key: 'todayFirst', p: 0.20,
    say: 'SUBJECT: lead with the day word, then the rest of the logistics: '
       + '`Rapid Rewards Brunch: Today, Sun. 1/18 @1pm, Meeting @3pm`. Both times if there are two.' },
  { key: 'dayColonPlace', p: 0.16,
    say: 'SUBJECT: just the day and the place, nothing else: `Wednesday: Half Moon`. Short is correct.' },
  { key: 'thingAtPlace', p: 0.14,
    say: 'SUBJECT: the thing, the day word, and the place, as a phrase: '
       + '`Wings tonight at Half Moon`. No colon, no date.' },
  { key: 'pipeOrSlash', p: 0.10,
    say: 'SUBJECT: separate two or three parts with ` | ` or ` / `: '
       + '`Content + Builds Tonight | 6 pm at NOLA Brewing`, `long meeting / laser harps 2027 / clubhouse?`.' },
  { key: 'bracketTag', p: 0.06,
    say: 'SUBJECT: open with a bracketed campaign tag, then the thing and its logistics: '
       + '`[Carnival26] Jumpsuit Dropoff 1/21 5-8pm`. Only if the notes name a campaign.' },
];

/** Draw one subject shape. Seeded like the rest, with its own suffix so it varies
 *  independently of the device hand. */
/** The examples in SUBJECT_SHAPES are SHAPES, not text to reuse. The generator's
 *  first run with them lifted "Rapid Rewards Brunch" wholesale onto a laser harp
 *  build day; `invented-name` blocked it, which is the right outcome and the wrong
 *  reason to need it. This warning rides along with whichever shape is drawn. */
const SUBJECT_CAVEAT = ' The example is the SHAPE only: do not reuse any of its'
  + ' words, names or venues, only its arrangement and punctuation.';

export function dealSubject(seed) {
  const rand = seed === undefined ? Math.random : rng(String(seed) + ':subject');
  let r = rand();
  for (const sh of SUBJECT_SHAPES) {
    if (r < sh.p) return sh.say + SUBJECT_CAVEAT;
    r -= sh.p;
  }
  return SUBJECT_SHAPES[0].say + SUBJECT_CAVEAT;  // float slack -> commonest shape
}

/** Deal at most one flourish. Same seeding contract as dealDevices. */
export function dealFlourish(seed) {
  const rand = seed === undefined ? Math.random : rng(String(seed) + ':flourish');
  if (rand() >= FLOURISH_RATE) return null;
  return FLOURISHES[Math.floor(rand() * FLOURISHES.length)] || FLOURISHES[0];
}

/** An uncorrected slip, at the rate the archive has them.
 *
 *  Ruled in by Zach 2026-09-07, having picked the generated email out of a pair
 *  three times in twelve on literal errors: `GRACIUOS`, `t's beautiful`,
 *  `I'd ilke us`. He types fast, does not reread, and never goes back.
 *
 *  This is the one dealt thing that is not simply a style, so it is fenced. A
 *  slip in a date, a time, an address, a dollar figure, a URL or a person's
 *  name is not a typo, it is a factual error in mail a director forwards to
 *  about forty people -- and getting those exactly right is the whole reason
 *  the recap tier is trusted at all. The fence is in the instruction, and
 *  checks.mjs independently fails any figure or name that is not in the input,
 *  so a slip that lands on one is caught rather than sent. */
export const TYPO_RATE = 0.10;

export const TYPO_INSTRUCTION = [
  'Leave exactly one uncorrected typo somewhere in an ordinary word: two letters',
  'transposed, a dropped letter, or a word accidentally written twice. The kind',
  'someone makes typing fast and never rereading. Do not flag it, apologise for',
  'it, or draw attention to it.',
  '',
  'NOT in a date, a time, an address, a dollar figure, a URL, or anybody\'s name.',
  'A slip in any of those is not a typo, it is a wrong fact going out to the',
  'whole list.',
].join('\n');

/** Deal a typo, or not. Seeded separately so it varies independently of the
 *  flourish -- an email can have both, either, or neither, which is what the
 *  archive looks like. */
export function dealTypo(seed) {
  const rand = seed === undefined ? Math.random : rng(String(seed) + ':typo');
  return rand() < TYPO_RATE ? TYPO_INSTRUCTION : null;
}
