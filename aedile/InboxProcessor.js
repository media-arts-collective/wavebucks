/**
 * InboxProcessor.js
 * Inbox scanner for Aedile. Looks at recent unread mail, asks Claude
 * whether each message needs a response, and — if so — creates a Gmail
 * draft reply. Never sends automatically and never marks a message read.
 */

const AEDILE_REVIEWED_LABEL = 'aedile-reviewed';
// Dedup is by message ID (Config.isMessageProcessed), not by this label — the label is thread-level
// and permanent, so filtering the search on it would hide a thread forever after its first review,
// even once a brand-new unread reply lands on it later. It's applied to threads purely as a visual
// marker for human eyes in the inbox.
const AEDILE_FLAGGED_LABEL = 'aedile-flagged';
// Applied when the model's decision is "flag" — a thread that needs a director's judgment call.
// Without this, "flag" would be indistinguishable from "no_action" except in the Log tab.
const SCAN_QUERY = `in:inbox is:unread newer_than:14d`;
const MAX_MESSAGES_PER_RUN = 20;

const InboxProcessor = (function () {
  let _GmailApp = GmailApp;

  /** Allow test injection of a mock GmailApp */
  function setGmailApp(mock) { _GmailApp = mock; }

  /** Kill switch — either director can flip this off without touching code */
  function isEnabled() {
    return PropertiesService.getScriptProperties().getProperty('AEDILE_ENABLED') === 'true';
  }

  function getReviewedLabel() {
    return _GmailApp.getUserLabelByName(AEDILE_REVIEWED_LABEL)
      || _GmailApp.createLabel(AEDILE_REVIEWED_LABEL);
  }

  function getFlaggedLabel() {
    return _GmailApp.getUserLabelByName(AEDILE_FLAGGED_LABEL)
      || _GmailApp.createLabel(AEDILE_FLAGGED_LABEL);
  }

  function extractEmail(header) {
    const match = header.match(/<([^>]+)>/);
    return (match ? match[1] : header).toLowerCase().trim();
  }

  function formatMessageDate(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }

  /**
   * Renders every message in the thread (oldest first, Gmail's default order)
   * as a single delimited string, so the model can track an ongoing
   * back-and-forth instead of judging one message in isolation. The message
   * actually being reviewed — currentMessageId — is called out explicitly so
   * the model knows what's new versus historical context.
   */
  function buildThreadContent(thread, currentMessageId) {
    return thread.getMessages().map((m, i) => {
      const isCurrent = m.getId() === currentMessageId;
      const header = isCurrent
        ? `--- Message ${i + 1} (most recent — this is the message currently under review) ---`
        : `--- Message ${i + 1} ---`;

      return `${header}\nFrom: ${extractEmail(m.getFrom())}\nDate: ${formatMessageDate(m.getDate())}\nSubject: ${m.getSubject()}\n\n${m.getPlainBody()}`;
    }).join('\n\n');
  }

  /**
   * Asks Claude whether this message needs a response and, if so, drafts
   * one. Never sends automatically — the only Gmail mutation this can
   * cause is creating a draft reply. Every review is logged regardless of
   * outcome (no_action, draft_reply, flag, or error), and no single
   * message's failure is allowed to propagate up and kill the rest of the
   * batch.
   */
  function reviewMessage(msg) {
    let threadId, messageId, from, subject;

    try {
      const thread = msg.getThread();
      threadId = thread.getId();
      messageId = msg.getId();
      from = extractEmail(msg.getFrom());
      subject = msg.getSubject();

      let decision;
      try {
        decision = AnthropicClient.getJsonDecision(AEDILE_SYSTEM_PROMPT, buildThreadContent(thread, messageId));
      } catch (err) {
        Config.logEvent(threadId, messageId, from, subject, 'error', err.message);
        return;
      }

      if (decision.action === 'draft_reply') {
        msg.createDraftReply('', { htmlBody: decision.draft_body });
      } else if (decision.action === 'flag') {
        thread.addLabel(getFlaggedLabel());
      }

      Threads.upsert(threadId, {
        summary: decision.summary,
        entities: decision.entities,
        participants: decision.participants,
        lastMessageDate: msg.getDate()
      });

      Config.logEvent(threadId, messageId, from, subject, decision.action, decision.reasoning);

    } catch (err) {
      Config.logEvent(threadId, messageId, from, subject, 'error', err.message);
    }
  }

  /**
   * Entry point for the time-driven trigger. Scans up to
   * MAX_MESSAGES_PER_RUN unread, not-yet-logged messages and logs each one
   * via reviewMessage(). Labels a thread "aedile-reviewed" only once every
   * unread message in it has been logged this run or a previous one — a
   * thread cut off mid-way by the cap is left unlabeled so it's picked up
   * again next run instead of silently dropped.
   */
  function scanUnread() {
    if (!isEnabled()) {
      Logger.log('⏸️ Aedile is disabled (Script Property AEDILE_ENABLED is not "true"). Skipping run.');
      return;
    }

    const reviewedLabel = getReviewedLabel();
    const threads = _GmailApp.search(SCAN_QUERY);
    let processed = 0;

    for (const thread of threads) {
      if (processed >= MAX_MESSAGES_PER_RUN) break;

      let sawEveryUnreadMessage = true;

      for (const msg of thread.getMessages()) {
        if (!msg.isUnread()) continue;

        if (processed >= MAX_MESSAGES_PER_RUN) {
          sawEveryUnreadMessage = false;
          break;
        }

        const messageId = msg.getId();
        if (Config.isMessageProcessed(messageId)) continue;

        reviewMessage(msg);
        processed++;
      }

      if (sawEveryUnreadMessage) {
        thread.addLabel(reviewedLabel);
      }
    }

    Logger.log(`✅ Aedile scan complete. Reviewed ${processed} new message(s). No message was sent or marked read.`);
  }

  return {
    scanUnread,
    reviewMessage,
    setGmailApp
  };
})();

function scanInbox() {
  InboxProcessor.scanUnread();
}

/**
 * One-time setup: installs a 10-minute time-driven trigger for scanInbox().
 * Safe to re-run — clears any existing scanInbox trigger first so this
 * never creates duplicates.
 */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scanInbox')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('scanInbox')
    .timeBased()
    .everyMinutes(10)
    .create();

  Logger.log('✅ Installed 10-minute trigger for scanInbox().');
}

/** Kill switch on — sets the Script Property scanUnread() checks each run */
function enableAedile() {
  PropertiesService.getScriptProperties().setProperty('AEDILE_ENABLED', 'true');
  Logger.log('✅ Aedile enabled.');
}

/** Kill switch off — either director can run this from the editor, no code changes needed */
function disableAedile() {
  PropertiesService.getScriptProperties().setProperty('AEDILE_ENABLED', 'false');
  Logger.log('⏸️ Aedile disabled.');
}
