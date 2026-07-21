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

// Apps Script re-evaluates globals on every execution, so this reads the
// current TESTING_MODE property at prompt-assembly time each run — flipping
// the property takes effect on the next trigger/scan with no redeploy.
function _testingOverride() {
  try {
    return PropertiesService.getScriptProperties().getProperty('TESTING_MODE') === 'true'
      ? `\n\n${AEDILE_CONTEXT_TESTING}`
      : '';
  } catch (err) {
    return ''; // fail closed to normal (non-testing) behavior
  }
}

const AEDILE_SYSTEM_PROMPT_LIST = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_TRIAGE_LIST}${_testingOverride()}`;
const AEDILE_SYSTEM_PROMPT_DM = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_TRIAGE_DM}${_testingOverride()}`;
const AEDILE_BUMP_PROMPT = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_BUMP}${_testingOverride()}`;
