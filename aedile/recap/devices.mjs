// devices.mjs -- deal each email its stylistic devices at the archive's rates.
// One call cannot ration a device across a set it cannot see, so the caller rolls.
// Only presentation is dealt; nothing here decides what the email says.

// Rates measured on the digest pool; re-derive with `style.mjs` if the pool changes.
export const DEVICES = [
  {
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
    // Gated on there being a list, so p is the overall rate divided by numberedList's.
    key: 'zeroIndex', p: 0.17, requires: 'numberedList',
    yes: 'Open the numbering at `0` or `-1` -- there is a preamble item before the agenda proper.',
    no: 'Start the numbering at `1`.',
  },
  {
    key: 'parenthetical', p: 0.62,
    // Says which humour: a bare "humour" gets the register the model already has.
    yes: 'Include a parenthetical aside, somewhere in the middle rather than at the end. This is where the archive puts its humour -- and its humour is a name with an exclamation mark ("Joseph is on it!", "Koi fish building!"), or a concrete consequence of the plan ("This is also how we will get everyone to leave."), or three words ("tomorrow", "aka we walk"). Never a wry verdict ON an item: not "(the tang is load-bearing)", not "(this is doing a lot of work)". Nobody on this list reviews the agenda, they run it.',
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
    // Likewise gated on allCaps.
    key: 'allCapsLine', p: 0.19, requires: 'allCaps',
    yes: 'Put one WHOLE LINE in capitals.',
    no: '',
  },
  {
    // The register the list has read from this account, not coarseness for its own sake.
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

// String-seeded PRNG so a burst reproduces from its seed. Exported for
// schedule.mjs, which needs the same generator.
export function rng(seed) {
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

// Per-genre probability overrides come from the caller (`over`), computed by
// analysis/headsup-form.mjs; this file keeps no genre table and no corpus dependency.

// Deal one email its hand. `seed` makes it reproducible; omit for a real recap.
export function dealDevices(seed, genre, beat, over = {}) {
  const rand = seed === undefined ? Math.random : rng(seed);
  const hand = {};
  for (const d of DEVICES) {
    const p = over[d.key] ?? d.p;
    hand[d.key] = d.requires && !hand[d.requires] ? false : rand() < p;
  }
  return hand;
}

// The hand, as a block to append to the system prompt. Lines with nothing to say are dropped.
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

// Flourishes are rare and never the same way twice, so at most one is drawn
// from the menu. Typos are separate and not in this list.
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

// The line above the initials: one weighted draw over mutually exclusive shapes.
// Rates are from messages.jsonl, not the duel pool, which is filtered to `<3 MS`.
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

// Blank-line gap size, drawn per email: a named default gets produced every
// time. Gap size scales with length, so the weights are per genre.
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

// The subject, dealt as features at the rates in `w` (from `subjectWeights(genre, beat)`),
// with no example text to lift. Nothing here knows the message types.
export function dealSubject(seed, w) {
  if (!w) return '';   // no measured weights pushed in: say nothing about the subject
  const rand = seed === undefined ? Math.random : rng(String(seed) + ':subject');
  const take = p => rand() < (p || 0);
  // Length is drawn across the middle half of the pool, not pinned to its median.
  const lo = w.q1Chars ?? w.medianChars, hi = w.q3Chars ?? w.medianChars;
  const chars = Math.round(lo + rand() * (hi - lo));
  const parts = [];
  if (take(w.dayWord)) parts.push('the day word (a weekday name, or today/tomorrow/tonight)');
  if (take(w.calDate)) parts.push('the calendar date as M/D');
  if (take(w.clockTime)) parts.push('the start time');
  if (take(w.venue)) parts.push('the venue');
  const lines = [`SUBJECT: about ${chars} characters.`];
  const seps = Object.entries(w.separators || {});
  if (seps.length && take(w.multi)) {
    let r = rand() * seps.reduce((s, [, c]) => s + c, 0);
    const sep = (seps.find(([, c]) => (r -= c) < 0) || seps[0])[0];
    lines.push(`Name two or three of the things this mail carries, a few words each, joined by "${sep}".`);
    if (parts.length) lines.push(`Somewhere in it include ${parts.join(', ')}.`);
  } else {
    lines.push('Name one thing, and include '
      + (parts.length ? parts.join(', ') + '.' : 'no date, time or venue at all: just the thing.'));
    if (take(w.colon)) lines.push('Use a colon in it.');
  }
  lines.push('Never number the subject and never make it the body\'s first line.');
  if (take(w.bang)) lines.push('End a part of it with an exclamation mark.');
  if (take(w.question)) lines.push('Make it a question.');
  if (take(w.allCaps)) lines.push('Put one word of the subject in ALL-CAPS.');
  if (take(w.lowerOpen)) lines.push('Start the subject with a lowercase letter.');
  return lines.join(' ');
}

/** Deal at most one flourish. Same seeding contract as dealDevices. */
export function dealFlourish(seed) {
  const rand = seed === undefined ? Math.random : rng(String(seed) + ':flourish');
  if (rand() >= FLOURISH_RATE) return null;
  return FLOURISHES[Math.floor(rand() * FLOURISHES.length)] || FLOURISHES[0];
}

// An uncorrected slip, at the archive's rate. Fenced: a slip in a date, time,
// address, dollar figure, URL or name is a factual error; the fence is in the
// instruction, and checks.mjs fails any figure or name not in the input.
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

// Seeded separately so it varies independently of the flourish.
export function dealTypo(seed) {
  const rand = seed === undefined ? Math.random : rng(String(seed) + ':typo');
  return rand() < TYPO_RATE ? TYPO_INSTRUCTION : null;
}
