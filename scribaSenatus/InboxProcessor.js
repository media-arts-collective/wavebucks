/**
 * InboxProcessor.gs
 * Central inbox dispatcher for Scriba Senatus.
 * Scans unread messages, detects commands, and delegates to service handlers.
 */
const InboxProcessor = (function() {
  let _GmailApp = GmailApp;

  /** Allow test injection of a mock GmailApp */
  function setGmailApp(mock) { _GmailApp = mock; }

  /**
   * Main entry point. Called by hourly trigger.
   */
  function processUnread() {
    const query = Config.get('inboxSearch') || 'is:unread to:scribasenatus@*';
    const threads = _GmailApp.search(query);
    threads.forEach(thread => {
      thread.getMessages().forEach(msg => {
        if (!msg.isUnread()) return;
        dispatchMessage(msg);
        msg.markRead();
      });
    });
  }

  /**
   * Reads email content and decides what type of action it is.
   * Delegates to appropriate service or reply builder.
   */
  const { logEvent } = Config;

  function dispatchMessage(msg) {
    const fromEmail = extractEmail(msg.getFrom());
    const body = normalizeBody(msg.getPlainBody());
    const subject = msg.getSubject();

    try {
      const command = detectCommand(body);
      if (!command) {
        sendReply(msg, Personality.get('HELP'));
        logEvent(fromEmail, subject, 'UNKNOWN', 'InboxProcessor', 'help', 'no command found');
        return;
      }

      const handler = DispatchTable[command.type];
      if (!handler) {
        sendReply(msg, MessageBuilder.buildErrorMessage("Unrecognized command: " + command.type));
        logEvent(fromEmail, subject, command.type, 'InboxProcessor', 'error', 'no handler');
        return;
      }

      const reply = handler(fromEmail, body, subject, command);
      sendReply(msg, reply);
      logEvent(fromEmail, subject, command.type, handler.name || 'anon', 'success', '');

    } catch (err) {
      sendReply(msg, MessageBuilder.buildErrorMessage(err.message));
      logEvent(fromEmail, subject, 'EXCEPTION', 'InboxProcessor', 'fail', err.message);
    }
  }


  /** --- Helpers --- */

  function extractEmail(header) {
    const match = header.match(/<([^>]+)>/);
    return (match ? match[1] : header).toLowerCase().trim();
  }

  function normalizeBody(body) {
    // Remove quoted reply content (Gmail style)
    // Looks for "On [date] ... wrote:" pattern
    const quoteSeparators = [
      /On .+wrote:/i,           // Gmail: "On Mon, Dec 8, 2025 at 5:46 PM ... wrote:"
      /^>.*/gm,                 // Lines starting with >
      /_{5,}/,                  // Underscores (some clients)
      /^From:.+/m,              // "From: ..." headers
    ];

    let cleanBody = body;

    // Stop at the first quote separator found
    for (const separator of quoteSeparators) {
      const match = cleanBody.match(separator);
      if (match) {
        cleanBody = cleanBody.substring(0, match.index);
        break;
      }
    }

    return cleanBody.replace(/\r\n|\r/g, '\n').trim();
  }

  /**
   * Detect which command type this message belongs to.
   * Looks for the first matching pattern in Config.LEXICON.
   */
  function detectCommand(body) {
    const lexicon = Config.getLexicon(); // [{type:'CAUSA',pattern:/^CAUSA/i}, ...]
    for (const entry of lexicon) {
      if (entry.pattern.test(body)) return entry;
    }
    return null;
  }

  function sendReply(msg, htmlBody) {
    const recipient = extractEmail(msg.getFrom());

    // Reply directly to the message to maintain thread continuity
    msg.reply('', {
      htmlBody: htmlBody
    });

    Logger.log(`📨 HTML reply sent to ${recipient} in thread`);
  }

  return {
    processUnread,
    dispatchMessage,
    setGmailApp
  };
})();

function processInbox() {
  InboxProcessor.processUnread();
}

const MessageBuilder = (() => ({

  buildErrorMessage(txt) {
    return `<p>⚠️ <b>Error:</b> ${txt}</p><p>Send <code>HELP</code> for instructions.</p>`;
  },

  buildDigest({ balance }) {
    const causae = ServiceAdapters.getActiveCausae();
    const comms  = ServiceAdapters.getActiveCommissio();

    return `
      ${Personality.get('QUOT_HEADER')}
      <p><b>Balance:</b> ₩${balance}</p>

      <h3>Active Causae</h3>
      ${formatList(causae)}

      <h3>Active Commissions</h3>
      ${formatList(comms)}

      <p><i>${Config.get('motto') || ''}</i></p>`;
  }

}))();

/**
 * Helper to render array → HTML list.
 * Accepts either string array or preformatted HTML chunks.
 */
function formatList(arr) {
  if (!arr || arr.length === 0) return '<p>None.</p>';
  if (typeof arr === 'string') return `<p>${arr}</p>`;
  return '<ul>' + arr.map(x => `<li>${x}</li>`).join('') + '</ul>';
}



