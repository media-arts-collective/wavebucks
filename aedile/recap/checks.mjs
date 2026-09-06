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
  const re = /([^\s])?\s+([A-Z][a-z][a-zA-Z'’-]*)\b/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const prev = m[1];
    if (prev === undefined || /[.!?:;–—-]/.test(prev)) continue; // sentence start
    const w = norm(m[2]);
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
 *  list ordinals -- "1." is structure, not a claim about the world. */
const figures = src => new Set(
  (text(src).match(/(?<![.\d])\$?\d[\d,.:]*(?:ms|am|pm|%)?\b/gi) || [])
    .map(n => n.toLowerCase().replace(/[.,]$/, ''))
    .filter(n => !/^\d\.?$/.test(n))
);

const itemNumbers = src => (text(src).match(/(?:^|\s)(-?\d+)\.\s/g) || [])
  .map(s => s.trim().replace(/\.$/, ''));

/** Words in the input that mean "I am not sure". If the notes hedge and the
 *  draft surfaces nothing as open, something was quietly resolved. */
const HEDGES = /\b(hazy|not recalled|not certain|unknown|not sure|unclear|not verified|scope not defined|may want|possible|floated|tbd)\b/i;

export function runChecks(d, notes, vault) {
  const out = [];
  const add = (level, id, msg) => out.push({ level, id, msg });

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

  // 2. No invented figures. Dates, money, times, counts.
  const knownFigures = figures(notes);
  const inventedFigures = [...figures(whole)].filter(n => !knownFigures.has(n));
  if (inventedFigures.length) {
    add('fail', 'invented-figure',
      `figure(s) in the draft not present in the input: ${inventedFigures.join(', ')}`);
  }

  // 3. What the meeting did not settle has to survive as an open question.
  if (HEDGES.test(notes) && !(d.open_questions || []).length) {
    add('fail', 'swallowed-uncertainty',
      'the input hedges but the draft surfaces no open questions -- something was resolved that should not have been');
  }

  // 4. Form, from the archive. Sign-off, numbering, and the subject being the
  //    body's opening rather than a separate summary of it.
  if (!/<3\s*SM\b/.test(body)) {
    add('fail', 'sign-off', 'missing the `<3 SM` sign-off');
  }
  if (/\bMS\b/.test(body.replace(/<3\s*SM/g, ''))) {
    add('fail', 'signed-as-ms', 'signed or referred to as MS -- aedile is SM, and must not borrow the other figure');
  }

  const bodyItems = itemNumbers(body);
  const subjectItems = itemNumbers(subject);
  if (!bodyItems.length) {
    add('warn', 'no-numbering', 'no numbered items -- the archive numbers almost everything');
  }
  const orphan = subjectItems.filter(n => !bodyItems.includes(n));
  if (orphan.length) {
    add('fail', 'subject-body-mismatch',
      `subject numbers item(s) ${orphan.join(', ')} that the body does not -- the subject is the body's opening, not a separate summary`);
  }

  // 5. Motifs the corpus says are near-universal. Warn only: a short recap
  //    legitimately might not shout, and the counts are of THREADS not of
  //    obligations.
  if (vault?.motifs?.['all-caps-emphasis'] && !/\b[A-Z]{4,}\b/.test(body)) {
    add('warn', 'no-caps',
      `no ALL-CAPS emphasis; the corpus carries it in ${vault.motifs['all-caps-emphasis']} threads`);
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
