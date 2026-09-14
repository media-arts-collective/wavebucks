// aedile/brain/model.test.mjs
// Offline unit tests — no model call, no network, no ANTHROPIC_API_KEY.
// Run: node --test aedile/brain/model.test.mjs
//
// Covers parseDecision's four contract cases (the ported redige guard) plus the
// module's exported shape. The live subscription path is covered separately by
// `node brain/model.mjs --smoke`, which is intentionally not a unit test.

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

test('module exports the seam functions', () => {
  assert.equal(typeof getJsonDecision, 'function');
  assert.equal(typeof callModel, 'function');
  assert.equal(typeof parseDecision, 'function');
});
