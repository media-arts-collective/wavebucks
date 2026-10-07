// clasp-user.test.mjs -- every `clasp` command in aedile/ needs `-u aedile`.
//
//   node --test aedile/recap/clasp-user.test.mjs
//
// `~/.clasprc.json` holds several named token sets and clasp falls back to
// `default` in silence when `-u` is omitted. `default` is a director's account,
// right for scribaSenatus and wavebucksCore; aedile is the exception.
// Reads the credential file only to compare an email claim. No token is logged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AEDILE_ACCOUNT = 'kreweofvaporwave@kreweofvaporwave.com';
const CLASPRC = join(homedir(), '.clasprc.json');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The email claim out of a JWT id_token. Signature not checked: it is our own local file.
function accountOf(idToken) {
  const payload = String(idToken).split('.')[1];
  if (!payload) return null;
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json).email ?? null;
}

test('the aedile clasp profile exists and is the krewe account', () => {
  if (!existsSync(CLASPRC)) {
    // No clasp login at all is not the bug; a login in the wrong shape is.
    // Loud either way: this prints, it does not pass quietly.
    console.error(`-- SKIP: no ${CLASPRC}. Run: clasp login -u aedile`);
    return;
  }
  const tokens = JSON.parse(readFileSync(CLASPRC, 'utf8')).tokens ?? {};
  assert.ok(tokens.aedile,
    `~/.clasprc.json has no "aedile" profile (found: ${Object.keys(tokens).join(', ') || 'none'}). `
    + 'Run: clasp login -u aedile, as ' + AEDILE_ACCOUNT);
  assert.equal(accountOf(tokens.aedile.id_token), AEDILE_ACCOUNT,
    'the "aedile" profile is authorized as the wrong account');
});

test('the default profile is NOT the krewe account, so -u aedile is load-bearing', () => {
  if (!existsSync(CLASPRC)) return;
  const tokens = JSON.parse(readFileSync(CLASPRC, 'utf8')).tokens ?? {};
  if (!tokens.default) return;
  // If this fails, `default` was repointed at the krewe account, which changes
  // the identity scribaSenatus and wavebucksCore are pushed as.
  assert.notEqual(accountOf(tokens.default.id_token), AEDILE_ACCOUNT,
    'clasp `default` is now the krewe account; scribaSenatus and wavebucksCore '
    + 'push as `default` too, so confirm that is intended and update this test');
});

test('.claude/settings.json does not auto-allow a clasp command without -u aedile', () => {
  const policy = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'));
  const allow = policy.permissions?.allow ?? [];
  // A rule like `Bash(clasp push:*)` blesses the flagless form; requiring the
  // flag in the rule makes the wrong invocation prompt a human.
  const blessed = allow.filter(r => /^Bash\(clasp (?!-u aedile)/.test(r));
  assert.deepEqual(blessed, [],
    'these allow rules match a clasp command with no `-u aedile`: ' + blessed.join(', '));
});
