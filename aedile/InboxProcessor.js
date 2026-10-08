// InboxProcessor.js -- who is on a thread, and whether a send to them may
// proceed. WriteApi.js's send and draft primitives call this; nothing here
// reads the inbox or calls a model. Triage is aedile/brain/triage.mjs.

// Both default to off, so sending is opt-in and fails closed to draft-only.
const AUTOSEND_ENABLED_PROPERTY = 'AUTOSEND_ENABLED';
// Comma-separated full addresses or "@domain" suffixes. Must include every
// address expected on a sendable thread, including Aedile's own inbox
// address: there is no self-detection.
const AUTOSEND_ALLOWLIST_PROPERTY = 'AUTOSEND_ALLOWLIST';

const InboxProcessor = (function () {

  function getAutosendAllowlist() {
    const raw = PropertiesService.getScriptProperties().getProperty(AUTOSEND_ALLOWLIST_PROPERTY) || '';
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  function matchesAllowlist(address, allowlist) {
    const addr = address.toLowerCase();
    return allowlist.some(entry => entry.startsWith('@') ? addr.endsWith(entry) : addr === entry);
  }

  // The LAST bracketed group, not the first: the real address follows the
  // display name, so a display name containing `<someone@allowlisted>` must not
  // decide the allowlist check.
  function extractEmail(header) {
    const matches = String(header).match(/<([^<>]+)>/g);
    const last = matches && matches[matches.length - 1];
    return (last ? last.slice(1, -1) : header).toLowerCase().trim();
  }

  // Every From/To/Cc address across every message, lowercased and deduped: the
  // full participant set, broader than what replyAll() addresses. Shared by the
  // eligibility check and recipient completion so the two cannot disagree.
  function getThreadParticipants(thread) {
    const participants = new Set();
    thread.getMessages().forEach(m => {
      participants.add(extractEmail(m.getFrom()));
      (m.getTo() || '').split(',').forEach(a => a.trim() && participants.add(extractEmail(a)));
      (m.getCc() || '').split(',').forEach(a => a.trim() && participants.add(extractEmail(a)));
    });
    return Array.from(participants);
  }

  // True only when every participant on the thread matches AUTOSEND_ALLOWLIST and
  // AUTOSEND_ENABLED is on; one participant outside it refuses the thread.
  function isAllowlistEligible(thread) {
    if (PropertiesService.getScriptProperties().getProperty(AUTOSEND_ENABLED_PROPERTY) !== 'true') return false;

    const allowlist = getAutosendAllowlist();
    if (!allowlist.length) return false;

    return getThreadParticipants(thread).every(addr => matchesAllowlist(addr, allowlist));
  }

  // replyAll()/createDraftReply() address only the last message's recipients,
  // but eligibility covers the whole thread. Pass the full participant set
  // (minus this account) as an explicit `cc` so nobody is silently dropped.
  function getRecipientCompletion(thread) {
    const self = Session.getEffectiveUser().getEmail().toLowerCase();
    return getThreadParticipants(thread).filter(addr => addr !== self).join(',');
  }

  return { extractEmail, isAllowlistEligible, getRecipientCompletion };
})();

/** Kill switch on — sets the Script Property the send primitives check */
function enableAedile() {
  PropertiesService.getScriptProperties().setProperty('AEDILE_ENABLED', 'true');
  Logger.log('✅ Aedile enabled.');
}

/** Kill switch off — either director can run this from the editor, no code changes needed */
function disableAedile() {
  PropertiesService.getScriptProperties().setProperty('AEDILE_ENABLED', 'false');
  Logger.log('⏸️ Aedile disabled.');
}
