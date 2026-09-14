/**
 * WriteApi.js
 * A token-gated Web App endpoint that lets an external caller drive Aedile's
 * Gmail side on demand. It serves two eras at once:
 *
 *   1. LEGACY trigger-actions (scanInbox, checkBumps, draftRecap) — the
 *      pre-brain-in-repo shape, where judgment runs IN Apps Script: the
 *      endpoint just kicks off the same worker a time trigger would. Kept
 *      until the tier cutovers (#41/#42/#43) move judgment to the Node brain
 *      and #46 decommissions them. NOT the target topology.
 *
 *   2. EXECUTE-ONLY primitives (createDraft, sendReplyAll, addLabel) — the
 *      target topology (milestone #2, issue #36). Apps Script drops to a pure
 *      Gmail I/O layer: the server-side brain does ALL the judgment (reads
 *      context, calls the model, writes the text) and POSTs a finished action
 *      here. Each primitive decides nothing, reads no institutional-memory
 *      context, and calls no model — it enacts exactly one Gmail mutation.
 *      The recap `createDraft` "dumb sink" (MeetingRecap.js) was the
 *      precedent for this shape.
 *
 * SECURITY — unlike ReadApi.js, this endpoint can cause REAL side effects.
 * Both eras go through the same gate:
 *   - Requires its own `WRITE_API_TOKEN` Script Property (deliberately not
 *     shared with READ_API_TOKEN — read access and write access are
 *     independently revocable). Fails closed if unset.
 *   - POST only (not doGet) so a bare link/prefetch can't trigger anything.
 *   - Kill switches (AEDILE_ENABLED, AUTOSEND_ENABLED, BUMP_ENABLED) and the
 *     autosend allowlist still apply. Judgment no longer runs the guardrails
 *     in-process for the primitives, so the one primitive that can actually
 *     send (sendReplyAll) re-runs the guardrail last line Apps-Script-side
 *     and fails closed — see primSendReplyAll below and the "guardrail
 *     invariant" in the milestone #2 roadmap. (Per-run/day cap
 *     re-enforcement and the full read/write auth audit are #37/#38.)
 *   - The legacy workers additionally take a script-wide LockService lock, so
 *     an invocation here that overlaps a running trigger is refused with
 *     { skipped: 'locked' } rather than starting a second run with its own
 *     fresh auto-send counter. (The primitives are single Gmail mutations
 *     with no per-run counter of their own, so they don't take the lock.)
 *
 * DEPLOY:
 *   1. clasp push
 *   2. In the Apps Script editor: Project Settings > Script Properties, add
 *      WRITE_API_TOKEN = <a long random string, different from READ_API_TOKEN>.
 *   3. Deploy > Manage deployments > edit the existing Web app deployment (or
 *      New deployment) so it picks up doPost. Execute as: me, Access: anyone
 *      with the link.
 *   4. Call: POST <exec-url> -d token=<WRITE_API_TOKEN> -d action=<action>
 *
 * EXECUTE-ONLY PRIMITIVES (all POST; all honor dryRun):
 *   ?action=createDraft   Drafts finished text. Two shapes, exactly one per
 *                         call — never sends, never marks read:
 *       reply form:     -d threadId=<id> --data-urlencode htmlBody@body.html
 *           Drafts a reply on that thread's last message, cc'ing the full
 *           historical participant set (getRecipientCompletion) so nobody who
 *           was on an earlier message is silently dropped.
 *       originate form: -d to=<addr> -d subject=<subj> --data-urlencode htmlBody@body.html
 *           A brand-new-thread draft (the MeetingRecap precedent). A human
 *           opens the draft and sends; Aedile never originates a live send.
 *   ?action=sendReplyAll  -d threadId=<id> --data-urlencode htmlBody@body.html
 *           The ONLY primitive that can send. Fail-closed: refuses (200-with-
 *           ok:false + a `refused` reason, nothing sent) unless the guardrail
 *           last line passes — AEDILE_ENABLED on AND every thread participant
 *           inside AUTOSEND_ALLOWLIST with AUTOSEND_ENABLED on
 *           (InboxProcessor.isAllowlistEligible). The brain deciding to send
 *           does not bypass this.
 *   ?action=addLabel      -d threadId=<id> -d label=<name>
 *           Adds a Gmail label to a thread (creating it if missing). Inert —
 *           never drafts, never sends. The enact half of a triage `flag`.
 *
 * LEGACY TRIGGER-ACTIONS (all POST; judgment runs in Apps Script):
 *   ?action=scanInbox[&dryRun=true]                   Runs scanInbox() (= InboxProcessor.scanUnread()).
 *   ?action=checkBumps[&dryRun=true][&ignoreDue=true]  Runs checkBumps() (= BumpChecker.checkBumps()).
 *       ignoreDue=true evaluates every currently-open loop regardless of its
 *       scheduled NextCheckDate — for re-checking existing loops against
 *       improved judgment without waiting out a schedule set before the
 *       improvement existed. Not the normal daily-trigger path.
 *   ?action=draftRecap[&dryRun=true]  + a `transcript` form field
 *       Drafts a meeting recap to the krewe mailing list (MeetingRecap.js).
 *       The transcript goes in the POST BODY as a form field, not the query
 *       string, so length is not a constraint:
 *
 *         curl -X POST "<exec-url>" \
 *           -d token=<WRITE_API_TOKEN> -d action=draftRecap \
 *           --data-urlencode transcript@transcript.txt
 *
 *       This action can never send mail. Its only Gmail effect is
 *       GmailApp.createDraft() -- see MeetingRecap.js for why that carve-out
 *       from "never originate threads" is bounded.
 *
 * dryRun and ignoreDue accept ONLY the exact strings "true" and "false".
 * Absent or empty means false, so no existing caller changes behaviour, but a
 * value this endpoint cannot read is refused with a 400 rather than guessed
 * at. It used to be `String(params.dryRun) === 'true'`, which read every
 * unrecognised value as false — so `dryRun=1`, `dryRun=yes` and `dryRun=ture`
 * each executed a REAL run that can auto-send mail. A misspelled safety flag
 * meaning "no safety" is the wrong direction for this endpoint to fail in,
 * and it disagreed with the token check above, which fails closed.
 *
 * dryRun=true on the legacy workers runs the full pipeline — Claude
 * decision-making, eligibility/cap checks — but suppresses every real side
 * effect (no replyAll(), no createDraftReply(), no Gmail labels, no Sheets
 * writes). dryRun=true on a primitive runs its validation and — for
 * sendReplyAll — the guardrail last line, then reports what it WOULD do
 * without the Gmail mutation. The worker functions and primitives return a
 * result object describing what happened or would have happened, which this
 * endpoint relays back in its JSON response.
 */

const WRITE_API = (() => {

  // --- Legacy trigger-actions (judgment runs in Apps Script). Removed at #46. ---
  const ACTIONS = {
    scanInbox: scanInbox,
    checkBumps: checkBumps,
    draftRecap: draftRecap,
  };

  // draftRecap is the one legacy action that carries a payload rather than
  // just flipping switches. It reads e.parameter.transcript, which for a POST
  // is the form-encoded body, NOT the query string — so a 40-minute
  // transcript is fine and no URL length limit applies.
  const PAYLOAD_ACTIONS = { draftRecap: 'transcript' };

  /**
   * Strictly parse a boolean query parameter, defaulting to false when absent.
   *
   * The old form was `String(params.dryRun) === 'true'`, which treated every
   * value it did not recognise as false. `dryRun=1`, `dryRun=yes` and
   * `dryRun=ture` all read as "not a dry run" and executed a REAL run — one
   * that can auto-send mail via replyAll() with no human between the decision
   * and delivery. A misspelled safety flag quietly meaning "no safety" is the
   * wrong direction for this endpoint to fail in, and it disagreed with the
   * token check two lines up, which fails closed.
   *
   * Absent still means false, so no existing caller changes behaviour; a value
   * this function cannot read is now refused instead of guessed at.
   */
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
  /**
   * A LOUD, expected refusal (not an error, not a silent no-op): the guardrail
   * last line said no and nothing was sent. Status 200 so it reads as a
   * handled outcome, but ok:false + a `refused` reason so a caller can't
   * mistake it for a send. Matches "prefer noisy failures over silent guards."
   */
  function respondRefused(action, reason) {
    return { status: 200, body: { ok: false, action, refused: reason } };
  }

  // --- Pure decision helpers (factored out so TestsLocal.js covers the real
  //     branching, not a drifting copy — same posture as strictBool) ---

  /**
   * Which createDraft shape a set of params describes. Reply (threadId) and
   * originate (to+subject) are mutually exclusive; anything ambiguous or
   * incomplete returns an { error } instead of guessing. htmlBody presence is
   * checked separately by the caller.
   */
  function chooseDraftForm(params) {
    const hasThread = !!params.threadId;
    const hasOriginate = !!params.to || !!params.subject;
    if (hasThread && hasOriginate) {
      return { error: 'createDraft takes EITHER threadId (reply) OR to+subject (originate), not both.' };
    }
    if (hasThread) return { form: 'reply' };
    if (params.to && params.subject) return { form: 'originate' };
    if (hasOriginate) {
      return { error: 'createDraft (originate form) requires BOTH to and subject alongside htmlBody.' };
    }
    return { error: 'createDraft requires either threadId (reply) or to+subject (originate).' };
  }

  /**
   * The send guardrail last line, as a pure function of its two inputs, so the
   * decision is testable without Gmail. Returns a refusal reason string, or
   * null when the send may proceed. Master kill switch is checked before the
   * allowlist so a director flipping AEDILE_ENABLED off stops sends outright.
   */
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

  // --- Execute-only primitives (issue #36) ---

  /**
   * createDraft — the dumb draft sink. Never sends. One Gmail mutation:
   * createDraftReply (reply form) or createDraft (originate form).
   */
  function primCreateDraft(params, dryRun) {
    if (!params.htmlBody) return respondBad('createDraft requires htmlBody (POST it as a form field).');

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
      lastMsg.createDraftReply('', { htmlBody: params.htmlBody, cc });
      return respondOk('createDraft', dryRun, { form: 'reply', threadId: params.threadId, cc, drafted: true });
    }

    // originate form
    if (dryRun) {
      return respondOk('createDraft', dryRun, { form: 'originate', to: params.to, subject: params.subject, note: 'DRY RUN — would createDraft; nothing created.' });
    }
    GmailApp.createDraft(params.to, params.subject, '', { htmlBody: params.htmlBody });
    return respondOk('createDraft', dryRun, { form: 'originate', to: params.to, subject: params.subject, drafted: true });
  }

  /**
   * sendReplyAll — the ONLY primitive that can send, and the reason the
   * guardrail last line has to live Apps-Script-side. Fail-closed: the gate
   * runs even in dryRun (so a dry run reports whether a real one WOULD be
   * refused), and a refusal returns without sending. cc's the full historical
   * participant set so eligibility and delivery can't disagree (the
   * 2026-07-22 bug). Per-run/day caps are #37 — the allowlist itself is the
   * blast-radius boundary that must hold now.
   */
  function primSendReplyAll(params, dryRun) {
    if (!params.htmlBody) return respondBad('sendReplyAll requires htmlBody (POST it as a form field).');
    const thread = requireThread(params.threadId);

    const aedileEnabled = PropertiesService.getScriptProperties().getProperty('AEDILE_ENABLED') === 'true';
    const refusal = sendGate(aedileEnabled, InboxProcessor.isAllowlistEligible(thread));
    if (refusal) return respondRefused('sendReplyAll', refusal);

    const cc = InboxProcessor.getRecipientCompletion(thread);
    if (dryRun) {
      return respondOk('sendReplyAll', dryRun, { threadId: params.threadId, wouldCc: cc, note: 'DRY RUN — guardrail passed; would replyAll; nothing sent.' });
    }
    thread.replyAll('', { htmlBody: params.htmlBody, cc });
    return respondOk('sendReplyAll', dryRun, { threadId: params.threadId, cc, sent: true });
  }

  /**
   * addLabel — inert marker. Adds a Gmail label to a thread (creating it if it
   * doesn't exist). Never drafts, never sends. The enact half of a triage
   * `flag` decision once the brain makes it.
   */
  function primAddLabel(params, dryRun) {
    if (!params.label) return respondBad('addLabel requires a label name.');
    const thread = requireThread(params.threadId);
    if (dryRun) {
      return respondOk('addLabel', dryRun, { threadId: params.threadId, label: params.label, note: `DRY RUN — would add label "${params.label}"; nothing changed.` });
    }
    thread.addLabel(getOrCreateLabel(params.label));
    return respondOk('addLabel', dryRun, { threadId: params.threadId, label: params.label, labeled: true });
  }

  const PRIMITIVES = {
    createDraft: primCreateDraft,
    sendReplyAll: primSendReplyAll,
    addLabel: primAddLabel,
  };

  function handle(params) {
    const configured = PropertiesService.getScriptProperties().getProperty('WRITE_API_TOKEN');
    if (!configured) return { status: 503, body: { ok: false, error: 'WRITE_API_TOKEN not set; endpoint disabled.' } };
    if (!params.token || params.token !== configured) return { status: 403, body: { ok: false, error: 'Invalid or missing token.' } };

    const action = params.action;

    let dryRun, ignoreDue;
    try {
      dryRun = strictBool(params.dryRun, 'dryRun');
      ignoreDue = strictBool(params.ignoreDue, 'ignoreDue');
    } catch (err) {
      return { status: 400, body: { ok: false, error: String(err.message) } };
    }

    // Execute-only primitives (issue #36): the brain POSTs finished text,
    // these enact one Gmail mutation. Each handler validates its own params
    // and returns a fully-formed { status, body } (including its own refusals).
    if (PRIMITIVES[action]) {
      return PRIMITIVES[action](params, dryRun);
    }

    // Legacy trigger-actions — judgment runs in Apps Script. Kept until the
    // tier cutovers (#41/#42/#43) and removed at #46. Not the target topology.
    const fn = ACTIONS[action];
    if (!fn) {
      const known = Object.keys(PRIMITIVES).concat(Object.keys(ACTIONS)).join(', ');
      return { status: 400, body: { ok: false, error: 'Unknown action. Use one of: ' + known } };
    }

    let result;
    if (PAYLOAD_ACTIONS[action]) {
      const payload = params[PAYLOAD_ACTIONS[action]];
      if (!payload) {
        return { status: 400, body: { ok: false, error: `${action} requires a "${PAYLOAD_ACTIONS[action]}" parameter. POST it as a form field, not in the query string.` } };
      }
      result = fn(payload, dryRun);
    } else if (action === 'checkBumps') {
      result = fn(dryRun, ignoreDue);
    } else {
      result = fn(dryRun);
    }
    return { status: 200, body: { ok: true, action, dryRun, ignoreDue, result } };
  }

  // chooseDraftForm/sendGate are exposed for TestsLocal.js; the rest is internal.
  return { handle, chooseDraftForm, sendGate };
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
