// aedile/recap/execClient.test.mjs
// Offline unit tests -- no network, no real curl invocation (opts.post/opts.sleep
// are faked). Run: node --test aedile/recap/execClient.test.mjs
//
// Covers the retry loop the flake in #54 needs: a transient non-JSON echo
// recovers on a later attempt, a transport error recovers the same way, and
// exhausting attempts throws with the last failure's reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeJson, postExec } from './execClient.mjs';

const noSleep = async () => {};

test('looksLikeJson: object and array bodies', () => {
  assert.equal(looksLikeJson('{"ok":true}'), true);
  assert.equal(looksLikeJson('  \n{"ok":true}\n'), true);
  assert.equal(looksLikeJson('[1,2,3]'), true);
});

test('looksLikeJson: the flake\'s HTML echo', () => {
  assert.equal(looksLikeJson('<html><body>Unable to open the file.</body></html>'), false);
  assert.equal(looksLikeJson(''), false);
});

test('postExec: succeeds on the first attempt', async () => {
  let calls = 0;
  const post = () => { calls += 1; return '{"ok":true,"result":{}}'; };
  const res = await postExec('https://example/exec', 'a=1', { post, sleep: noSleep });
  assert.deepEqual(res, { ok: true, result: {} });
  assert.equal(calls, 1);
});

test('postExec: recovers from the HTML-echo flake on a later attempt', async () => {
  let calls = 0;
  const post = () => {
    calls += 1;
    if (calls < 3) return '<html>unable to open the file</html>';
    return '{"ok":true}';
  };
  const res = await postExec('https://example/exec', 'a=1', { post, sleep: noSleep });
  assert.deepEqual(res, { ok: true });
  assert.equal(calls, 3);
});

test('postExec: recovers from a transport error on a later attempt', async () => {
  let calls = 0;
  const post = () => {
    calls += 1;
    if (calls < 2) throw new Error('curl: (28) timed out');
    return '{"ok":true}';
  };
  const res = await postExec('https://example/exec', 'a=1', { post, sleep: noSleep });
  assert.deepEqual(res, { ok: true });
  assert.equal(calls, 2);
});

test('postExec: throws after exhausting attempts, naming the last failure', async () => {
  let calls = 0;
  const post = () => { calls += 1; return '<html>sign in</html>'; };
  await assert.rejects(
    postExec('https://example/exec', 'a=1', { post, sleep: noSleep, attempts: 4 }),
    /not JSON/,
  );
  assert.equal(calls, 4);
});

test('postExec: a well-formed JSON error body is returned, not retried', async () => {
  let calls = 0;
  const post = () => { calls += 1; return '{"ok":false,"error":"bad token"}'; };
  const res = await postExec('https://example/exec', 'a=1', { post, sleep: noSleep });
  assert.deepEqual(res, { ok: false, error: 'bad token' });
  assert.equal(calls, 1);
});
