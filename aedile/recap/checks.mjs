/**
 * checks.mjs -- what the generated draft has to survive before anyone sees it.
 *
 * These run OVER the output, not as instructions to the model. The prompt
 * already asks for all of this; the first real run still deviated (it named
 * someone who had made no commitment -- arguably an improvement, but nothing
 * would have caught it either way). An instruction is not a guarantee.
 *
 * Nothing in this estate could do this job. Its checkers grade GitHub state,
 * git trees, or host state; the one text-in checker (body-grammar.sh) enforces
 * an internal metadata grammar and would flag every line of a krewe email as
 * UNDECLARED. There is no readability or banned-phrase checker anywhere. So
 * these are krewe-specific and local by necessity, not by preference.
 *
 * level 'fail' blocks posting. level 'warn' is reported and does not.
 */

import { isRagged, modalGap } from './normalize.mjs';
import { weekdayPairs } from './dates.mjs';
import { NAMES } from '../analysis/recap-form.mjs';

// Capitalised words that are not people. Sentence-initial words mostly appear
// in both texts and cancel out; these are the ones that would not.
const NOT_A_NAME = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'we', 'i', 'it', 'this', 'that',
  'there', 'here', 'they', 'them', 'our', 'us', 'you', 'your', 'he', 'she',
  'krewe', 'friends', 'still', 'open', 'no', 'yes', 'not', 'nobody', 'everyone',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'sm', 'ms', 'tl', 'dr', 'vhs', 'dns', 'github', 'u', 'haul', 'uhaul',
]);

/** The body is plain text, so this is the whole of it.
 *
 *  This used to strip tags and decode entities, and a second function existed
 *  beside it to turn block tags back into the newlines the first one had just
 *  destroyed -- because the name check below is built on knowing where a
 *  sentence starts. Plain text has real newlines, so both are gone.
 *
 *  The tag stripper was also a live hazard: `<[^>]+>` matches `<3 SM</p>`
 *  whole, so the krewe's sign-off survived only while the model remembered to
 *  write it as `&lt;3 SM`. Nothing to remember now. */
const text = s => String(s || '');

const norm = w => w.toLowerCase().replace(/[’']s$/, '');

/** Candidate names: words capitalised MID-SENTENCE.
 *
 *  Three things are capitalised without naming anyone, and the first version of
 *  this check flagged all of them on the first real run:
 *    - sentence-initial words   "Correct it on-list."  "Separately, Tyler..."
 *    - ALL-CAPS emphasis        "THIS RECAP IS RECONSTRUCTED"
 *    - list ordinals' first word after "1. "
 *  So: require an initial capital followed by lower case, and reject anything
 *  sitting at the start of a line, after terminal punctuation, or after an
 *  ordinal. What survives is a proper noun used in running prose, which is
 *  where a hallucinated person would actually appear. */
function nameCandidates(src) {
  const body = text(src);
  const out = new Set();
  const re = /([^\s])?(\s+)([A-Z][a-z][a-zA-Z'’-]*)\b/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const prev = m[1];
    // A line start is a sentence start. Deleting the subject doctrine (#30)
    // exposed this: real subjects carry no terminal period, so `...failed\nHi
    // friends!` left `Hi` looking mid-sentence and every correctly-subjected
    // draft failed on the invented name "hi". The cost is that a capitalised
    // word first on its own line is never name-checked, which is the same
    // exemption sentence starts already had and for the same reason: the
    // archive puts people mid-clause ("Tyler knows someone with a gutted
    // house"), so that is where a hallucinated one shows up.
    if (prev === undefined || /\n/.test(m[2]) || /[.!?:;–—-]/.test(prev)) continue;
    const w = norm(m[3]);
    if (!NOT_A_NAME.has(w)) out.add(w);
  }
  return out;
}

/** EVERY word in the source, case-folded. The draft legitimately capitalises
 *  things the notes do not -- ALL-CAPS emphasis, sentence starts, headings --
 *  so "Harp" must match the notes' "laser harp". Comparing capitals to capitals
 *  flagged ten ordinary words as invented names on the first real run. */
const vocabulary = src => new Set(
  (text(src).match(/\b[a-zA-Z'’-]{2,}\b/g) || []).map(norm)
);

/** Numbers that carry meaning: money, times, dates, counts. Deliberately not
 *  list ordinals: "1." is structure, not a claim about the world.
 *
 *  Two holes closed 2026-09-26, both found by grading a real draft. The old
 *  pattern ended in `\b`, so an ORDINAL DATE was invisible: "Sunday the 27th"
 *  yielded only the street number, because `7`/`t` is no word boundary. And a
 *  SPACED TIME was invisible too: "1 pm to turn up, 3 pm to work" yielded
 *  nothing at all, since the unit had to abut the digit. That made
 *  invented-figure, a FAIL-level check whose entire job is to stop a made-up
 *  date or time, blind to the date and both times of a day-before notice: the
 *  three facts the email exists to carry. `1 pm` normalises to `1pm` so a draft
 *  may respace what the notes wrote. */
const figures = src => new Set(
  (text(stripItemNumbers(src)).match(/(?<![.\d])\$?\d[\d,.:]*(?:\s?(?:ms|am|pm)|%|st|nd|rd|th)?\b/gi) || [])
    .map(n => n.toLowerCase().replace(/[.,]$/, '').replace(/\s+/, ''))
    .filter(n => !/^\d\.?$/.test(n))
);

/** Line-anchored list ordinals, removed before figures are read.
 *
 *  The comment above says ordinals are "deliberately not" figures, and the
 *  `!/^\d\.?$/` filter implements that for ONE digit only. A 13-item recap on
 *  2026-09-27 blocked on `invented-figure: 12` -- the twelfth item's own number.
 *  Every recap long enough to reach item 10 was unpostable, and the longer the
 *  digest the likelier it hit. Stripping at the line anchor is the same rule
 *  `itemNumbers` already uses to tell structure from prose. */
const stripItemNumbers = src => text(src).replace(/(^|\n)([ \t]*)-?\d+\.(\s)/g, '$1$2$3');

/** Anchored at a line start, like every comparable pattern in style.mjs. Without
 *  the anchor, "Doors at 8, show at 9. See you" read as item 9. */
const itemNumbers = src => (text(src).match(/(?:^|\n)\s*(-?\d+)\.\s/g) || [])
  .map(s => s.trim().replace(/\.$/, ''));

/** Words in the input that mean "I am not sure". If the notes hedge and the
 *  draft surfaces nothing as open, something was quietly resolved. */
const HEDGES = /\b(hazy|not recalled|not certain|unknown|not sure|unclear|not verified|scope not defined|may want|possible|floated|tbd)\b/i;

export function runChecks(d, notes, vault, opts = {}) {
  const out = [];
  const add = (level, id, msg) => out.push({ level, id, msg });

  // Which genre's form rules apply. These rates were all measured on the
  // 400-4000 char digest pool, and AEDILE_CONTEXT.headsup.md says in its own
  // text that they "do NOT transfer to the terse heads-up register": there a
  // sign-off is ~47% and optional, a greeting ~52%, numbering belongs to the
  // digest and not to a single-venue notice, and a one-line unsigned nudge
  // ("1pm tomorrow! 826 Rosedale") is an attested shape that this file used to
  // fail at blocking level. Default `recap` so every existing caller is
  // unchanged; a heads-up must ask for its own rules.
  const headsup = opts.genre === 'headsup';

  const body = d.body || '';
  const subject = d.subject || '';

  if (!subject) add('fail', 'subject', 'no subject');
  if (!body) add('fail', 'body', 'no body');
  if (!body || !subject) return out;

  // The subject is part of the draft and goes out with it, so it is graded too.
  // A test caught this: an invented date placed in the subject slipped through
  // a version of these checks that only read the body.
  // open_questions ship: post() appends them into the body that crosses the wire
  // (redige.mjs:281) and render() shows them to the reviewer, so they are part of
  // the email and are graded like the rest of it. They were not until 2026-09-27,
  // when a draft's "Still open" block read "Wednesday 10/25 or Sunday 10/29" --
  // an invented month (the notes say 11/25 or 11/29) with both weekdays wrong for
  // October -- and passed, because nothing looked at it. Exactly the subject bug
  // one comment down, one field over: text that goes out must be text that was
  // graded.
  const whole = [subject, body, ...(d.open_questions || [])].join('\n');

  // 1. No invented people. Every name in the draft must be in the input.
  const known = vocabulary(notes);
  // A hyphenated compound is grounded by its HEAD, not by the whole string.
  // Notes reading "Costco model for membership" and "Tang themed cocktail"
  // blocked two of three generations on 2026-09-27 as the invented names
  // `costco-style` and `tang-themed`: the proper noun was in the input and the
  // ordinary adjective after the hyphen never would be. This check exists to
  // catch a hallucinated PERSON, and no person is hiding in `-style`.
  const plain = w => known.has(w) || known.has(w.replace(/s$/, '')) || known.has(w + 's');
  const inInput = w => plain(w) || (w.includes('-') && plain(w.split('-')[0]));
  const invented = [...nameCandidates(whole)].filter(w => !inInput(w));
  if (invented.length) {
    add('fail', 'invented-name',
      `name(s) in the draft that are not in the input: ${invented.join(', ')}`);
  }

  // 1a-bis. The diagnostic register: engineering-critic vocabulary used as wit.
  //
  // Zach named one sentence on 2026-09-27 -- "(The tang is load-bearing.)" -- with
  // "instant fail on 'load-bearing'". Measured at STEM level over both populations,
  // 480 operator messages and 628 thread files: `bearing` 0, `canonic` 0,
  // `orthogonal` 0, `surface area` 0, `affordance` 0, `first-class` 0, `the point
  // is` 0, `the question is` 0. That is 0 of 1,108 documents, and the stems are
  // deliberately shorter than the phrases so the zero is not an artifact of the
  // pattern (the trap this file has fallen into before: "no X required" measured 0
  // only because the regex allowed one word before "required").
  //
  // NEAR-MISSES, which is why the list is stems and not phrases: `trivial` appears
  // once, as "however trivially" -- an ordinary adverb, so the pattern requires the
  // `non-` compound. `lot of work` appears twice and both are literal labour
  // ("let's do a lot of work then!"), so the pattern requires the metaphor "doing a
  // lot of work". Neither real instance fires.
  //
  // NOT a ban on the parenthetical aside, which is 62% of the archive and a dealt
  // device. The archive's asides carry a NAME and an exclamation ("Joseph is on
  // it!", "Koi fish building!") or a concrete consequence ("This is also how we
  // will get everyone to leave."). What it never carries is commentary ABOUT the
  // item in the vocabulary of someone reviewing it. Full-sentence capitalised
  // parentheticals are 2% in both populations, so the FORM is fine and the
  // CONTENTS were the finding. devices.mjs now says so in the instruction too.
  const CRITIC = [
    [/\bload[\s-]?bearing\b/i, 'load-bearing'],
    [/\bnon[\s-]?trivial\b/i, 'non-trivial'],
    [/\bcanonic(?:al|ally)?\b/i, 'canonical'],
    [/\borthogonal\b/i, 'orthogonal'],
    [/\bsurface area\b/i, 'surface area'],
    [/\baffordance/i, 'affordance'],
    [/\bfirst[\s-]class\b/i, 'first-class'],
    [/\bdoing a lot of (?:the )?work\b/i, 'doing a lot of work'],
    [/\bthe (?:real )?(?:point|question) is\b/i, 'the point/question is'],
  ];
  const critic = CRITIC.filter(([re]) => re.test(whole)).map(([, name]) => name);
  if (critic.length) {
    add('fail', 'critic-register',
      `engineering-critic vocabulary used as wit: ${critic.join(', ')}. 0 occurrences in `
      + '1,108 archived documents. An aside carries a name, an exclamation or a concrete '
      + 'consequence, not a verdict on the item it follows');
  }

  // 1a-ter. Oversubdivision: more items, each thinner, than the archive writes.
  //
  // Fires only when the caller passes the measured shape (`opts.shape` from
  // analysis/recap-form.mjs), the same way the day-word check fires only on
  // `opts.leadDays` -- so this file still runs with no corpus on the box, which is
  // what its own test suite does.
  //
  // WARN, not fail. A meeting really can have eight topics, and the archive's max
  // is 12, so the count alone is not an error. What is measurable is the pair: the
  // median recap is 5 items of 43 words, and a draft at 8 items of 31 is the same
  // material cut finer to look thorough. Blocking it would make the generator
  // merge items that do not belong together, which is worse prose than a long list.
  //
  // Wired on 2026-09-27 because the prompt block alone did not hold: with the
  // measured form in front of it the very next generation came back at 8 items of
  // 31 words. A rule with no backstop is a document.
  if (opts.shape && opts.shape.items && opts.shape.wordsPerItem) {
    const parts = body.split(/(?=(?:^|\n)\s*-?\d+(?:\.\d+)?[.)]\s)/)
      .filter(t => /^\s*-?\d+(?:\.\d+)?[.)]\s/.test(t));
    if (parts.length) {
      const per = parts.reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0) / parts.length;
      const tooMany = parts.length > opts.shape.items + 2;
      const tooThin = per < opts.shape.wordsPerItem * 0.75;
      if (tooMany && tooThin) {
        add('warn', 'oversubdivided',
          `${parts.length} items averaging ${Math.round(per)} words; the archive's median recap is `
          + `${opts.shape.items} items of ${opts.shape.wordsPerItem}. Merge related items rather than `
          + 'splitting the same material finer');
      }
    }
  }

  // 1a-quater. Owner-heavy: a recap that reads like a project tracker.
  //
  // The largest deviation measured on 2026-09-27, and the one nobody had a number
  // for. The archive names a person in ~25% of items and says who owes something in
  // ~8%. The drafts that night: 86-88% and 71-75%. A recap here reports what the
  // room settled; the owner list is what the action-items section of the NOTES is
  // for, and it does not transfer to the mail.
  //
  // The 25%/8% come from a hand-curated name list (see NAMES in
  // analysis/recap-form.mjs) because all three automatic sources on this box are
  // mangled. So the threshold is deliberately loose -- three times the measured
  // rate -- and warn-level. The finding survives every name set tried (3%, 25%,
  // 47% all far below 86%), which is what makes it quotable; the exact percentage
  // is not.
  if (opts.shape && opts.shape.ownerPct && opts.shape.names) {
    const parts = body.split(/(?=(?:^|\n)\s*-?\d+(?:\.\d+)?[.)]\s)/)
      .filter(t => /^\s*-?\d+(?:\.\d+)?[.)]\s/.test(t));
    const owner = new RegExp(`\\b(?:${opts.shape.names.join('|')})\\b`
      + '(?:\\s+\\w+){0,3}?\\s+(?:is|are|will|has|can|should|needs? to|volunteered|wants|said)\\b');
    if (parts.length >= 3) {
      const hits = parts.filter(t => owner.test(t)).length;
      const rate = Math.round(100 * hits / parts.length);
      // Both conditions, because either alone misfires. A rate test alone fires on
      // one owner in four items (25% against a 24% bar), which is an ordinary recap
      // sentence; a count test alone fires on 3 owners in a 20-item digest. The
      // finding is owner assignment being PERVASIVE, so it takes both.
      if (rate > opts.shape.ownerPct * 3 && hits >= 3) {
        // The message used to read "the owner list is what the notes are for", which
        // contradicts `## Names`: naming the person on a commitment is exactly what
        // the archive does and what the prompt asks for. The finding is that nearly
        // every item IS a commitment item, not that anyone was named.
        add('warn', 'owner-heavy',
          `${hits} of ${parts.length} items are commitment items with an owner (${rate}%); the archive `
          + `runs about ${opts.shape.ownerPct}%. Naming the person on a commitment is right -- having `
          + 'almost every item be one is the recap reading as a task tracker');
      }
    }
  }

  // 1a-quinquies. A weekday word that the calendar contradicts.
  //
  // THE WORST OUTPUT THIS FILE CAN EMIT, and for a recap nothing was watching it.
  // `temporal-mismatch` below only fires on opts.leadDays, which only a heads-up
  // supplies. On 2026-09-27, generated from Zach's real notes, the lead item read
  // "LASER HARP INTEGRATION DAY IS SATURDAY OCTOBER 11TH" in capitals. 2026-10-11
  // is a SUNDAY, the notes never said Saturday, and Tyler's own line in them says
  // "Sun 10/11". Every other check passed: no figure is invented (the 11th is in
  // the notes), no name, no em-dash. A weekday is not a figure, so nothing looked.
  //
  // MEASURED AGAINST THE ARCHIVE FIRST: 139 weekday+explicit-date pairs in
  // operator mail, 132 correct, 7 mismatched (5%). Those 7 are the operator's own
  // date errors -- "Sunday Dec 14" twice in 2024, when it was a Saturday -- and
  // that is the argument FOR blocking, not against. Unlike the em-dash, this is
  // not a style the archive has; it is a mistake the archive made and nobody
  // caught. A check that would also have caught a human's slip is working.
  //
  // Deliberately tight: the weekday and the date must be adjacent (whitespace, a
  // comma, or "the"). "Wednesday is October 14th" is not matched, and neither is
  // "Wednesday movie nights at Lucky's, so November 25th", which is the pair a
  // looser pattern would invent and fail on. A bare "Wednesday the 25th" carries
  // no month and is not resolvable, so it is left alone.
  if (opts.asOf) {
    // The calendar lives in dates.mjs, shared with the prompt block that tells the
    // model each date's real weekday. Two copies is how a check and a prompt come
    // to disagree about the same draft.
    const bad = weekdayPairs(text(whole), opts.asOf)
      .filter(p => p.claimed !== p.actual)
      .map(p => `"${p.text}" is a ${p.actual}`);
    if (bad.length) {
      add('fail', 'weekday-mismatch',
        `the weekday does not match the date: ${bad.join('; ')}. Telling the list the wrong day is `
        + 'the worst thing this email can do');
    }
  }

  // 1a-sexies. A member's email address in the body.
  //
  // Generated from the real notes, the draft published a member's personal address
  // in its first item because the notes list it beside that person's name. Grounded
  // in the input, so every invented-* check passed it.
  //
  // The archive is not silent here -- 11 of 573 operator messages contain an
  // address, and one publishes a member's deliberately: "you can also get it
  // delivered to Brandon. Just email him <address>". That one person was the
  // contact point for the thing being announced. So this is not "never" for a
  // human; it is "never for the generator", which has no consent signal and cannot
  // tell a contact point from a name that happened to be in the notes. Same
  // reasoning as invented-pronoun, which also blocks a thing the archive does 9% of
  // the time: naming the person instead always works, and the harm of guessing
  // wrong falls on a real member.
  //
  // The krewe's own list and account addresses are exempt -- those are public.
  const PUBLIC_ADDR = /@(?:googlegroups\.com|kreweofvaporwave\.com)$/i;
  const ADDR = /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi;
  const addrs = [...new Set((text(whole).match(ADDR) || []))].filter(a => !PUBLIC_ADDR.test(a));

  // The LOCAL PART on its own is still the handle, and dropping the domain does not
  // anonymise anyone. Given notes that read "Alex misterdee27@gmail.com", the draft
  // wrote "misterdee27 is available" -- the person's login, published to ~40 people,
  // in place of their name. The full-address pattern passed it. Only a local part
  // whose whole address is in the NOTES counts, so an ordinary word is never
  // mistaken for a handle.
  const handles = [...new Set((text(notes).match(ADDR) || []))]
    .filter(a => !PUBLIC_ADDR.test(a))
    .map(a => a.split('@')[0])
    .filter(h => h.length >= 4 && new RegExp(`\\b${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text(whole)));

  if (addrs.length || handles.length) {
    const what = addrs.length
      ? `a personal email address in the body: ${addrs.join(', ')}`
      : `a member's handle in the body: ${handles.join(', ')}`;
    add('fail', 'private-detail',
      `${what}. Name the person instead -- the list is ~40 people and the notes are not `
      + 'consent to publish it');
  }

  // 1a-septies. A person attached to an opinion, or described instead of worked with.
  //
  // NOT a new rule. AEDILE_CONTEXT.recap.md's `## Names` already says it, and says
  // it is the archive's own habit rather than an imposition: "Name someone when you
  // are attributing a commitment they made or a thing they own... Every one is a
  // person attached to a job. None is a person attached to an opinion, an
  // attendance record, or an assessment." `## What stays out` repeats it twice
  // ("Who held which opinion on the way to a decision", "Anything anyone said about
  // a person rather than about the work"). The prompt was ignored, twice, in one
  // draft generated from the real notes -- so this is purely the backstop half of
  // the loop, with the instruction already in place.
  //
  // MEASURED, both populations, 573 operator messages and 628 thread files:
  //   NAME + has doubts/thinks/feels/is skeptical/likes/concurs   0 and 0
  //   ANY of those verbs with NO name required                    0 and 0
  //   NAME within 6 words of a personal descriptor                0 and 0
  // The second line is what makes the first trustworthy: the zero is the register
  // being absent from this list, not my pattern being too narrow.
  //
  // THE NEAR-MISSES DECIDED BOTH PATTERNS, and neither survived its first draft:
  //   - A bare descriptor lexicon measures 4 and 5, and every instance is ordinary
  //     prose: "don't drive drunk", "a naked person, because painting and naked
  //     people go together", the author about themselves. Blocking those words
  //     would block the archive. Requiring a NAME nearby drops all nine and still
  //     catches "Tyler has seen this guy naked maybe once".
  //   - `said`/`says` is attested (2 and 3) and both carry a FACT, not an opinion:
  //     "Kevin says that the trailer will be ready to go on Saturday". So the
  //     opinion pattern excludes them; a commitment reported with a name is exactly
  //     what `## Names` asks for.
  //
  // Names come from the curated list plus whoever the notes actually mention, so
  // Chris, Daryll, Josh, Ruebin and Lester are covered without being hardcoded.
  {
    const people = [...new Set([...NAMES.map(n => n.toLowerCase()), ...nameCandidates(notes)])]
      .filter(n => /^[a-z][a-z'’-]{2,}$/.test(n))
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (people.length) {
      const N = `(?:${people.join('|')})`;
      const OPINION = new RegExp(
        `\\b${N}\\b\\s+(?:(?:has|had)\\s+(?:doubts|reservations|concerns|misgivings)`
        + `|thinks|feels|believes|reckons|suspects|likes|prefers|dislikes|hates|loves`
        + `|concurs|agrees|disagrees|objects`
        + `|is\\s+(?:skeptical|sceptical|worried|unsure|doubtful|nervous|against))\\b`, 'i');
      const DESC = '(?:naked|nudist|drunk|hungover|shirtless|stoned|wasted|creepy|lazy|flaky)';
      const PERSONAL = new RegExp(
        `\\b${N}\\b(?:\\W+\\w+){0,6}\\W+${DESC}\\b|\\b${DESC}\\b(?:\\W+\\w+){0,6}\\W+${N}\\b`, 'i');

      const op = text(whole).match(OPINION);
      if (op) {
        add('fail', 'opinion-attribution',
          `a person attached to an opinion: "${op[0]}". 0 occurrences in 1,201 archived documents, `
          + 'and `## Names` forbids it -- record the decision, not who held which view on the way to it');
      }
      const pd = text(whole).match(PERSONAL);
      if (pd) {
        add('fail', 'personal-not-work',
          `a person described rather than their work: "${pd[0].trim()}". \`## What stays out\`: `
          + 'anything anyone said about a person rather than about the work');
      }
    }
  }

  // 1b. No invented pronouns. A gendered third-person pronoun the input does not
  // supply is an invented fact about a real member, and the failure is not a style
  // tell but misgendering someone on a 40-person list.
  //
  // This is NOT a claim that the archive avoids them: 9% of messages use one, and
  // correctly, because the author knows the person ("Thanks to Kevin for his
  // patient tutelage"). The generator does not. Given notes reading "Alex's anime
  // people", it wrote "Alex will run later with HIS anime people" on 2026-09-26,
  // inventing a fact that no amount of good prose makes acceptable. Same shape as
  // invented-name and invented-figure, and blocking for the same reason: the input
  // is the only source of truth about people.
  //
  // `they/them/their` is always fine and needs no support: it is what the notes use
  // and what a writer who does not know should use.
  const PRONOUNS = /\b(?:he|him|his|she|her|hers)\b/gi;
  const inNotes = new Set((text(notes).match(PRONOUNS) || []).map(w => w.toLowerCase()));
  const inDraft = new Set((text(whole).match(PRONOUNS) || []).map(w => w.toLowerCase()));
  const unsupported = [...inDraft].filter(w => !inNotes.has(w));
  if (unsupported.length) {
    add('fail', 'invented-pronoun',
      `gendered pronoun(s) the input does not supply: ${unsupported.join(', ')}. Use the person's name, or they/them. Guessing misgenders a real member`);
  }

  // 1c. The day-word must match the computed lead time.
  //
  // `--as-of` exists so a nudge written the night before reads correctly on the
  // morning it is sent, and the prompt is handed the answer as a literal ("which
  // is TODAY. Lead time: 0 day(s)"). The generator wrote "TOMORROW, Sunday, 1pm"
  // anyway, in the subject as well, and every other check passed it: no figure is
  // invented, the date is real, the prose is fine. A notice that tells 40 people
  // the wrong day is the worst output this file can emit and it was the only one
  // with nothing watching it.
  //
  // Only fires when the caller supplies leadDays, so a recap is unaffected.
  if (typeof opts.leadDays === 'number') {
    const wrong = opts.leadDays === 0 ? /\btomorrow\b/i
      : opts.leadDays === 1 ? /\b(?:today|tonight)\b/i
      : /\b(?:today|tonight|tomorrow)\b/i;
    const hit = whole.match(wrong);
    if (hit) {
      add('fail', 'temporal-mismatch',
        `says "${hit[0]}" but the event is ${opts.leadDays} day(s) out from the send date`);
    }
  }

  // 2. No invented figures. Dates, money, times, counts.
  const knownFigures = figures(notes);
  const inventedFigures = [...figures(whole)].filter(n => !knownFigures.has(n));
  if (inventedFigures.length) {
    add('fail', 'invented-figure',
      `figure(s) in the draft not present in the input: ${inventedFigures.join(', ')}`);
  }

  // 3. What the meeting did not settle has to survive as an open question.
  if (!headsup && HEDGES.test(notes) && !(d.open_questions || []).length) {
    add('fail', 'swallowed-uncertainty',
      'the input hedges but the draft surfaces no open questions -- something was resolved that should not have been');
  }

  // 4. Form, from the archive: sign-off and numbering. The subject rule that
  //    used to live here is gone (#30) -- it enforced a scraper artifact, since
  //    the corpus has no subject field and the scraper built thread titles from
  //    body first lines. Nothing grades the subject's shape now, because nothing
  //    measured can: see AEDILE_CONTEXT.recap.md for the traits, taken from the
  //    live group listing rather than from the scrape.
  // The `<3` is DEALT now (devices.mjs `dealSignoff`), not mandatory: the
  // archive writes it above the initials in 74% of MS-signed messages and
  // writes `Best`, `xoxo`, a short line of its own, or nothing at all in the
  // rest. Requiring it here pinned the generator to one of six shapes. What is
  // not optional is the initials, and that they are SM.
  // A bare `<3` with no initials closes 0.4% of archived messages, and it is
  // what Zach signed by hand on 2026-09-07: `MS` borrows the other figure and
  // `SM` claims aedile's, so a heart alone keeps the register and claims
  // neither. The generator still signs `SM` -- devices.mjs deals only the line
  // ABOVE it -- but a draft a human closed with a heart is not malformed, and
  // the previous version of this check rejected exactly that.
  const lastLine = body.trimEnd().split('\n').pop().trim();
  if (!/^(?:(?:<3[ \t]*)+|(?:<3[ \t]*)*SM)$/.test(lastLine)) {
    // Blocking for a digest, advisory for a heads-up: the terse register signs
    // ~47% of the time and the barest attested nudge is a single unsigned line.
    add(headsup ? 'warn' : 'fail', 'sign-off',
      `the last line must be \`<3\`, the initials \`SM\`, or both; got ${JSON.stringify(lastLine)}`);
  }
  if (/\bMS\b/.test(body.replace(/<3\s*SM/g, ''))) {
    add('fail', 'signed-as-ms', 'signed or referred to as MS -- aedile is SM, and must not borrow the other figure');
  }

  // The em-dash is the strongest single tell measured. Two exist in the 164
  // archived messages of this length; the generator put them in 3 of 12 and a
  // human reading the duel named it unprompted as "the AI trademark". Also the
  // spaced `--`, which the archive never uses at all.
  if (/[—–]/.test(whole) || /(?:^|\s)--(?:\s|$)/.test(whole)) {
    add('fail', 'em-dash',
      'contains an em-dash or a spaced `--`; the archive has two in 164 messages, and it reads as machine-written on sight');
  }

  // Tells named by a human reading a real draft, then measured. Zach, 2026-09-26,
  // on "No tools and no skills needed for that part, just hands and a reaction":
  // "still sounds slightly AI... especially corny". Both patterns below come out
  // of that one sentence pair, and they are NOT the same finding: one has zero
  // support in the corpus and one has a single real instance that differs from the
  // draft in a way no regex can see.

  // Three or more clauses opening with the same function word inside one
  // sentence: "what feels wrong, what lags, what you expected to happen and did
  // not". 0 of 480 MS messages. That is a stronger absence than the em-dash,
  // which has one. Blocking, like the em-dash, because it is cheap to reword and
  // a human is asked before anything is posted.
  if (/\b(what|that|how|where|who|whether)\b[^,.!?;:]{2,60},\s*\1\b[^,.!?;:]{2,60},\s*(?:and\s+|or\s+)?\1\b/i.test(whole)) {
    add('fail', 'parallel-clauses',
      'three or more clauses opening with the same word in one sentence; 0 of 480 archived messages do this, and it is the shape a human named as sounding machine-written');
  }

  // Unasked reassurance: "no tools and no skills needed". 1 of 480, and that one
  // is "No tech knowledge required, just grit and grind. Hustle and flow." The
  // template is not the problem; what the archive puts after it is CONCRETE and
  // usually joking (projectors and speakers, you and a camera, grit and grind),
  // where the draft put an abstraction ("a reaction"). A regex cannot grade
  // concreteness, so this warns and names the distinction rather than blocking on
  // a shape the archive does use.
  if (/\bno (?:[a-z]+ ){0,2}[a-z]+ (?:needed|required|necessary)\b/i.test(whole)) {
    add('warn', 'unasked-reassurance',
      'reassures the reader that nothing is needed; 1 of 480 archived messages does this ("No tech knowledge required, just grit and grind"), and that one names concrete things where a generated one names abstractions');
  }

  // 92% of comparable archived messages carry at least one, averaging 3.5. The
  // generator averaged 0.7 and only two thirds had any. Warn: a short, sober
  // logistics note can legitimately have none.
  // Also a length rate, not a house rule. Measured MS-authored: 49% at <=150
  // chars, 69% at 150-300, 82% at 400-1000, 97% at 1000-2000. The 92% below is
  // the digest band. Fourth instance of a digest
  // rate applied to the terse register, after numberedList, the blank-line gap and
  // the spacing checks.
  // The population matters more than the length. Among ANNOUNCEMENTS at lead 0-1
  // day (pre-2025, the messages this genre imitates) the rate is 93% at 150-400
  // chars, 94% at 400-1000 and 95% above, and only below 150 chars does it fall, to
  // 60% on n=5 with a CI of [23,88] -- a sample that cannot resolve anything. The
  // earlier 49%-at-150-chars figure was measured over ALL operator messages of any
  // kind, which is the wrong population: a two-line "the door code is 1234" is not
  // an announcement. So the exemption is now 150 chars, not 300.
  //
  // This comment used to justify the exemption with "the real Half Moon nudge has no
  // `!` at all". That message was aedile's own (five recap_draft_posted Log rows,
  // 2026-09-14T02:29-02:35Z), so it is evidence about the generator and not about the
  // list. The rates above are measured over the archive and do not depend on it.
  if (!/!/.test(body) && !(headsup && body.length <= 150)) {
    add('warn', 'no-exclamation',
      'no exclamation mark; 93-95% of the operator\'s day-before announcements carry at least one');
  }

  // Numbering is NOT checked for a heads-up, and that is deliberate. It measures
  // 44% of the operator's day-before Sunday messages with a CI of [25, 66]: a
  // coin-flip, dealt by devices.mjs at that rate. A `numbered-headsup` warn lived
  // here briefly, written off AEDILE_CONTEXT.headsup.md's claim that "a
  // single-venue heads-up should not be numbered", and it fired on drafts whose own
  // dealt hand had told them to number. A device the dealer owns must not also be
  // graded here, or the two halves of the generator disagree about the same draft.
  const bodyItems = itemNumbers(body);
  // ...and then this did it anyway for the recap genre. `numberedList` is dealt at
  // p=0.82, so about one recap in five is told "Do NOT number anything. Write it as
  // prose" -- and was then warned at for obeying. Zach, 2026-09-27: "following the
  // deal?" It was; the check was grading the dealer's own decision. Silent when the
  // hand dealt numbering OFF, and unchanged when no hand was supplied.
  if (!headsup && !bodyItems.length && opts.hand?.numberedList !== false) {
    add('warn', 'no-numbering', 'no numbered items -- the archive numbers almost everything');
  }

  // A numbered item is a TOPIC, not a label. Measured over all 1125 numbered items
  // in the operator's pre-2025 messages: median 43 words, and the short tail is
  // 8 items under 5 words (0.7%) and 35 at 5-9 (3.1%). So a hard floor at ten would
  // reject real items; the tiers below follow the distribution instead.
  //
  // The failure this catches: a draft numbered two clock times as "1. 1pm: sausages
  // and taters." / "2. 3pm: build session." -- 4 and 3 words -- and passed every
  // check, because numbering had been measured as a boolean and nobody had asked
  // what an item CONTAINS. The traits were proxies and the proxies got satisfied.
  const itemWords = body.split(/(?=(?:^|\n)\s*-?\d+\.\s)/)
    .filter(x => /^\s*-?\d+\.\s/.test(x))
    .map(x => (x.trim().match(/\S+/g) || []).length);
  const tiny = itemWords.filter(n => n < 5);
  const short = itemWords.filter(n => n >= 5 && n < 10);
  if (tiny.length) {
    add('fail', 'stub-items',
      `${tiny.length} numbered item(s) of ${tiny.join(', ')} words. 8 of 1125 archived items are that short (0.7%); the median is 43. Give each item real content or do not number at all`);
  } else if (short.length) {
    add('warn', 'thin-items',
      `${short.length} numbered item(s) of ${short.join(', ')} words, against a median of 43. Attested but rare (3.1%): check each one is a topic and not a label`);
  }

  // Did the draft follow the hand it was dealt? This is NOT a rate check -- rates
  // belong to the dealer. It is instruction-following: a device dealt ON that does
  // not appear means the draw did nothing, and the whole point of dealing is that
  // the frequency comes out right across many emails. `greeting` was dealt ON and
  // absent from the output with nothing to notice.
  if (opts.hand) {
    const seen = {
      greeting: /^\s*(hi|hello|hey|hiya|yo|good (morning|evening|afternoon)|greetings|dear|friends|happy|ok|okay)\b/i.test(body),
      numberedList: /(?:^|\n)\s*-?\d+\.\s/.test(body),
      allCaps: /\b[A-Z]{4,}\b/.test(body),
      question: /\?/.test(body),
    };
    const ignored = Object.keys(seen).filter(k => opts.hand[k] === true && !seen[k]);
    if (ignored.length) {
      add('warn', 'hand-ignored',
        `dealt but absent: ${ignored.join(', ')}. The draw is how a corpus frequency gets reproduced across emails; ignoring it pins the rate at zero`);
    }
  }

  // 5. Motifs the corpus says are near-universal. Warn only: a short recap
  //    legitimately might not shout, and the counts are of THREADS not of
  //    obligations.
  // The vault's own count for this motif is 622 of 628 threads, which is a
  // broken detector -- its three example snippets ("Hi   throws: 8640 Nelson
  // Street...", "Good job, everyone!...") contain no ALL-CAPS at all. Measured
  // over messages.jsonl the real rate is 40%. The check is still worth firing;
  // quoting the vault's number at the operator was repeating a fabrication, so
  // it now cites the measured figure instead.
  // Same deal-vs-check conflict as no-numbering above: allCaps is dealt, so a draft
  // told not to shout must not be warned for not shouting.
  if (!headsup && vault?.motifs?.['all-caps-emphasis'] && !/\b[A-Z]{4,}\b/.test(body)
      && opts.hand?.allCaps !== false) {
    add('warn', 'no-caps',
      'no ALL-CAPS emphasis; 40% of the archive\'s messages carry it');
  }

  // Ragged paragraph spacing -- two to four blank lines between items, not one.
  // 93% of comparable archived messages have it (152 of the 164 that are
  // 400-4000 chars and signed). Uniform single spacing is the most reliable
  // way for a generated recap to look generated. Warn, not fail: a three-item
  // recap can legitimately be too short to show the pattern.
  if (headsup) {
    // Skipped, not passed. Both spacing checks are calibrated on the 400-4000
    // char pool; a terse notice has too few gaps to have a modal one at all, and
    // `modalGap` returns 0 when there are none, so grading it here reports a
    // shape problem that is really a length difference.
  } else if (!isRagged(body)) {
    add('warn', 'uniform-spacing',
      'single blank lines throughout; 93% of the archive is ragged (2-4 blank lines between items)');
  } else if (modalGap(body) < 2) {
    // Ragged SOMEWHERE is not the trait. The archive's usual gap is three blank
    // lines (54% of gaps) and one blank line is only 11%; a draft whose default
    // is a single blank line reads wrong on every paragraph even though it has
    // one wide gap somewhere to satisfy the check above.
    add('warn', 'tight-default-spacing',
      `usual gap is ${modalGap(body)} blank line(s); the archive's usual gap is 3`);
  }

  // 6. Confidence must be honest about a reconstructed input.
  if (/reconstructed|from memory|recording failed/i.test(notes) && d.confidence !== 'low') {
    add('fail', 'overconfident',
      'the input says it is reconstructed or that the recording failed, but confidence is not "low"');
  }

  return out;
}

export function report(findings) {
  if (!findings.length) {
    console.error('-- checks: all clear');
    return;
  }
  for (const f of findings) {
    console.error(`-- ${f.level === 'fail' ? 'FAIL' : 'warn'}  ${f.id}: ${f.msg}`);
  }
  const fails = findings.filter(f => f.level === 'fail').length;
  console.error(`-- checks: ${fails} blocking, ${findings.length - fails} warning`);
}
