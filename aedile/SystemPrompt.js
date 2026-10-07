// SystemPrompt.js -- assembles the system prompts: the shared core context
// (Context.js) plus each tier's task context. Triage and bump each split into
// _LIST and _DM variants; see InboxProcessor.classifyAudience.

// Globals are re-evaluated on every execution, so flipping TESTING_MODE takes
// effect on the next run with no redeploy.
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
const AEDILE_BUMP_PROMPT_LIST = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_BUMP_LIST}${_testingOverride()}`;
const AEDILE_BUMP_PROMPT_DM = `${AEDILE_CONTEXT_CORE}\n\n${AEDILE_CONTEXT_BUMP_DM}${_testingOverride()}`;
