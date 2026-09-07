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
export function devicesBlock(hand) {
  const lines = DEVICES
    .map(d => (hand[d.key] ? d.yes : d.no))
    .filter(Boolean)
    .map(s => `- ${s}`);
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
