#!/usr/bin/env python3
"""ingest.py -- rebuild messages.jsonl from a source that carries headers.

WHY THIS IS PYTHON AND NOT ANOTHER .mjs
    The whole point of a better scrape is to stop throwing away RFC-2822
    headers. Parsing them is `mailbox` + `email` + `email.utils`, all stdlib
    here and all absent from node's. Hand-rolling an mbox reader, a MIME
    walker, a charset decoder and an RFC-2822 date parser in JavaScript is
    several hundred lines that already exist, correct, in the interpreter
    this box ships.

WHAT IS WRONG WITH THE ARCHIVE THIS REPLACES
    Every number below is from `--audit` against the live vault copy, not
    from an issue. The existing messages.jsonl was hand-dropped on
    2026-07-29 by a scraper that is on no host here, and `threads/`,
    `people/` and `voice/` were generated from it an hour later, so they are
    derived and must be regenerated from whatever replaces it.

    1. NO SUBJECTS.    The scraper slugged each thread from the BODY'S FIRST
       LINE and dropped the Subject: header. 448 of 542 comparable slugs are
       the body opening verbatim; nearly all of the other 94 differ only by
       apostrophes ("we-re" vs "were"), so in practice it is all of them.
       Thread titles are additionally truncated at the slug length -- the
       vault has "Bring bri" where the message says "Bring brilliant,
       unwieldy ideas". A prompt doctrine and a blocking check were both
       built on the resulting non-fact that the subject restates the body.
    2. IDENTITY REDACTED. `email` is null on 325 of 1099 rows and `author`
       is Groups' ellipsized form on 802 ("kreweofv...@gmail.com",
       "thejak...@gmail.com"), or a bare display name ("Wbbales", "T83",
       "vip"). This is Google Groups masking addresses from a non-manager
       session, so it is a property of HOW it was scraped and no amount of
       re-scraping as an ordinary member fixes it. It forces corpus.mjs's
       `/^kreweofv/` prefix match and breaks per-author work for everyone
       else.
    3. NO TIMEZONE.    `date` is a local-time string with no offset. It has
       already produced one wrong published number (a UTC-5 shift applied to
       an hour that was already local). Gmail's API really is UTC. The two
       sources cannot be mixed without an offset on each row.
    4. TRUNCATED.      Ends 2026-06-17 overall and 2026-02-19 for the
       operator, and May-Sep 2025 is missing outright.
    5. NO THREADING.   No Message-ID, In-Reply-To or References, so thread
       membership is inferred from a URL. 86 of its 628 topics have no
       thread file at all.

SOURCES, BEST FIRST
    --mbox FILE   An mbox from a mailbox that was subscribed to the list.
                  This is the one that actually fixes 1, 3 and 5 at once,
                  because those are headers and a DOM scrape cannot
                  reconstruct them. Google Takeout emits mbox; for a
                  long-subscribed member it holds essentially all list
                  traffic they received.
    --gmail       The krewe Office mailbox through aedile's read endpoint.
                  Real sender, subject and offset, but NOT the Message-ID,
                  In-Reply-To or References headers -- readThread does not
                  return raw source -- so this path fixes defects 1-4 and
                  not 5. And see the coverage warning it prints: that
                  mailbox holds NOTHING before 2025 (measured: 0 threads for
                  `before:2025/01/01`), so it is the successor era only.
    --jsonl FILE  The existing archive, as a floor. Carries no headers; its
                  rows are emitted with `source: "legacy-scrape"` and null
                  header fields so a reader can tell a missing subject from
                  an empty one.

    Sources MERGE rather than replace, because none of them is complete and
    the legacy file is still the only copy of 2019-2024.

SCHEMA is a strict superset of the old one. `author`, `email`, `date`,
`body` and `topic_url` keep their exact old spelling and meaning -- in
particular `date` stays the local-time-without-offset string that
corpus.mjs's parseDate expects, so the ten existing readers need no change.
Everything new is additive: subject, message_id, in_reply_to, references,
date_iso (the true instant, with offset), to, cc, source.
"""

import argparse, email, email.policy, email.utils, hashlib, json, mailbox
import re, subprocess, sys
from datetime import datetime
from zoneinfo import ZoneInfo

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()

# The krewe is in New Orleans, and both the legacy archive and this tool write
# `date` as wall-clock with no offset. An mbox carries the sender's own offset
# and is used as-is. Gmail's API hands back UTC, which is a DIFFERENT number for
# the same instant -- a 7:34pm send reads as 00:34 the next day -- so Gmail rows
# are converted here before being rendered. Not converting is the bug that has
# already published one wrong median from this corpus.
LOCAL = ZoneInfo('America/Chicago')
VAULT_JSONL = '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive/messages.jsonl'
CALL_SH = 'aedile/recap/call.sh'

# `message_id` is the RFC-2822 Message-ID HEADER and nothing else, so a join
# on it means what it says. Gmail's own per-message id lives in `gmail_id`,
# a different namespace entirely -- it is what GmailMessage.getId() returns,
# not what the sender wrote. Sharing one field between them would make a join
# across the two sources return zero rows and look like an empty overlap
# rather than a category error.
FIELDS = ['author', 'email', 'date', 'date_iso', 'subject', 'message_id',
          'gmail_id', 'in_reply_to', 'references', 'to', 'cc', 'body',
          'topic_url', 'source', 'aedile_authored']

# Addresses aedile can send under. A message from any other address is
# nobody's ambiguity -- a human wrote it.
KREWE = ('kreweofvaporwave@kreweofvaporwave.com', 'kreweofvaporwave@gmail.com',
         'kreweofvaporwave@googlegroups.com')


def legacy_date(dt):
    """The old `date` spelling: local wall-clock, no offset. Emitted so
    corpus.mjs keeps working unchanged; `date_iso` carries the real instant."""
    h = dt.hour % 12 or 12
    return (f"{MONTHS[dt.month - 1]} {dt.day}, {dt.year}, "
            f"{h}:{dt.minute:02d}:{dt.second:02d} {'PM' if dt.hour >= 12 else 'AM'}")


PREFIX = 60   # characters of body in the merge key; see merge_key()
# How long after aedile logs a draft its message may appear, and how long
# before. Asymmetric because the two directions are different events:
# forward is a human getting round to sending the draft, which took 2.5 days
# in the one observed case; backward is only clock skew between Gmail's
# second-truncated send time and the Log write, observed at -0.854s.
SENT_AFTER_LOG_MAX = 14 * 86400
SENT_BEFORE_LOG_MAX = 300


def instant(iso):
    """An aware datetime out of either clock's spelling, or None."""
    if not iso:
        return None
    return datetime.fromisoformat(str(iso).replace('Z', '+00:00'))


def calendar_day(date):
    """Y-Mon-DD out of the legacy date spelling, 'Jan 29, 2024, 2:48:24 PM'."""
    m = re.match(r'(\w{3}) (\d{1,2}), (\d{4})', re.sub(r'\s+', ' ', str(date)).strip())
    return f'{m.group(3)}-{m.group(1)}-{int(m.group(2)):02d}' if m else '?'


def merge_key(date, body, seq):
    """Identity of a message ACROSS sources. Every part of this is measured;
    `keytune` in the commit message has the table.

    Not Message-ID, even where one exists: the legacy rows have none, so
    keying on it when present means an mbox row and the legacy row for the
    same message never meet and the merge silently keeps the redacted copy
    beside the good one. (It did, until this comment.)

    Not the timestamp to the second. Google Groups and Gmail disagree by
    13-42 seconds on the same message -- Groups records delivery, Gmail
    records receipt -- so a second-precision key matched 1 message where the
    true overlap is 99. Calendar DAY is the coarsest thing that still
    discriminates, and it costs nothing: with 60 characters of body beside
    it there are 0 collisions across the 1099-row legacy file.

    Not much body, either. The legacy bodies came through a DOM-to-text pass
    that re-flowed them, so the two copies of one message diverge somewhere
    past 60 characters -- overlap falls 99 -> 82 -> 24 -> 9 as the prefix
    grows 60 -> 80 -> 100 -> 120. Shorter is not free: at 40 characters the
    legacy file starts colliding with itself (4 pairs) for 10 more matches.
    60 is the measured knee.

    Whitespace is normalised because the legacy `date` puts U+202F (narrow
    no-break space) before AM/PM where this tool writes a plain space -- an
    invisible difference that would otherwise defeat every match.

    An empty body gets a unique key from `seq` rather than colliding with
    every other empty body on its day (the legacy file has 25 of them).
    """
    text = re.sub(r'\s+', ' ', body or '').strip()[:PREFIX].lower()
    if not text:
        return f'empty-body-{seq}'
    return hashlib.sha1(f'{calendar_day(date)}|{text}'.encode()).hexdigest()


def plain_body(msg):
    """First text/plain part, decoded. Falls back to the whole payload."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == 'text/plain' and not part.get_filename():
                return part.get_content(), part.get_content_type()
        return '', msg.get_content_type()
    return msg.get_content(), msg.get_content_type()


def from_mbox(path):
    for msg in mailbox.mbox(path, factory=lambda f: email.message_from_binary_file(
            f, policy=email.policy.default)):
        dt = email.utils.parsedate_to_datetime(msg['Date']) if msg['Date'] else None
        if not dt:
            continue
        name, addr = email.utils.parseaddr(str(msg['From'] or ''))
        try:
            body, _ = plain_body(msg)
        except Exception as e:              # fail loud, per BUILD-DISCIPLINE
            print(f"ingest: undecodable body in {msg['Message-ID']}: {e}", file=sys.stderr)
            raise
        yield {
            'author': name or addr,
            'email': addr.lower() or None,
            'date': legacy_date(dt),        # local wall-clock as the sender wrote it
            'date_iso': dt.isoformat(),
            'subject': str(msg['Subject']) if msg['Subject'] else None,
            'message_id': (msg['Message-ID'] or '').strip() or None,
            'gmail_id': None,
            'in_reply_to': (msg['In-Reply-To'] or '').strip() or None,
            'references': (msg['References'] or '').split() or None,
            'to': str(msg['To']) if msg['To'] else None,
            'cc': str(msg['Cc']) if msg['Cc'] else None,
            'body': body,
            'topic_url': None,
            'source': 'mbox',
        }


def call_get(scope, **params):
    args = [CALL_SH, 'get', scope] + [f'{k}={v}' for k, v in params.items()]
    out = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if out.returncode:
        raise SystemExit(f'ingest: get {scope} failed rc={out.returncode}: '
                         f'{out.stderr.strip()}')
    return json.loads(out.stdout)


def aedile_marker(log_rows):
    """Return `row -> True | False | None`, answering "did aedile write this".

    THIS EXISTS BECAUSE MEASURING AEDILE'S OWN OUTPUT CLOSES A LOOP. Two of
    the 35 subjects this tool first pulled were drafts aedile posted the same
    afternoon, one of them an hour before the pull. Feed those into a rate and
    aedile's habits become the corpus's habits, and the drift is invisible
    because it looks like agreement.

    `From` alone cannot answer it -- aedile/CLAUDE.md has this open since
    2026-07-22: a director replying from the shared kreweofvaporwave@ alias is
    indistinguishable in the archive from aedile replying. The Log is the
    second signal, and this is the cross-reference that file proposes.

    Not the Log's MessageID, though, which is a trap: on `draft_reply` and
    `bump_auto_reply` rows it is the id of the message aedile was REPLYING TO,
    so joining on it marks the human's message as aedile's. Only the outbound
    rows' Subject describes aedile's own text.

    Tri-state on purpose, because "unknown" and "no" are different claims:
      True   an outbound Log row carries this exact subject, close enough in
             time (see SENT_AFTER_LOG_MAX / SENT_BEFORE_LOG_MAX)
      False  aedile did not write it -- either not from a krewe address at
             all, or from one inside the Log's window with no matching row,
             which is the alias-ambiguity case and is now countable
      None   from a krewe address but older than the Log's earliest row, so
             there is no evidence either way. Do not read it as False.

    Times are compared as INSTANTS, not as strings. The Log writes UTC with
    a Z and the corpus writes -05:00, so `'2026-09-26T19:34:12-05:00' >=
    '2026-09-27T00:34:12Z'` is False lexically and True in fact -- which is
    how the first version of this missed both of the rows it was written to
    catch.

    The window is asymmetric, which the second version got wrong: a
    symmetric 36h missed `Wings tonight at Half Moon`, logged 2026-09-14 and
    sent 2026-09-16. That is not skew, it is the guardrail working -- aedile
    drafts and a human sends when they get to it, so the forward gap is
    human-paced and measured in days. Backward, a message can only precede
    its own Log row by clock skew; the observed case is -0.854s, because
    Gmail truncates the send to the second and the Log row is written just
    after.
    """
    out = [r for r in log_rows
           if any(w in str(r['Action']) for w in ('draft', 'reply', 'send'))]
    if not out:
        print('ingest: Log has no outbound rows; nothing can be marked',
              file=sys.stderr)
        return lambda row: None
    floor = min(instant(r['Timestamp']) for r in out)
    seen = {}                       # subject -> every log instant carrying it
    for r in out:
        subj = str(r['Subject']).strip().lower()
        if subj:
            seen.setdefault(subj, []).append(instant(r['Timestamp']))
    print(f'ingest: {len(out)} outbound Log rows, {len(seen)} distinct subjects, '
          f'earliest {floor.date()}', file=sys.stderr)

    def mark(row):
        if (row.get('email') or '').lower() not in KREWE:
            return False
        when = instant(row.get('date_iso'))
        if when is None or when < floor:
            return None                     # predates the evidence
        subj = str(row.get('subject') or '').strip().lower()
        # A bump goes out as "Re: <what was logged>", so try both spellings.
        for cand in (subj, re.sub(r'^re:\s*', '', subj)):
            for logged in seen.get(cand, ()):
                gap = (when - logged).total_seconds()
                if -SENT_BEFORE_LOG_MAX <= gap <= SENT_AFTER_LOG_MAX:
                    return True
        return False

    return mark


def call(action, **params):
    """One retry, loudly, then die.

    The endpoint intermittently answers `Invalid or missing token` to a
    request whose token is fine -- /exec 302s to googleusercontent.com and
    the POST body does not always survive the hop, so the server sees no
    token at all. That is a transport failure, not a semantic one, which is
    the narrow case where a retry is honest rather than papering over.
    Every retry prints, so the flakiness stays visible instead of becoming a
    number nobody can see; twice in a row is a real failure and exits.
    """
    for attempt in (1, 2):
        body = _call_once(action, **params)
        if body.get('ok'):
            return body
        if attempt == 1:
            print(f'ingest: {action} {params} -> {body.get("error")!r}; '
                  f'retrying once', file=sys.stderr)
    raise SystemExit(f'ingest: {action} {params} returned not-ok twice: '
                     f'{json.dumps(body)[:400]}')


def _call_once(action, **params):
    args = [CALL_SH, action] + [f'{k}={v}' for k, v in params.items()]
    out = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if out.returncode:
        raise SystemExit(f'ingest: {action} failed rc={out.returncode}: {out.stderr.strip()}')
    # A non-JSON body is a real failure; let it raise. Never skip a thread --
    # a half-read mailbox that exits 0 is the silent failure this repo's
    # discipline forbids.
    return json.loads(out.stdout)


def from_gmail(query, year_from, year_to):
    """One readInbox per calendar year, because readInbox has no offset
    parameter -- it is `GmailApp.search(q, 0, limit)` with start pinned to 0
    and limit capped at 100, so time windows are the only way to page."""
    seen = 0
    for year in range(year_from, year_to + 1):
        q = f'{query} after:{year}/01/01 before:{year + 1}/01/01'
        for t in call('readInbox', q=q, limit=100)['threads']:
            for m in call('readThread', threadId=t['threadId'])['messages']:
                dt = datetime.fromisoformat(
                    m['date'].replace('Z', '+00:00')).astimezone(LOCAL)
                name, addr = email.utils.parseaddr(m['from'])
                yield {
                    'author': name or addr,
                    'email': addr.lower() or None,
                    'date': legacy_date(dt),
                    'date_iso': dt.isoformat(),
                    'subject': m.get('subject'),
                    # readThread returns GmailMessage.getId(), which is
                    # Gmail's own id, NOT the Message-ID header. The header,
                    # In-Reply-To and References are all reachable through
                    # getRawContent(), which readThread does not return --
                    # widening it would expose full raw message source
                    # through the read endpoint, which is a decision and not
                    # a default. Until then this path cannot do threading.
                    'message_id': None,
                    'gmail_id': m.get('messageId'),
                    'in_reply_to': None,
                    'references': None,
                    'to': m.get('to'), 'cc': m.get('cc'),
                    'body': m.get('body', ''),
                    'topic_url': None,
                    'source': 'gmail',
                }
                seen += 1
    if not seen:
        print(f'ingest: gmail returned nothing for {query!r} in '
              f'{year_from}-{year_to}', file=sys.stderr)


def from_jsonl(path):
    """Any JSONL in this schema, including one this tool wrote earlier. A row
    that already names its source keeps it -- otherwise re-reading a cached
    --gmail pull would demote it to legacy-scrape and lose it in the merge,
    which is exactly what a cache is for avoiding."""
    for line in open(path):
        r = json.loads(line)
        yield {**{f: None for f in FIELDS}, **r,
               'source': r.get('source') or 'legacy-scrape'}


def better(a, b):
    """Prefer the row that actually carries headers; then the longer body."""
    rank = {'mbox': 3, 'gmail': 2, 'legacy-scrape': 1}
    if rank[a['source']] != rank[b['source']]:
        return a if rank[a['source']] > rank[b['source']] else b
    return a if len(a['body'] or '') >= len(b['body'] or '') else b


def merge(streams):
    out = {}
    for seq, row in enumerate(streams):
        k = merge_key(row['date'], row['body'], seq)
        out[k] = better(row, out[k]) if k in out else row
    return list(out.values())


def audit(path):
    rows = [json.loads(l) for l in open(path)]
    n = len(rows)
    prefixes = [re.sub(r'\s+', ' ', r.get('body') or '').strip()[:PREFIX].lower()
                for r in rows]
    keys = [merge_key(r.get('date'), r.get('body'), i) for i, r in enumerate(rows)]
    yrs = sorted({m.group(1) for r in rows
                  if (m := re.search(r', (\d{4}),', str(r.get('date', ''))))})
    print(f'rows                   {n}')
    print(f'email null             {sum(1 for r in rows if not r.get("email"))}')
    print(f'author ellipsized      {sum(1 for r in rows if "..." in str(r.get("author", "")))}')
    print(f'subject present        {sum(1 for r in rows if r.get("subject"))}')
    print(f'message_id present     {sum(1 for r in rows if r.get("message_id"))}'
          f'   (the RFC header -- threading needs it)')
    print(f'gmail_id present       {sum(1 for r in rows if r.get("gmail_id"))}')
    print(f'date_iso present       {sum(1 for r in rows if r.get("date_iso"))}')
    print(f'body empty             {sum(1 for r in rows if not str(r.get("body") or "").strip())}')
    print(f'body-prefix collisions {n - len(set(prefixes))}   '
          f'(first {PREFIX} chars alone -- why the day is in the key)')
    print(f'merge-key collisions   {n - len(set(keys))}   '
          f'(day+body{PREFIX}; 0 means the merge fuses nothing it should not)')
    print(f'years                  {yrs[0]}..{yrs[-1]}' if yrs else 'years   none')


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--mbox', action='append', default=[], metavar='FILE')
    p.add_argument('--jsonl', action='append', default=[], metavar='FILE')
    p.add_argument('--gmail', action='store_true')
    p.add_argument('--mark-aedile', action='store_true',
                   help="set aedile_authored by cross-referencing aedile's Log; "
                        'costs one read call. See aedile_marker().')
    p.add_argument('--query', default='list:kreweofvaporwave.googlegroups.com')
    p.add_argument('--years', default='2019:2026', metavar='FROM:TO')
    p.add_argument('--audit', metavar='FILE',
                   help='measure a JSONL and exit; no ingest')
    p.add_argument('-o', '--out', metavar='FILE', help='default: stdout')
    a = p.parse_args()

    if a.audit:
        return audit(a.audit)
    if not (a.mbox or a.jsonl or a.gmail):
        p.error('give at least one of --mbox, --jsonl, --gmail '
                f'(the legacy archive is {VAULT_JSONL})')

    def streams():
        for f in a.mbox:
            yield from from_mbox(f)
        if a.gmail:
            lo, hi = (int(x) for x in a.years.split(':'))
            yield from from_gmail(a.query, lo, hi)
        for f in a.jsonl:
            yield from from_jsonl(f)

    rows = merge(streams())
    if a.mark_aedile:
        mark = aedile_marker(call_get('log', limit=500)['rows'])
        for r in rows:
            r['aedile_authored'] = mark(r)
        yes = sum(1 for r in rows if r['aedile_authored'] is True)
        unk = sum(1 for r in rows if r['aedile_authored'] is None)
        print(f'ingest: {yes} rows marked aedile-authored, {unk} undeterminable',
              file=sys.stderr)
    rows.sort(key=lambda r: r.get('date_iso') or '')
    fh = open(a.out, 'w') if a.out else sys.stdout
    for r in rows:
        fh.write(json.dumps({f: r.get(f) for f in FIELDS}) + '\n')
    if a.out:
        fh.close()
        print(f'{len(rows)} rows -> {a.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
