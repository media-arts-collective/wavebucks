// checks.mjs -- checks run over the generated draft, not as prompt instructions.
// level 'fail' blocks posting; 'warn' is reported and does not.

import { isRagged, modalGap } from './normalize.mjs';
import { weekdayPairs, dateNumerals } from './dates.mjs';
import { NAMES } from '../analysis/recap-form.mjs';

const NOT_A_NAME = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'we', 'i', 'it', 'this', 'that',
  'there', 'here', 'they', 'them', 'our', 'us', 'you', 'your', 'he', 'she',
  'krewe', 'friends', 'still', 'open', 'no', 'yes', 'not', 'nobody', 'everyone',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'sm', 'ms', 'tl', 'dr', 'vhs', 'dns', 'github', 'u', 'haul', 'uhaul',
]);

const text = s => String(s || '');

const norm = w => w.toLowerCase().replace(/[’']s$/, '');

// Candidate names: words capitalised mid-sentence. Sentence starts, ALL-CAPS
// emphasis and the word after a list ordinal are not names.
function nameCandidates(src) {
  const body = text(src);
  const out = new Set();
  const re = /([^\s])?(\s+)([A-Z][a-z][a-zA-Z'’-]*)\b/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const prev = m[1];
    // A line start is a sentence start: subjects carry no terminal period.
    if (prev === undefined || /\n/.test(m[2]) || /[.!?:;–—-]/.test(prev)) continue;
    const w = norm(m[3]);
    if (!NOT_A_NAME.has(w)) out.add(w);
  }
  return out;
}

// Every word in the source, case-folded: the draft capitalises words the notes do not.
const vocabulary = src => new Set(
  (text(src).match(/\b[a-zA-Z'’-]{2,}\b/g) || []).map(norm)
);

// Numbers that carry meaning: money, times, dates, counts. Not list ordinals.
const figures = src => new Set(
  (text(stripItemNumbers(src)).match(/(?<![.\d])\$?\d[\d,.:]*(?:\s?(?:ms|am|pm)|%|st|nd|rd|th)?\b/gi) || [])
    .map(n => n.toLowerCase().replace(/[.,]$/, '').replace(/\s+/, ''))
    .filter(n => !/^\d\.?$/.test(n))
);

const stripItemNumbers = src => text(src).replace(/(^|\n)([ \t]*)-?\d+\.(\s)/g, '$1$2$3');

// Anchored at a line start, or "show at 9. See you" reads as item 9.
const itemNumbers = src => (text(src).match(/(?:^|\n)\s*(-?\d+)\.\s/g) || [])
  .map(s => s.trim().replace(/\.$/, ''));

/** Words in the input that mean "I am not sure". If the notes hedge and the
 *  draft surfaces nothing as open, something was quietly resolved. */
const HEDGES = /\b(hazy|not recalled|not certain|unknown|not sure|unclear|not verified|scope not defined|may want|possible|floated|tbd)\b/i;

export function runChecks(d, notes, vault, opts = {}) {
  const out = [];
  const add = (level, id, msg) => out.push({ level, id, msg });

  const headsup = opts.genre === 'headsup';
  // A `reminder` is one DM: digest form rules relax; grounding checks (invented
  // name/figure/pronoun, weekday, date), the em-dash and never borrowing MS do not.
  const dm = opts.genre === 'reminder';
  const digest = !headsup && !dm;

  const body = d.body || '';
  const subject = d.subject || '';

  if (!subject) add('fail', 'subject', 'no subject');
  if (!body) add('fail', 'body', 'no body');
  if (!body || !subject) return out;

  // Subject and open_questions go out with the draft, so they are graded too.
  const whole = [subject, body, ...(d.open_questions || [])].join('\n');

  const known = vocabulary(notes);
  // A hyphenated compound is grounded by its head ("costco-style").
  const plain = w => known.has(w) || known.has(w.replace(/s$/, '')) || known.has(w + 's');
  const inInput = w => plain(w) || (w.includes('-') && plain(w.split('-')[0]));
  const invented = [...nameCandidates(whole)].filter(w => !inInput(w));
  if (invented.length) {
    add('fail', 'invented-name',
      `name(s) in the draft that are not in the input: ${invented.join(', ')}`);
  }

  // 1a-bis. Engineering-critic vocabulary used as wit. Stems, not phrases:
  // `non-` and "doing a lot of work" are required so ordinary uses do not fire.
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

  // Warn, not fail: blocking would make the generator merge items that do not belong together.
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

  // Hand-curated name list, so the threshold is loose and warn-level.
  if (opts.shape && opts.shape.ownerPct && opts.shape.names) {
    const parts = body.split(/(?=(?:^|\n)\s*-?\d+(?:\.\d+)?[.)]\s)/)
      .filter(t => /^\s*-?\d+(?:\.\d+)?[.)]\s/.test(t));
    const owner = new RegExp(`\\b(?:${opts.shape.names.join('|')})\\b`
      + '(?:\\s+\\w+){0,3}?\\s+(?:is|are|will|has|can|should|needs? to|volunteered|wants|said)\\b');
    if (parts.length >= 3) {
      const hits = parts.filter(t => owner.test(t)).length;
      const rate = Math.round(100 * hits / parts.length);
      // Both conditions: either alone misfires on an ordinary recap.
      if (rate > opts.shape.ownerPct * 3 && hits >= 3) {
        add('warn', 'owner-heavy',
          `${hits} of ${parts.length} items are commitment items with an owner (${rate}%); the archive `
          + `runs about ${opts.shape.ownerPct}%. Naming the person on a commitment is right -- having `
          + 'almost every item be one is the recap reading as a task tracker');
      }
    }
  }

  // Tight on purpose: weekday and date must be adjacent, and a date with no
  // month is not resolvable.
  if (opts.asOf) {
    const bad = weekdayPairs(text(whole), opts.asOf)
      .filter(p => p.claimed !== p.actual)
      .map(p => `"${p.text}" is a ${p.actual}`);
    if (bad.length) {
      add('fail', 'weekday-mismatch',
        `the weekday does not match the date: ${bad.join('; ')}. Telling the list the wrong day is `
        + 'the worst thing this email can do');
    }
  }

  // The generator has no consent signal, so it never publishes a member's
  // address; the krewe's own list and account addresses are public.
  const PUBLIC_ADDR = /@(?:googlegroups\.com|kreweofvaporwave\.com)$/i;
  const ADDR = /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi;
  const addrs = [...new Set((text(whole).match(ADDR) || []))].filter(a => !PUBLIC_ADDR.test(a));

  // The local part alone is still the handle. Only a local part whose whole
  // address is in the notes counts, so an ordinary word is never mistaken for one.
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

  // Descriptors need a name nearby, or ordinary prose would block. `said`/`says`
  // is excluded: it reports a fact, not an opinion.
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

  // The locution followed by an address passes. `you know where` is excluded:
  // an ask, not an assertion.
  const VAGUE_PLACE = /\b(?:the usual (?:spot|place|location|venue)|same (?:place|address|spot|location)|as last time|where we (?:always|usually) (?:meet|go))\b/i;
  const vague = text(whole).match(VAGUE_PLACE);
  if (vague) {
    const after = text(whole).slice(vague.index, vague.index + 80);
    if (!/\b\d{2,5}\s+[A-Z][a-z]/.test(after)) {
      add('fail', 'vague-location',
        `"${vague[0]}" asserts a place without naming one. The archive's own version names it in `
        + 'the same breath ("Same place! 8640 Nelson"); with no address in the notes, say so '
        + 'plainly instead');
    }
  }

  // 1b. No invented pronouns. A gendered pronoun the input does not supply is an
  // invented fact about a real member: never guess. `they/them/their` is always fine.
  const PRONOUNS = /\b(?:he|him|his|she|her|hers)\b/gi;
  const inNotes = new Set((text(notes).match(PRONOUNS) || []).map(w => w.toLowerCase()));
  const inDraft = new Set((text(whole).match(PRONOUNS) || []).map(w => w.toLowerCase()));
  const unsupported = [...inDraft].filter(w => !inNotes.has(w));
  if (unsupported.length) {
    add('fail', 'invented-pronoun',
      `gendered pronoun(s) the input does not supply: ${unsupported.join(', ')}. Use the person's name, or they/them. Guessing misgenders a real member`);
  }

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

  // A date restated in another format is the same fact: a numeral is forgiven
  // only when it belongs to a date that resolves to a day the notes name.
  const graceful = dateNumerals(whole, notes, opts.asOf || new Date());
  const knownFigures = figures(notes);
  const inventedFigures = [...figures(whole)]
    .filter(n => !knownFigures.has(n) && !graceful.has(n));
  if (inventedFigures.length) {
    add('fail', 'invented-figure',
      `figure(s) in the draft not present in the input: ${inventedFigures.join(', ')}`);
  }

  if (digest && HEDGES.test(notes) && !(d.open_questions || []).length) {
    add('fail', 'swallowed-uncertainty',
      'the input hedges but the draft surfaces no open questions -- something was resolved that should not have been');
  }

  // The `<3` is dealt, not mandatory. The initials must be SM; a bare `<3` is also valid.
  const lastLine = body.trimEnd().split('\n').pop().trim();
  if (!/^(?:(?:<3[ \t]*)+|(?:<3[ \t]*)*SM)$/.test(lastLine)) {
    add(digest ? 'fail' : 'warn', 'sign-off',
      `the last line must be \`<3\`, the initials \`SM\`, or both; got ${JSON.stringify(lastLine)}`);
  }
  if (/\bMS\b/.test(body.replace(/<3\s*SM/g, ''))) {
    add('fail', 'signed-as-ms', 'signed or referred to as MS -- aedile is SM, and must not borrow the other figure');
  }

  if (/[—–]/.test(whole) || /(?:^|\s)--(?:\s|$)/.test(whole)) {
    add('fail', 'em-dash',
      'contains an em-dash or a spaced `--`; the archive has two in 164 messages, and it reads as machine-written on sight');
  }

  if (/\b(what|that|how|where|who|whether)\b[^,.!?;:]{2,60},\s*\1\b[^,.!?;:]{2,60},\s*(?:and\s+|or\s+)?\1\b/i.test(whole)) {
    add('fail', 'parallel-clauses',
      'three or more clauses opening with the same word in one sentence; 0 of 480 archived messages do this, and it is the shape a human named as sounding machine-written');
  }

  // Unasked reassurance. Warns, not blocks: the archive uses the shape with
  // concrete things after it, and a regex cannot grade concreteness.
  if (/\bno (?:[a-z]+ ){0,2}[a-z]+ (?:needed|required|necessary)\b/i.test(whole)) {
    add('warn', 'unasked-reassurance',
      'reassures the reader that nothing is needed; 1 of 480 archived messages does this ("No tech knowledge required, just grit and grind"), and that one names concrete things where a generated one names abstractions');
  }

  if (digest ? !/!/.test(body) : (headsup && !/!/.test(body) && body.length > 150)) {
    add('warn', 'no-exclamation',
      'no exclamation mark; 93-95% of the operator\'s day-before announcements carry at least one');
  }

  // Numbering is not checked for a heads-up: devices.mjs deals it, and a dealt
  // device must not also be graded here.
  const bodyItems = itemNumbers(body);
  if (digest && !bodyItems.length && opts.hand?.numberedList !== false) {
    add('warn', 'no-numbering', 'no numbered items -- the archive numbers almost everything');
  }

  const itemWords = body.split(/(?=(?:^|\n)\s*-?\d+\.\s)/)
    .filter(x => /^\s*-?\d+\.\s/.test(x))
    .map(x => (x.trim().match(/\S+/g) || []).length);
  // A reminder is exempt: in a DM the items are the task list.
  const tiny = dm ? [] : itemWords.filter(n => n < 5);
  const short = dm ? [] : itemWords.filter(n => n >= 5 && n < 10);
  if (tiny.length) {
    add('fail', 'stub-items',
      `${tiny.length} numbered item(s) of ${tiny.join(', ')} words. 8 of 1125 archived items are that short (0.7%); the median is 43. Give each item real content or do not number at all`);
  } else if (short.length) {
    add('warn', 'thin-items',
      `${short.length} numbered item(s) of ${short.join(', ')} words, against a median of 43. Attested but rare (3.1%): check each one is a topic and not a label`);
  }

  // Instruction-following, not a rate check: a device dealt on must appear.
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

  // allCaps is dealt, so a draft told not to shout is not warned.
  if (digest && vault?.motifs?.['all-caps-emphasis'] && !/\b[A-Z]{4,}\b/.test(body)
      && opts.hand?.allCaps !== false) {
    add('warn', 'no-caps',
      'no ALL-CAPS emphasis; 40% of the archive\'s messages carry it');
  }

  if (!digest) {
    // Skipped, not passed: the spacing checks are calibrated on the digest.
  } else if (!isRagged(body)) {
    add('warn', 'uniform-spacing',
      'single blank lines throughout; 93% of the archive is ragged (2-4 blank lines between items)');
  } else if (modalGap(body) < 2) {
    // Ragged somewhere is not the trait: the default gap must be wide.
    add('warn', 'tight-default-spacing',
      `usual gap is ${modalGap(body)} blank line(s); the archive's usual gap is 3`);
  }

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
