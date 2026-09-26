/**
 * clasp-user.test.mjs -- every `clasp` command in aedile/ needs `-u aedile`.
 *
 *   node --test aedile/recap/clasp-user.test.mjs     (also runs under `npm test`)
 *
 * This is a predicate, not a paragraph. The fact it tests was written in prose
 * three times and lost three times, because the credential lives outside the repo
 * and nothing in the repo referenced it. Zach, 2026-09-26: "how do we keep the
 * clasp confusion from recurring? a predicate test? because that as annoying."
 *
 * The trap: `~/.clasprc.json` holds SEVERAL named token sets, and clasp 3.3.0
 * falls back to `default` in silence when `-u` is omitted. Here `default` is a
 * director's personal account and `aedile` is the krewe Workspace account that
 * owns this project, so a forgotten flag acts as the wrong identity and mostly
 * WORKS -- a director has edit access, so `clasp push` succeeds. The only thing
 * that fails is `clasp deploy`, with "Only users in the same domain as the script
 * owner may deploy this script", which reads like a missing permission and is not
 * one. That is the whole confusion, and it cost a session.
 *
 * `default` cannot simply be repointed: scribaSenatus and wavebucksCore are
 * separate script IDs in this same monorepo and the director account is the right
 * one for them. aedile is the exception, which is exactly why it needs a test.
 *
 * Reads the credential file only to compare an email claim. No token is logged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AEDILE_ACCOUNT = 'kreweofvaporwave@kreweofvaporwave.com';
const CLASPRC = join(homedir(), '.clasprc.json');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The email claim out of a JWT id_token. Payload only; the signature is not
 *  checked because we are reading our own local file, not trusting a caller. */
function accountOf(idToken) {
  const payload = String(idToken).split('.')[1];
  if (!payload) return null;
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json).email ?? null;
}

test('the aedile clasp profile exists and is the krewe account', () => {
  if (!existsSync(CLASPRC)) {
    // No clasp login at all on this machine is a different situation from a
    // login in the wrong shape, and only the second one is a bug. Loud either
    // way: this prints, it does not pass quietly.
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
  // If this ever fails, someone repointed `default` at the krewe account. That is
  // not automatically wrong, but it silently changes which identity
  // scribaSenatus and wavebucksCore get pushed as, so it should be a decision
  // rather than a surprise.
  assert.notEqual(accountOf(tokens.default.id_token), AEDILE_ACCOUNT,
    'clasp `default` is now the krewe account; scribaSenatus and wavebucksCore '
    + 'push as `default` too, so confirm that is intended and update this test');
});

test('.claude/settings.json does not auto-allow a clasp command without -u aedile', () => {
  const policy = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'));
  const allow = policy.permissions?.allow ?? [];
  // A rule like `Bash(clasp push:*)` matches the footgun form and blesses it for
  // unattended runs. Requiring the flag in the rule itself means the wrong
  // invocation prompts a human instead of silently acting as a director.
  const blessed = allow.filter(r => /^Bash\(clasp (?!-u aedile)/.test(r));
  assert.deepEqual(blessed, [],
    'these allow rules match a clasp command with no `-u aedile`: ' + blessed.join(', '));
});
