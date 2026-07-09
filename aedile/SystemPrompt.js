/**
 * SystemPrompt.js
 * Assembles the system prompt for each Aedile tier by concatenating the
 * shared core context (Context.js) with that tier's task-specific context.
 * Two tiers today: triage (InboxProcessor's per-message scanInbox) and
 * consolidation (ConsolidationProcessor's daily consolidateShards).
 */

const AEDILE_SYSTEM_PROMPT = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_TRIAGE}`;
const AEDILE_CONSOLIDATION_PROMPT = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_CONSOLIDATION}`;
