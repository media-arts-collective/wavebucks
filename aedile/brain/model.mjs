// aedile/brain/model.mjs
//
// Milestone-2 brain component B2 (issue #40): a reusable Node model client that
// drives Claude via the *Claude subscription* — the locally logged-in `claude`
// CLI's OAuth credentials (~/.claude/.credentials.json) — and returns a parsed
// JSON decision. No ANTHROPIC_API_KEY: that metered key is out of credit and
// won't be topped up (#48), which is the whole reason this exists.
//
// It generalizes the model seam that lives three places today:
//   - AnthropicClient.getJsonDecision()  (Apps Script; UrlFetchApp -> api.anthropic.com)
//   - recap/redige.mjs callModel/callModelAsync/parseDecision  (CLI/curl shell-out)
// and mirrors the Apps Script seam's name + arg order (systemPrompt, userContent,
// third arg) so the tiers (#41 recap, #42, #43) swap onto it unchanged.
//
// Transport: the Claude Agent SDK (@anthropic-ai/claude-agent-sdk), which spawns
// the same `claude` CLI redige already shells out to, but behind a typed API.
// Verified on this box (svc-vaporwave, SDK 0.1.77, claude 2.1.216): a single-shot
// query() with ANTHROPIC_API_KEY unset authenticates via the ambient subscription
// credentials and returns text — no key path is taken.
//
// Node-only (ESM, node_modules). It must never reach Apps Script — see
// aedile/.claspignore (`brain/**`), same precedent as analysis/** and holon_fold.py.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'node:url';

// Attempts default. Own namespace (not redige's REDIGE_ATTEMPTS) since this is
// the brain's client, not the recap CLI.
const DEFAULT_ATTEMPTS = Number(process.env.AEDILE_MODEL_ATTEMPTS || 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Port of redige.mjs's parseDecision, verbatim in behavior: strip an optional
// ```json ... ``` fence, extract the outermost {...} when there's a preamble,
// then JSON.parse. Throws with a truncated raw on failure — never returns junk.
// Exported so redige/duel/judge's duplicates can later collapse onto this one.
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
    throw new Error(`model response was not valid JSON.\n--- raw ---\n${raw.slice(0, 800)}`);
  }
}

// Seam-compat with AnthropicClient.getJsonDecision(systemPrompt, userContent,
// maxTokens = 1000): its third arg is a numeric maxTokens (the recap call site
// passes RECAP_MAX_TOKENS). The subscription/CLI transport has no max-tokens
// knob, so a numeric third arg is tolerated for arg-order compatibility and has
// no effect — documented here rather than silently coerced somewhere downstream.
function normalizeOpts(opts) {
  if (opts == null) return {};
  if (typeof opts === 'number') return {}; // legacy positional maxTokens: no transport equivalent
  return opts;
}

// One SDK round-trip. allowedTools:[] + maxTurns:1 are load-bearing: a JSON
// decision must not run tools or loop. permissionMode/bypass is belt-and-
// suspenders — with no tools there's nothing to gate — and matches the SDK's
// documented contract (bypassPermissions pairs with allowDangerouslySkipPermissions).
async function runQuery(systemPrompt, userContent, { model, timeoutMs }) {
  const options = {
    systemPrompt: String(systemPrompt),
    allowedTools: [],
    maxTurns: 1,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  };
  if (model) options.model = model;

  let timer;
  if (timeoutMs) {
    const ac = new AbortController();
    options.abortController = ac;
    timer = setTimeout(() => ac.abort(), timeoutMs);
  }

  // Message stream is system -> assistant -> result. Prefer the terminal
  // `result` message's `.result` string; fall back to accumulated assistant
  // text blocks. A non-success result (is_error / error subtype) throws.
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
// opts: { model?, attempts?, timeoutMs? }. Async; throws on failure — never
// process.exit (that was a redige-CLI convenience). Retry/backoff ported from
// callModelAsync: linear i*5s backoff, `attempts` tries, then throw.
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
// Same name + arg order as AnthropicClient.getJsonDecision — the cut line in the
// brain migration — so #41/#42/#43 call it unchanged.
export async function getJsonDecision(systemPrompt, userContent, opts) {
  return parseDecision(await callModel(systemPrompt, userContent, opts));
}

// --- CLI smoke: `node brain/model.mjs --smoke` ------------------------------
// Proves the live subscription path end to end. Fails loud (non-zero exit) if
// the parsed object isn't {ok:true}. Uses process.exitCode, not process.exit,
// so stdio flushes.
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
