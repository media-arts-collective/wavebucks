/**
 * recap-assembly.test.mjs -- the DELIVERED recap still ends with the sign-off.
 *
 *   node --test aedile/recap/recap-assembly.test.mjs     (also runs under `npm test`)
 *
 * WHY THIS TEST AND NOT A CHECK. `checks.mjs` grades what `redige.mjs` produced, and it
 * is positional about the sign-off -- the LAST LINE must be `<3`, `SM` or both. It still
 * could not catch #23, because `MeetingRecap.appendOpenQuestions` runs afterwards, in
 * Apps Script, on the far side of the wire: every recap with open questions shipped with
 * seven bullets after `<3 SM` and `runChecks` returned `[]` on it. A witness looking at
 * the wrong object reports healthy, which is #22's shape as well.
 *
 * So this grades the assembled string, which is the only artifact nobody was grading.
 *
 * It reads the function out of `MeetingRecap.js` and evaluates just that function. That
 * file is Apps Script and cannot be imported -- but `appendOpenQuestions` touches no
 * Google service, so extracting it is honest rather than a re-implementation. The repo's
 * standing trap is a local copy of logic drifting from the real module (see
 * scribaSenatus/TestsLocal.js's warning); taking the source text means there is no copy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AEDILE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The real function, lifted from the real file. */
function loadAppendOpenQuestions() {
  const src = readFileSync(join(AEDILE, 'MeetingRecap.js'), 'utf8');
  const start = src.indexOf('function appendOpenQuestions');
  assert.ok(start !== -1, 'appendOpenQuestions not found in MeetingRecap.js');
  // Brace-match to the end of the function, so the extraction survives edits inside it.
  let depth = 0, i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(from + 1, i);
  return new Function('body', 'openQuestions', body);
}

const append = loadAppendOpenQuestions();
const SIGNOFF_LINE = /^(?:(?:<3[ \t]*)+|(?:<3[ \t]*)*SM)$/;
const lastLineOf = s => s.trimEnd().split('\n').pop().trim();
const QS = ['Is the weekly social actually on Wednesday?', "What 'make the website more useful' means."];

test('one-line sign-off stays last, and the questions arrive above it', () => {
  const out = append('We talked about the harps.\n\n<3 SM', QS);
  assert.match(lastLineOf(out), SIGNOFF_LINE, `delivered recap must end with the sign-off; got ${JSON.stringify(lastLineOf(out))}`);
  assert.ok(out.includes('Still open:'), 'the open questions must survive into the body');
  assert.ok(out.indexOf('Still open:') < out.indexOf('<3 SM'), 'the questions belong ABOVE the sign-off');
  for (const q of QS) assert.ok(out.includes(q), `question dropped: ${q}`);
});

test('two-line sign-off is kept together and stays last', () => {
  // `<3` then `SM` on its own line is attested and checks.mjs accepts it, so the
  // assembly must not split the pair or leave `SM` orphaned above the bullets.
  const out = append('We talked about the harps.\n\n<3\nSM', QS);
  assert.equal(out.trimEnd().split('\n').slice(-2).map(l => l.trim()).join('\n'), '<3\nSM');
  assert.ok(out.indexOf('Still open:') < out.indexOf('<3'), 'the questions belong above the sign-off');
});

test('no open questions leaves the body untouched', () => {
  const body = 'We talked about the harps.\n\n<3 SM';
  assert.equal(append(body, []), body);
  assert.equal(append(body, null), body);
  assert.equal(append(body, undefined), body);
});

test('a body with no sign-off appends rather than inventing a position', () => {
  // Nothing to protect. checks.mjs fails this draft separately; the sink must not
  // silently rearrange a body whose shape it does not recognise.
  const out = append('We talked about the harps.', QS);
  assert.ok(out.startsWith('We talked about the harps.'));
  assert.ok(out.includes('Still open:'));
});

test('trailing blank lines do not strand the sign-off', () => {
  const out = append('We talked about the harps.\n\n<3 SM\n\n\n', QS);
  assert.match(lastLineOf(out), SIGNOFF_LINE);
  assert.ok(!/\n{3,}/.test(out), 'no run of three or more newlines should be introduced');
});
