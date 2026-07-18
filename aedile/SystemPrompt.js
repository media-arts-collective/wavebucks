/**
 * SystemPrompt.js
 * Assembles Aedile's system prompts by concatenating the shared core
 * context (Context.js) with each tier's task-specific context. Triage now
 * splits into two variants — AEDILE_SYSTEM_PROMPT_LIST for broadcast list
 * traffic, AEDILE_SYSTEM_PROMPT_DM for narrowly-addressed messages — see
 * InboxProcessor.classifyAudience for how a message picks one. The bump
 * tier (BumpChecker's checkBumps) doesn't split this way (yet). A prior
 * consolidation tier (a third prompt judging cross-thread Shard
 * membership) was retired in favor of injecting the raw message log
 * directly — see MessageLog.js and aedile/CLAUDE.md.
 */

const AEDILE_SYSTEM_PROMPT_LIST = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_TRIAGE_LIST}`;
const AEDILE_SYSTEM_PROMPT_DM = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_TRIAGE_DM}`;
const AEDILE_BUMP_PROMPT = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_BUMP}`;
