// aedile/brain/model.test.mjs -- offline unit tests: no model call, no network,
// no ANTHROPIC_API_KEY.
// Run: node --test aedile/brain/model.test.mjs
// The live subscription path is covered by `node brain/model.mjs --smoke`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDecision, callModel, getJsonDecision } from './model.mjs';

test('parseDecision: clean JSON object', () => {
  assert.deepEqual(parseDecision('{"action":"draft_reply","open_loop":false}'), {
    action: 'draft_reply',
    open_loop: false,
  });
});

test('parseDecision: ```json-fenced blob', () => {
  const fenced = '```json\n{"ok":true,"n":2}\n```';
  assert.deepEqual(parseDecision(fenced), { ok: true, n: 2 });
});

test('parseDecision: bare ```-fenced blob (no json tag)', () => {
  assert.deepEqual(parseDecision('```\n{"ok":true}\n```'), { ok: true });
});

test('parseDecision: preamble prose then {...}', () => {
  const messy = 'Sure! Here is the decision:\n{"action":"flag","reason":"needs a director"} — hope that helps';
  assert.deepEqual(parseDecision(messy), { action: 'flag', reason: 'needs a director' });
});

test('parseDecision: throws on non-JSON, with truncated raw', () => {
  assert.throws(
    () => parseDecision('this is not json at all'),
    /model response was not valid JSON/,
  );
});

test('parseDecision: throws on empty string', () => {
  assert.throws(() => parseDecision(''), /not valid JSON/);
});

// The body arrives with real line breaks where \n belongs. Recovered, with the breaks intact.
test('parseDecision: recovers raw newlines inside a string literal', () => {
  const d = parseDecision('{"subject":"wings 10/14","body":"Hi all,\n\n\n1. Wing Wednesday.\n"}');
  assert.equal(d.subject, 'wings 10/14');
  assert.equal(d.body, 'Hi all,\n\n\n1. Wing Wednesday.\n');
});

// The repair must not touch an already-escaped newline: a draft whose body is
// legal JSON round-trips byte for byte.
test('parseDecision: an already-escaped newline is untouched', () => {
  const body = 'line one\nline two';
  const d = parseDecision(JSON.stringify({ body }));
  assert.equal(d.body, body);
});

// Still loud. The repair is one narrow rule, not a JSON fixer: a missing brace
// is not recoverable and must not be silently invented.
test('parseDecision: still throws on structurally broken JSON', () => {
  assert.throws(() => parseDecision('{"subject":"a","body":"b"'), /not valid JSON/);
});

test('module exports the seam functions', () => {
  assert.equal(typeof getJsonDecision, 'function');
  assert.equal(typeof callModel, 'function');
  assert.equal(typeof parseDecision, 'function');
});
