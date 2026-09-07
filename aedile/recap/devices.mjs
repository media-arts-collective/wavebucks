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

/** Deal one email its hand. `seed` makes it reproducible; omit for a real
 *  recap, where each one should simply differ from the last. */
export function dealDevices(seed) {
  const rand = seed === undefined ? Math.random : rng(seed);
  const hand = {};
  for (const d of DEVICES) {
    hand[d.key] = d.requires && !hand[d.requires] ? false : rand() < d.p;
  }
  return hand;
}

/** The hand, as a block to append to the system prompt. Lines with nothing to
 *  say are dropped: "no whole line in capitals" is noise, and a prompt that
 *  lists every device every time is teaching the model that every device is
 *  always in play, which is the habit being corrected. */
export function devicesBlock(hand, flourish, typo) {
  const lines = DEVICES
    .map(d => (hand[d.key] ? d.yes : d.no))
    .filter(Boolean)
    .map(s => `- ${s}`);
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

/** Rarer than the rest and dealt separately, because at 1 of 14 flourishes it
 *  came out at ~2.9% of emails against the archive's 1%. A reader clocked it as
 *  "faked me out with the special signature" and immediately asked what rate
 *  would be too obvious -- which is the right question, and the answer is that
 *  a signature variant is the most memorable thing in the email. */
export const HEART_VARIANT_RATE = 0.01;

export function dealHeartVariant(seed) {
  const rand = seed === undefined ? Math.random : rng(String(seed) + ':heart');
  return rand() < HEART_VARIANT_RATE
    ? 'Sign off with more than one heart -- `<3 <3 <3` -- instead of the usual single one.'
    : null;
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
