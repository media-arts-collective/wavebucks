/**
 * AnthropicClient.js
 * Thin wrapper around the Claude Messages API, shared by every Aedile tier
 * that needs a model call — InboxProcessor's per-message triage today,
 * ConsolidationProcessor's per-thread shard matching as of Change 3.
 * Centralizes the endpoint, the markdown-fence cleanup the model
 * occasionally adds despite instructions, and JSON parsing, so each tier
 * differs only in system prompt and user content.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

const AnthropicClient = (() => {

  /**
   * Calls the Messages API and returns the parsed JSON object the model
   * returned. Throws on missing API key, transport/non-200 error, or
   * invalid JSON — callers decide how to log/handle failure per their own
   * row shape (InboxProcessor and ConsolidationProcessor log to different
   * tabs with different columns).
   */
  function getJsonDecision(systemPrompt, userContent, maxTokens = 1000) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY script property.');

    const response = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      payload: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      }),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`Anthropic API returned ${response.getResponseCode()}: ${response.getContentText()}`);
    }

    const rawText = JSON.parse(response.getContentText()).content[0].text;

    // The model occasionally wraps its JSON in a markdown code fence despite
    // being told not to. Strip that before parsing — best-effort, not a guarantee.
    const cleanedText = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    try {
      return JSON.parse(cleanedText);
    } catch (err) {
      throw new Error(`Model response was not valid JSON. Raw: ${rawText} | Cleaned: ${cleanedText}`);
    }
  }

  return { getJsonDecision };
})();
