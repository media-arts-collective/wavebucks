// WriteApi.js -- token-gated Web App endpoint (POST only) driving Aedile's Gmail side.
// Unlike ReadApi.js this causes real side effects. WRITE_API_TOKEN is its own
// Script Property, separate from READ_API_TOKEN; fails closed if unset. Kill
// switches (AEDILE_ENABLED, AUTOSEND_ENABLED) and the autosend allowlist gate
// the two sends.
//
// Call: POST <exec-url> -d token=<WRITE_API_TOKEN> -d action=<action>
//
// Reads (dryRun ignored):
//   readThread   threadId=<id> [html=true]      every message on the thread; html adds the HTML body
//   readInbox    [q=<gmail query>] [limit=<n>]  thread identity plus a snippet, not bodies
// Primitives (all honor dryRun):
//   createDraft  body=|htmlBody= (exactly one), with threadId=<id> (reply) or
//                to=<addr> subject=<subj> (originate); optional logLabel, logNote.
//                Never sends. Mail goes plain, like the archive; htmlBody is
//                for re-posting a draft read back with html=true (#78).
//   sendReplyAll threadId=<id> body=   sends plain text; refused unless AEDILE_ENABLED and
//                every participant is in AUTOSEND_ALLOWLIST with AUTOSEND_ENABLED on
//   sendDraft    messageId=<id> sha256=<of its html>   sends one armed draft; same gate
//                Both sends share MAX_SENDS_PER_DAY, counted from the Log.
//   logEvent     messageId=<id> logLabel=<action> [threadId, from, subject, logNote]
//                one Log row; refuses a send label
//   addLabel     threadId=<id> label=<name>
//   trashMessage messageId=<id>
//   openLoop, closeLoop, amendLoop, appendRecord
//
// dryRun accepts only the exact strings "true" and "false"; absent means false, anything else is a 400. A misspelled safety flag must not mean "no safety".

const WRITE_API = (() => {

  // Absent is false; anything but "true"/"false" throws, so a misspelled dryRun
  // cannot run a real send.
  function strictBool(value, name) {
    if (value === undefined || value === null || value === '') return false;
    const s = String(value);
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw new Error(`${name} must be exactly "true" or "false" (got "${s}").`);
  }

  // --- Response builders (Apps Script has no real HTTP status for
  //     ContentService, so status is echoed in the body; callers check `ok`) ---
  function respondOk(action, dryRun, result) {
    return { status: 200, body: { ok: true, action, dryRun, result } };
  }
  function respondBad(error) {
    return { status: 400, body: { ok: false, error } };
  }
  // An expected refusal: status 200 but ok:false + `refused`, so a caller cannot
  // mistake it for a send.
  function respondRefused(action, reason) {
    return { status: 200, body: { ok: false, action, refused: reason } };
  }

  // --- Pure decision helpers, exposed so TestsLocal.js covers the real branching ---

  function chooseDraftForm(params) {
    const hasThread = !!params.threadId;
    const hasOriginate = !!params.to || !!params.subject;
    if (hasThread && hasOriginate) {
      return { error: 'createDraft takes EITHER threadId (reply) OR to+subject (originate), not both.' };
    }
    if (hasThread) return { form: 'reply' };
    if (params.to && params.subject) return { form: 'originate' };
    if (hasOriginate) {
      return { error: 'createDraft (originate form) requires BOTH to and subject alongside a body.' };
    }
    return { error: 'createDraft requires either threadId (reply) or to+subject (originate).' };
  }

  function chooseBody(params) {
    const hasHtml = params.htmlBody !== undefined && params.htmlBody !== '';
    const hasPlain = params.body !== undefined && params.body !== '';
    if (hasHtml && hasPlain) return { error: 'createDraft takes EITHER body (plain) OR htmlBody, not both.' };
    if (hasHtml) return { html: params.htmlBody };
    if (hasPlain) return { plain: params.body };
    return { error: 'createDraft requires a body (plain text) or htmlBody (POST it as a form field).' };
  }

  // The master kill switch is checked before the allowlist.
  // Sends through this endpoint in any 24 hours. Counted from the Log, so the
  // cap holds across calls and callers; nothing downstream reviews a send.
  const MAX_SENDS_PER_DAY = 5;

  function isSendAction(action) {
    return /(_sent|auto_reply)$/.test(String(action));
  }

  function capRefusal(recentActions) {
    const sent = recentActions.filter(isSendAction).length;
    return sent >= MAX_SENDS_PER_DAY
      ? `${sent} sends in the last 24 hours, cap is ${MAX_SENDS_PER_DAY}.`
      : null;
  }

  function sendGate(aedileEnabled, allowlistEligible) {
    if (!aedileEnabled) return 'AEDILE_ENABLED is not "true" — master kill switch is off.';
    if (!allowlistEligible) {
      return 'thread failed isAllowlistEligible — AUTOSEND_ENABLED off, empty AUTOSEND_ALLOWLIST, or a participant outside it.';
    }
    return null;
  }

  // --- Gmail helpers ---
  function getOrCreateLabel(name) {
    return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  }

  function requireThread(threadId) {
    if (!threadId) throw new Error('threadId is required.');
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) throw new Error(`thread ${threadId} not found.`);
    return thread;
  }

  // A bad Log write must not undo a draft that already happened.
  function logDraft(ctx, params) {
    if (!params.logLabel) return;
    try {
      Config.logEvent(ctx.threadId || '', 'createDraft', ctx.from || '', ctx.subject || '', params.logLabel, params.logNote || '');
    } catch (err) {
      Logger.log(`[createDraft] Config.logEvent(${params.logLabel}) FAILED — ${err.stack || err}`);
    }
  }

  // Count and send under the script lock: two overlapping sends must not both
  // read a count one under the cap. `send` runs only when a send may proceed.
  function withSendCap(action, send) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return respondRefused(action, 'another run holds the script lock.');
    try {
      const capped = capRefusal(Config.actionsSince(new Date(Date.now() - 24 * 60 * 60 * 1000)));
      return capped ? respondRefused(action, capped) : send();
    } finally {
      lock.releaseLock();
    }
  }

  // --- Execute-only primitives ---

  // createDraft: the single draft sink. Never sends.
  function primCreateDraft(params, dryRun) {
    const bodyChoice = chooseBody(params);
    if (bodyChoice.error) return respondBad(bodyChoice.error);

    const choice = chooseDraftForm(params);
    if (choice.error) return respondBad(choice.error);

    if (choice.form === 'reply') {
      const thread = requireThread(params.threadId);
      const messages = thread.getMessages();
      const lastMsg = messages[messages.length - 1];
      const cc = InboxProcessor.getRecipientCompletion(thread);
      if (dryRun) {
        return respondOk('createDraft', dryRun, { form: 'reply', threadId: params.threadId, wouldCc: cc, note: 'DRY RUN — would createDraftReply; nothing created.' });
      }
      if (bodyChoice.html !== undefined) lastMsg.createDraftReply('', { htmlBody: bodyChoice.html, cc });
      else lastMsg.createDraftReply(bodyChoice.plain, { cc });
      logDraft({ threadId: params.threadId, subject: lastMsg.getSubject() }, params);
      return respondOk('createDraft', dryRun, { form: 'reply', threadId: params.threadId, cc, drafted: true, logged: !!params.logLabel });
    }

    // originate form (a brand-new thread — the recap sink)
    if (dryRun) {
      return respondOk('createDraft', dryRun, { form: 'originate', to: params.to, subject: params.subject, wouldSendTo: params.to, note: 'DRY RUN — would createDraft; nothing created.' });
    }
    if (bodyChoice.html !== undefined) GmailApp.createDraft(params.to, params.subject, '', { htmlBody: bodyChoice.html });
    else GmailApp.createDraft(params.to, params.subject, bodyChoice.plain);
    logDraft({ from: params.to, subject: params.subject }, params);
    return respondOk('createDraft', dryRun, { form: 'originate', to: params.to, subject: params.subject, recipient: params.to, drafted: true, logged: !!params.logLabel });
  }

  // sendReplyAll: can send. Fail-closed: the gate runs even in dryRun, and a
  // refusal returns without sending. cc's the full participant set so
  // eligibility and delivery cannot disagree.
  function primSendReplyAll(params, dryRun) {
    if (!params.body) return respondBad('sendReplyAll requires body (plain text).');
    const thread = requireThread(params.threadId);

    const aedileEnabled = PropertiesService.getScriptProperties().getProperty('AEDILE_ENABLED') === 'true';
    const refusal = sendGate(aedileEnabled, InboxProcessor.isAllowlistEligible(thread));
    if (refusal) return respondRefused('sendReplyAll', refusal);

    const cc = InboxProcessor.getRecipientCompletion(thread);
    return withSendCap('sendReplyAll', () => {
      if (dryRun) {
        return respondOk('sendReplyAll', dryRun, { threadId: params.threadId, wouldCc: cc, note: 'DRY RUN — guardrail passed; would replyAll; nothing sent.' });
      }
      thread.replyAll(params.body, { cc });
      Config.logEvent(params.threadId, 'sendReplyAll', cc, thread.getFirstMessageSubject(), 'reply_sent', '');
      return respondOk('sendReplyAll', dryRun, { threadId: params.threadId, cc, sent: true });
    });
  }

  function primAddLabel(params, dryRun) {
    if (!params.label) return respondBad('addLabel requires a label name.');
    const thread = requireThread(params.threadId);
    if (dryRun) {
      return respondOk('addLabel', dryRun, { threadId: params.threadId, label: params.label, note: `DRY RUN — would add label "${params.label}"; nothing changed.` });
    }
    thread.addLabel(getOrCreateLabel(params.label));
    return respondOk('addLabel', dryRun, { threadId: params.threadId, label: params.label, labeled: true });
  }

  // trashMessage: moves one message to the trash. Message-scoped so it cannot
  // take a thread's replies with it. No untrash or permanent-delete verb: the
  // reversal is the Gmail UI's trash.
  function primTrashMessage(params, dryRun) {
    if (!params.messageId) return respondBad('trashMessage requires a messageId.');
    // Deliberately unguarded: an unreachable id throws, and the 500 is the answer.
    const message = GmailApp.getMessageById(params.messageId);
    if (!message) return respondBad('trashMessage: no message with id ' + params.messageId);
    const before = message.isInTrash();
    if (dryRun) {
      return respondOk('trashMessage', dryRun, { messageId: params.messageId, inTrash: before, note: 'DRY RUN — nothing changed.' });
    }
    message.moveToTrash();
    return respondOk('trashMessage', dryRun, { messageId: params.messageId, inTrashBefore: before, inTrashAfter: message.isInTrash() });
  }

  // sendDraft: sends one existing draft. Same gate as sendReplyAll, so a draft
  // to anyone outside AUTOSEND_ALLOWLIST is refused; a sha256 mismatch (edited
  // after arming) is refused. Safe to call twice: a sent draft is no longer a draft.
  function primSendDraft(params, dryRun) {
    if (!params.messageId) return respondBad('sendDraft requires a messageId.');
    if (!params.sha256) return respondBad('sendDraft requires sha256 of the html body it was armed with.');
    const draft = GmailApp.getDrafts().find(d => d.getMessage().getId() === params.messageId);
    if (!draft) return respondBad('sendDraft: no draft with message id ' + params.messageId + ' (already sent, edited in the Gmail UI, or trashed).');
    const message = draft.getMessage();

    const aedileEnabled = PropertiesService.getScriptProperties().getProperty('AEDILE_ENABLED') === 'true';
    const refusal = sendGate(aedileEnabled, InboxProcessor.isAllowlistEligible(message.getThread()));
    if (refusal) return respondRefused('sendDraft', refusal);

    const sha256 = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, message.getBody(), Utilities.Charset.UTF_8)
      .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
    if (sha256 !== params.sha256) return respondRefused('sendDraft', 'body changed since arming (sha256 ' + sha256 + '); re-arm it.');

    const ctx = { threadId: message.getThread().getId(), from: message.getTo(), subject: message.getSubject() };
    return withSendCap('sendDraft', () => {
      if (dryRun) {
        return respondOk('sendDraft', dryRun, { messageId: params.messageId, to: message.getTo(), subject: ctx.subject, note: 'DRY RUN — guardrail and hash passed; nothing sent.' });
      }
      draft.send();
      Config.logEvent(ctx.threadId, 'sendDraft', ctx.from, ctx.subject, 'armed_draft_sent', 'sha256 ' + sha256);
      return respondOk('sendDraft', dryRun, { messageId: params.messageId, to: ctx.from, subject: ctx.subject, sent: true });
    });
  }

  // logEvent: one Log row for a message a caller looked at and did not draft
  // for. A send label is refused: the cap counts those, and sends log themselves.
  function primLogEvent(params, dryRun) {
    if (!params.messageId || !params.logLabel) return respondBad('logEvent requires messageId and logLabel.');
    if (isSendAction(params.logLabel)) return respondBad('logEvent may not write a send label.');
    if (dryRun) return respondOk('logEvent', dryRun, { messageId: params.messageId, logLabel: params.logLabel, note: 'DRY RUN — nothing written.' });
    Config.logEvent(params.threadId || '', params.messageId, params.from || '', params.subject || '', params.logLabel, params.logNote || '');
    return respondOk('logEvent', dryRun, { messageId: params.messageId, logged: true });
  }

  // No Gmail call, so the only gate is the token.
  function primOpenLoop(params, dryRun) {
    if (!params.owner || !params.ask) return respondBad('openLoop requires owner and ask.');
    if (AUDIENCES.indexOf(params.audience) === -1) return respondBad('audience must be one of: ' + AUDIENCES.join(', '));
    let sensitive;
    try { sensitive = strictBool(params.sensitive, 'sensitive'); } catch (err) { return respondBad(String(err.message)); }
    if (dryRun) return respondOk('openLoop', dryRun, { owner: params.owner, ask: params.ask, note: 'DRY RUN — nothing written.' });
    const id = Loops.open({ owner: params.owner, counterpart: params.counterpart, ask: params.ask, channel: params.channel,
      contact: params.contact, due: params.due, tag: params.tag, source: params.source, sensitive, audience: params.audience });
    return respondOk('openLoop', dryRun, { id, opened: true });
  }

  function primCloseLoop(params, dryRun) {
    if (!params.id || !params.how || !params.words) return respondBad('closeLoop requires id, how and words.');
    if (dryRun) return respondOk('closeLoop', dryRun, { id: params.id, note: 'DRY RUN — nothing written.' });
    const closed = Loops.close(params.id, params.how, params.words);
    if (!closed) return respondRefused('closeLoop', 'no open loop with id ' + params.id);
    return respondOk('closeLoop', dryRun, { id: closed.id, ask: closed.ask, closed: true });
  }

  /** amendLoop -- correct an open loop by superseding it; only the fields passed change. */
  function primAmendLoop(params, dryRun) {
    if (!params.id) return respondBad('amendLoop requires id.');
    if (params.audience && AUDIENCES.indexOf(params.audience) === -1) return respondBad('audience must be one of: ' + AUDIENCES.join(', '));
    if (dryRun) return respondOk('amendLoop', dryRun, { id: params.id, note: 'DRY RUN — nothing written.' });
    const amended = Loops.amend(params.id, params);
    if (!amended) return respondRefused('amendLoop', 'no open loop with id ' + params.id);
    return respondOk('amendLoop', dryRun, amended);
  }

  function primAppendRecord(params, dryRun) {
    if (!params.kind || !params.who || !params.words) return respondBad('appendRecord requires kind, who and words.');
    if (Record.KINDS.indexOf(params.kind) === -1) return respondBad('kind must be one of: ' + Record.KINDS.join(', '));
    if (AUDIENCES.indexOf(params.audience) === -1) return respondBad('audience must be one of: ' + AUDIENCES.join(', '));
    if (params.kind === 'event' && !params.date) return respondBad('an event requires date.');
    let sensitive;
    try { sensitive = strictBool(params.sensitive, 'sensitive'); } catch (err) { return respondBad(String(err.message)); }
    if (dryRun) return respondOk('appendRecord', dryRun, { kind: params.kind, note: 'DRY RUN — nothing written.' });
    const id = Record.append({ date: params.date, kind: params.kind, who: params.who, words: params.words,
      source: params.source, supersedes: params.supersedes, tag: params.tag, sensitive, audience: params.audience });
    return respondOk('appendRecord', dryRun, { id, appended: true });
  }

  const PRIMITIVES = {
    createDraft: primCreateDraft,
    sendReplyAll: primSendReplyAll,
    sendDraft: primSendDraft,
    addLabel: primAddLabel,
    logEvent: primLogEvent,
    trashMessage: primTrashMessage,
    openLoop: primOpenLoop,
    closeLoop: primCloseLoop,
    amendLoop: primAmendLoop,
    appendRecord: primAppendRecord,
  };

  // readThread: mutates nothing. On this POST-only endpoint, not ReadApi, so a
  // thread body is not reachable by a URL. html=true adds getBody(); `body` is
  // Gmail's hard-wrapped text/plain alternative, so a re-draft reads html.
  function readThread(params) {
    const thread = requireThread(params.threadId);
    const withHtml = params.html === 'true';
    const messages = thread.getMessages().map(m => Object.assign({
      messageId: m.getId(),
      date: m.getDate(),
      from: m.getFrom(),
      to: m.getTo(),
      cc: m.getCc(),
      subject: m.getSubject(),
      body: m.getPlainBody(),
      unread: m.isUnread(),
    }, withHtml ? { html: m.getBody() } : {}));
    return { status: 200, body: { ok: true, action: 'readThread', threadId: params.threadId, count: messages.length, messages } };
  }

  // Identity plus a snippet, not bodies, so a broad query cannot export the mailbox.
  function readInbox(params) {
    const query = params.q ? String(params.q) : 'in:inbox';
    const raw = parseInt(params.limit, 10);
    const limit = Math.min(Number.isFinite(raw) && raw > 0 ? raw : 20, 100);
    const threads = GmailApp.search(query, 0, limit).map(t => {
      const messages = t.getMessages();
      const last = messages[messages.length - 1];
      return {
        threadId: t.getId(),
        messageCount: messages.length,
        lastDate: last.getDate(),
        lastFrom: last.getFrom(),
        subject: t.getFirstMessageSubject(),
        snippet: last.getPlainBody().slice(0, 300),
      };
    });
    return { status: 200, body: { ok: true, action: 'readInbox', query, count: threads.length, threads } };
  }

  const READS = { readThread, readInbox };

  function handle(params) {
    const configured = PropertiesService.getScriptProperties().getProperty('WRITE_API_TOKEN');
    if (!configured) return { status: 503, body: { ok: false, error: 'WRITE_API_TOKEN not set; endpoint disabled.' } };
    if (!params.token || params.token !== configured) return { status: 403, body: { ok: false, error: 'Invalid or missing token.' } };

    const action = params.action;

    let dryRun;
    try {
      dryRun = strictBool(params.dryRun, 'dryRun');
    } catch (err) {
      return { status: 400, body: { ok: false, error: String(err.message) } };
    }

    // Reads: checked before the mutating dispatch so a read can never fall through into it.
    if (READS[action]) {
      return READS[action](params);
    }

    if (PRIMITIVES[action]) {
      return PRIMITIVES[action](params, dryRun);
    }

    const known = Object.keys(READS).concat(Object.keys(PRIMITIVES)).join(', ');
    return { status: 400, body: { ok: false, error: 'Unknown action. Use one of: ' + known } };
  }

  // Everything but handle is exposed for TestsLocal.js.
  return { handle, chooseDraftForm, chooseBody, sendGate, capRefusal, strictBool };
})();

function doPost(e) {
  const params = (e && e.parameter) || {};
  let result;
  try {
    result = WRITE_API.handle(params);
  } catch (err) {
    result = { status: 500, body: { ok: false, error: String(err && err.message || err) } };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result.body))
    .setMimeType(ContentService.MimeType.JSON);
}
