// aedile/recap/execClient.mjs
//
// Thin retry-wrapping client for aedile's Web App `/exec` endpoint (#54).
//
// `/exec` answers a POST with a 302 to a googleusercontent.com echo URL, and
// that echo intermittently serves Google's "unable to open the file" HTML
// (or a sign-in page) instead of the action's JSON -- not a bug in the
// redirect-following itself (curl -L already follows it correctly), just a
// flake in what the far end serves. The known workaround is retrying the
// whole request; every programmatic caller (redige.mjs, call.sh, future
// Node-side agents) was growing its own copy of that workaround, so it lives
// here once instead.
//
// No -X POST: it would pin the method across the redirect and turn a retry
// into a re-GET with an empty body, which Google answers with a sign-in
// page that reads exactly like a missing version cut and is not one.
// --data-binary alone already means POST.

import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const DEFAULT_ATTEMPTS = Number(process.env.AEDILE_EXEC_ATTEMPTS || 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The flake's tell: an HTML echo page where JSON was expected. Anything
 *  that doesn't even start like JSON is presumed to be one of these, not
 *  malformed JSON worth giving up on immediately. */
export function looksLikeJson(raw) {
  const t = String(raw).trim();
  return t.startsWith('{') || t.startsWith('[');
}

function curlPost(url, form, timeoutMs) {
  const bodyFile = `/tmp/aedile-exec-${process.pid}.form`;
  // A token on argv is readable out of /proc by any local account for as
  // long as curl runs -- same reasoning redige.mjs's post() and call.sh
  // already followed; this is where it now lives.
  writeFileSync(bodyFile, form, { mode: 0o600 });
  try {
    return execFileSync('curl', ['-sfL', '--max-time', String(Math.ceil(timeoutMs / 1000)), url,
      '-H', 'Content-Type: application/x-www-form-urlencoded',
      '--data-binary', `@${bodyFile}`],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } finally {
    rmSync(bodyFile, { force: true });
  }
}

/** POST a URL-encoded form body to `url`, retrying through the 302-echo
 *  flake described above. Returns the parsed JSON response; throws after
 *  `attempts` tries (transport failure, or a persistently non-JSON body).
 *
 *  `opts.post`/`opts.sleep` override the transport/backoff -- tests inject
 *  fakes to exercise the retry loop without a real curl/network round trip
 *  or a real wait. */
export async function postExec(url, form, opts = {}) {
  const { attempts = DEFAULT_ATTEMPTS, timeoutMs = 120_000, post = curlPost, sleep: sleepFn = sleep } = opts;
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const raw = post(url, form, timeoutMs);
      if (looksLikeJson(raw)) return JSON.parse(raw);
      lastError = new Error(`the sink answered with something that is not JSON:\n${String(raw).slice(0, 300)}`);
    } catch (err) {
      lastError = new Error(`the sink did not answer: ${err.message}`);
    }
    if (i < attempts) await sleepFn(Math.min(i * 500, 5000));
  }
  throw lastError;
}
