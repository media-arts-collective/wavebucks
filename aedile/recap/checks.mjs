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
  (text(src).match(/(?<![.\d])\$?\d[\d,.:]*(?:\s?(?:ms|am|pm)|%|st|nd|rd|th)?\b/gi) || [])
    .map(n => n.toLowerCase().replace(/[.,]$/, '').replace(/\s+/, ''))
    .filter(n => !/^\d\.?$/.test(n))
);

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
  const whole = `${subject}\n${body}`;

  // 1. No invented people. Every name in the draft must be in the input.
  const known = vocabulary(notes);
  const inInput = w => known.has(w) || known.has(w.replace(/s$/, '')) || known.has(w + 's');
  const invented = [...nameCandidates(whole)].filter(w => !inInput(w));
  if (invented.length) {
    add('fail', 'invented-name',
      `name(s) in the draft that are not in the input: ${invented.join(', ')}`);
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
  // the digest band. The real Half Moon nudge ("Half Moon tonight, kitchen opens
  // at 5... Bring a buddy") has no `!` at all, so warning on a two-line notice
  // reports the length difference as a voice problem. Fourth instance of a digest
  // rate applied to the terse register, after numberedList, the blank-line gap and
  // the spacing checks.
  // The population matters more than the length. Among ANNOUNCEMENTS at lead 0-1
  // day (pre-2025, the messages this genre imitates) the rate is 93% at 150-400
  // chars, 94% at 400-1000 and 95% above, and only below 150 chars does it fall, to
  // 60% on n=5 with a CI of [23,88] -- a sample that cannot resolve anything. The
  // earlier 49%-at-150-chars figure was measured over ALL operator messages of any
  // kind, which is the wrong population: a two-line "the door code is 1234" is not
  // an announcement. So the exemption is now 150 chars, not 300.
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
  if (!headsup && !bodyItems.length) {
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
  if (!headsup && vault?.motifs?.['all-caps-emphasis'] && !/\b[A-Z]{4,}\b/.test(body)) {
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
