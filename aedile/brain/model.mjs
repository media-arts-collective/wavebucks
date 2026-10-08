// aedile/brain/model.mjs -- Node model client: drives Claude through the Agent
// SDK on the krewe's own subscription token and returns a parsed JSON decision.
// No ANTHROPIC_API_KEY, and never the CLI login of whoever runs it.
// Node-only: excluded from Apps Script by aedile/.claspignore (`brain/**`).
// Smoke: node brain/model.mjs --smoke

import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The secrets file call.sh reads. Only the file: a token already in the
// caller's environment is somebody's login, and which one is not knowable here.
function oauthToken() {
  const file = process.env.AEDILE_SECRETS
    || [join(process.env.HOME || '', '.config/aedile/api-secrets'), '/srv/vaporwave-reports/aedile/.aedile-api-secrets']
      .find(f => existsSync(f));
  const m = file && readFileSync(file, 'utf8').match(/^CLAUDE_CODE_OAUTH_TOKEN=(.+)$/m);
  if (!m) throw new Error(`no CLAUDE_CODE_OAUTH_TOKEN in ${file || 'any secrets file'}`);
  return m[1].replace(/["'\r]/g, '');
}

const DEFAULT_ATTEMPTS = Number(process.env.AEDILE_MODEL_ATTEMPTS || 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Strip an optional ```json fence, extract the outermost {...}, then
// JSON.parse. Throws with a truncated raw on failure.
export function parseDecision(text) {
  const raw = String(text);
  let cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  if (!cleaned.startsWith('{')) {
    const from = cleaned.indexOf('{');
    const to = cleaned.lastIndexOf('}');
    if (from > -1 && to > from) cleaned = cleaned.slice(from, to + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // One deterministic repair after a strict parse fails: a literal newline
    // inside a string literal, which has exactly one legal meaning. Not a general
    // JSON fixer: if the result still does not parse, the original failure surfaces.
    try {
      return JSON.parse(escapeControlsInStrings(cleaned));
    } catch {
      throw new Error(`model response was not valid JSON.\n--- raw ---\n${raw.slice(0, 800)}`);
    }
  }
}

// Escape raw newlines/tabs/CRs inside a JSON string literal; already-escaped
// sequences and control characters between tokens are left alone.
function escapeControlsInStrings(src) {
  const ESC = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
  let out = '', inString = false, escaped = false;
  for (const ch of src) {
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    out += inString && ESC[ch] ? ESC[ch] : ch;
  }
  return out;
}

// Callers once passed a numeric maxTokens third; this transport has no such
// knob, so a number is tolerated and ignored.
function normalizeOpts(opts) {
  if (opts == null) return {};
  if (typeof opts === 'number') return {}; // legacy positional maxTokens: no transport equivalent
  return opts;
}

// One SDK round-trip. allowedTools:[] + maxTurns:1: a JSON decision must not
// run tools or loop.
async function runQuery(systemPrompt, userContent, { model, timeoutMs }) {
  const options = {
    systemPrompt: String(systemPrompt),
    allowedTools: [],
    maxTurns: 1,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  };
  if (model) options.model = model;

  // The SDK's child process inherits this.
  process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken();

  let timer;
  if (timeoutMs) {
    const ac = new AbortController();
    options.abortController = ac;
    timer = setTimeout(() => ac.abort(), timeoutMs);
  }

  // Prefer the terminal `result` message's `.result`; fall back to accumulated
  // assistant text. A non-success result throws.
  let assistantText = '';
  let resultText = null;
  let resultError = null;

  try {
    for await (const message of query({ prompt: String(userContent), options })) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block && typeof block === 'object' && typeof block.text === 'string') {
            assistantText += block.text;
          }
        }
      } else if (message.type === 'result') {
        if (message.is_error || message.subtype !== 'success') {
          resultError = new Error(`model returned error result: ${message.subtype}`);
        } else if (typeof message.result === 'string') {
          resultText = message.result;
        }
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (resultError) throw resultError;
  const out = (resultText ?? assistantText).trim();
  if (!out) throw new Error('model returned no text');
  return out;
}

// callModel(systemPrompt, userContent, opts?) -> Promise<string>
// opts: { model?, attempts?, timeoutMs? }. Throws on failure, never process.exit.
export async function callModel(systemPrompt, userContent, opts) {
  const { model, attempts = DEFAULT_ATTEMPTS, timeoutMs } = normalizeOpts(opts);
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await runQuery(systemPrompt, userContent, { model, timeoutMs });
    } catch (err) {
      lastError = err;
      const why = String(err?.message || err).trim().split('\n')[0];
      if (i === attempts) break;
      console.error(`-- aedile/model: attempt ${i} failed (${why}); retrying`);
      await sleep(i * 5000);
    }
  }
  const why = String(lastError?.message || lastError).trim().split('\n')[0];
  throw new Error(`model call failed ${attempts}x -- ${why}`);
}

// getJsonDecision(systemPrompt, userContent, opts?) -> Promise<object>
export async function getJsonDecision(systemPrompt, userContent, opts) {
  return parseDecision(await callModel(systemPrompt, userContent, opts));
}

// --- CLI smoke: `node brain/model.mjs --smoke` ---
// Fails loud if the parsed object isn't {ok:true}. process.exitCode, not
// process.exit, so stdio flushes.
async function smoke() {
  const decision = await getJsonDecision(
    'Return only compact JSON. No prose, no code fences.',
    'Reply with {"ok":true}',
  );
  if (decision?.ok !== true) {
    console.error('SMOKE FAIL: expected {ok:true}, got', JSON.stringify(decision));
    process.exitCode = 1;
    return;
  }
  console.log('SMOKE OK:', JSON.stringify(decision));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--smoke') {
    smoke().catch((err) => {
      console.error('SMOKE FAIL:', err?.message || err);
      process.exitCode = 1;
    });
  } else {
    console.error('usage: node brain/model.mjs --smoke');
    process.exitCode = 2;
  }
}
