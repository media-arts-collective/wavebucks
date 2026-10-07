#!/usr/bin/env python3
"""ingest.py -- rebuild messages.jsonl from a source that carries headers.

    --mbox FILE   An mbox from a mailbox that was subscribed to the list.
                  FILTERED to the group by default: a Takeout mbox is the
                  whole account. See `on_the_list`.
    --gmail       The krewe Office mailbox through aedile's read endpoint.
                  No Message-ID, In-Reply-To or References, so no threading.
    --jsonl FILE  The existing archive, as a floor. Carries no headers.

Sources MERGE rather than replace, because none of them is complete.
"""

import argparse, email, email.policy, email.utils, hashlib, json, mailbox
import os, re, subprocess, sys, time
from datetime import datetime
from zoneinfo import ZoneInfo

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()

# `date` is wall-clock with no offset. An mbox carries the sender's own offset and
# is used as-is; Gmail's API hands back UTC, so Gmail rows are converted first.
LOCAL = ZoneInfo('America/Chicago')
VAULT_JSONL = '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive/messages.jsonl'
CALL_SH = 'aedile/recap/call.sh'

# `message_id` is the RFC-2822 Message-ID HEADER and nothing else. Gmail's own
# per-message id lives in `gmail_id`; a join across the two returns zero rows.
FIELDS = ['author', 'email', 'email_inferred', 'date', 'date_iso', 'subject',
          'message_id', 'gmail_id', 'in_reply_to', 'references', 'to', 'cc',
          'body', 'topic_url', 'source', 'aedile_authored']

# Addresses aedile can send under.
KREWE = ('kreweofvaporwave@kreweofvaporwave.com', 'kreweofvaporwave@gmail.com',
         'kreweofvaporwave@googlegroups.com')


def legacy_date(dt):
    """The old `date` spelling: local wall-clock, no offset. Emitted so
    corpus.mjs keeps working unchanged; `date_iso` carries the real instant."""
    h = dt.hour % 12 or 12
    return (f"{MONTHS[dt.month - 1]} {dt.day}, {dt.year}, "
            f"{h}:{dt.minute:02d}:{dt.second:02d} {'PM' if dt.hour >= 12 else 'AM'}")


PREFIX = 60   # characters of body in the merge key; see merge_key()
# Asymmetric: forward is a human getting round to sending the draft; backward is
# only clock skew between Gmail's send time and the Log write.
SENT_AFTER_LOG_MAX = 14 * 86400
SENT_BEFORE_LOG_MAX = 300


def instant(iso):
    """An aware datetime out of either clock's spelling, or None."""
    if not iso:
        return None
    dt = datetime.fromisoformat(str(iso).replace('Z', '+00:00'))
    # A scraped topic page renders no timezone, so naive means LOCAL.
    return dt if dt.tzinfo else dt.replace(tzinfo=LOCAL)


def calendar_day(date):
    """Y-Mon-DD out of the legacy date spelling, 'Jan 29, 2024, 2:48:24 PM'."""
    m = re.match(r'(\w{3}) (\d{1,2}), (\d{4})', re.sub(r'\s+', ' ', str(date)).strip())
    return f'{m.group(3)}-{m.group(1)}-{int(m.group(2)):02d}' if m else '?'


QUOTES = str.maketrans({'\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"'})


def merge_key(date, body, seq):
    """Identity of a message ACROSS sources: calendar day plus a body prefix.

    Not Message-ID (the legacy rows have none), not the timestamp to the second
    (Google Groups and Gmail disagree on it), and the prefix must sit below the
    point where a preview snippet is cut.
    """
    # Only one source carries these: curly quotes, icon glyphs, a byte-order mark.
    text = re.sub(r'[\ue000-\uf8ff\ufeff]', '', (body or '').translate(QUOTES))
    text = re.sub(r'\s+', ' ', text).strip()[:PREFIX].lower()
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


GROUP = 'kreweofvaporwave'


def on_the_list(msg, group):
    """Is this message list traffic, or just mail in the same mailbox? THIS IS NOT
    AN OPTIMISATION: a Takeout mbox is the WHOLE ACCOUNT."""
    hay = ' '.join(str(msg[h] or '') for h in
                   ('List-ID', 'List-Id', 'X-Google-Group-Id', 'To', 'Cc',
                    'Delivered-To')).lower()
    g = group.lower()
    # Match the group as an ADDRESS, anchored at the end of the domain, never as a
    # bare name: `kreweofvaporwave@gmail.com` is the operator's PERSONAL address.
    return bool(re.search(
        r'(?:^|[\s<,;:])' + re.escape(g) + r'(?:@|\.)googlegroups\.com(?=$|[\s>,;:])', hay))


def from_mbox(path, group=GROUP):
    kept = dropped = 0
    for msg in mailbox.mbox(path, factory=lambda f: email.message_from_binary_file(
            f, policy=email.policy.default)):
        if group and not on_the_list(msg, group):
            dropped += 1
            continue
        dt = email.utils.parsedate_to_datetime(msg['Date']) if msg['Date'] else None
        if not dt:
            continue
        kept += 1
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
            # The scraper enumerates topics from this field.
            'topic_url': (f"https://groups.google.com/g/{GROUP}/c/{msg['X-Topic-Id']}"
                          if msg['X-Topic-Id'] else None),
            'source': 'mbox',
        }
    print(f'ingest: mbox {path}: kept {kept} list messages, '
          f'skipped {dropped} not addressed to {group!r}', file=sys.stderr)


ELLIPSIS = re.compile(r'^(.*?)\.\.\.@(.+)$')


def unmask(rows):
    """Fill `email` where Google Groups ellipsized it, using only the corpus. A
    masked form resolves when exactly one address in the data matches its prefix
    and domain; `kreweofv...@gmail.com` matches two members, so it stays null."""
    plain = {(r.get('email') or '').lower() for r in rows if r.get('email')}
    plain.discard('')
    forms, filled, ambiguous = {}, 0, {}
    for r in rows:
        m = ELLIPSIS.match(str(r.get('author') or '').lower())
        if not m or r.get('email'):
            continue
        form = m.group(0)
        if form not in forms:
            pre, dom = m.groups()
            hits = [a for a in plain if a.endswith('@' + dom) and a.startswith(pre)]
            forms[form] = hits[0] if len(hits) == 1 else None
            if len(hits) != 1:
                ambiguous[form] = hits
        if forms[form]:
            r['email'], r['email_inferred'] = forms[form], True
            filled += 1
    print(f'ingest: unmasked {filled} rows across '
          f'{sum(1 for v in forms.values() if v)} sender forms', file=sys.stderr)
    for form, hits in ambiguous.items():
        print(f'ingest: {form} left null -- {len(hits)} candidates {hits}',
              file=sys.stderr)
    return rows


def call_get(scope, **params):
    args = [CALL_SH, 'get', scope] + [f'{k}={v}' for k, v in params.items()]
    out = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if out.returncode:
        raise SystemExit(f'ingest: get {scope} failed rc={out.returncode}: '
                         f'{out.stderr.strip()}')
    return json.loads(out.stdout)


def aedile_marker(log_rows):
    """Return `row -> True | False | None`, answering "did aedile write this".

    `From` alone cannot answer it: a director replying from the shared alias
    looks the same. Not the Log's MessageID either, which on reply rows is the
    message aedile was REPLYING TO. None is a krewe address older than the Log's
    earliest row: no evidence either way, do not read it as False.
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
    """Retry loudly, then die. The endpoint intermittently loses the token in a
    redirect: a transport failure, the narrow case where a retry is honest."""
    # Every call here is a READ, so repeating one cannot duplicate anything.
    tries = 5
    for attempt in range(1, tries + 1):
        body = _call_once(action, **params)
        if body.get('ok'):
            return body
        if attempt < tries:
            print(f'ingest: {action} {params} -> {str(body.get("error"))[:80]!r}; '
                  f'retry {attempt} of {tries - 1}', file=sys.stderr)
            time.sleep(5 * attempt)
    raise SystemExit(f'ingest: {action} {params} failed {tries} times: '
                     f'{json.dumps(body)[:400]}')


def _call_once(action, **params):
    args = [CALL_SH, action] + [f'{k}={v}' for k, v in params.items()]
    out = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if out.returncode:
        raise SystemExit(f'ingest: {action} failed rc={out.returncode}: {out.stderr.strip()}')
    # An EMPTY or unparseable response is reported as a not-ok body so `call`
    # retries it. Never SKIP a thread: a half-read mailbox must not exit 0.
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return {'ok': False,
                'error': f'unparseable response, {len(out.stdout)} bytes: '
                         f'{out.stdout[:120]!r}'}


def read_thread(t):
    """readThread, kept on disk when $INGEST_GMAIL_CACHE names a directory. The
    files are members' mail: the directory never goes in the repo."""
    cache = os.environ.get('INGEST_GMAIL_CACHE')
    if not cache:
        return call('readThread', threadId=t['threadId'])
    stamp = re.sub(r'\W', '', str(t.get('lastDate')))
    path = os.path.join(cache, f"{t['threadId']}-{stamp}.json")
    if os.path.exists(path):
        return json.load(open(path))
    # PACED: back to back, these reads fail.
    time.sleep(3)
    body = call('readThread', threadId=t['threadId'])
    os.makedirs(cache, exist_ok=True)
    with open(path + '.part', 'w') as fh:
        json.dump(body, fh)
    os.replace(path + '.part', path)
    return body


def from_gmail(query, year_from, year_to):
    """One readInbox per calendar year, because readInbox has no offset parameter.
    Drafts and scheduled mail are not list traffic: keep `-in:drafts` in the query."""
    seen = 0
    for year in range(year_from, year_to + 1):
        q = f'{query} after:{year}/01/01 before:{year + 1}/01/01'
        threads = call('readInbox', q=q, limit=100)['threads']
        if len(threads) >= 100:
            raise SystemExit(f'ingest: {year} returned {len(threads)} threads, the '
                             f'readInbox cap; the year is truncated. Split it by month.')
        for t in threads:
            for m in read_thread(t)['messages']:
                dt = datetime.fromisoformat(
                    m['date'].replace('Z', '+00:00')).astimezone(LOCAL)
                # A SCHEDULED send is dated in the future; `-in:drafts` does not exclude it.
                if dt > datetime.now(LOCAL):
                    print(f"ingest: skipped a message dated {dt.date()}, in the future "
                          f'(a scheduled send)', file=sys.stderr)
                    continue
                name, addr = email.utils.parseaddr(m['from'])
                yield {
                    'author': name or addr,
                    'email': addr.lower() or None,
                    'date': legacy_date(dt),
                    'date_iso': dt.isoformat(),
                    'subject': m.get('subject'),
                    # readThread returns Gmail's own id, NOT the Message-ID
                    # header, so this path cannot do threading.
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
    that already names its source keeps it."""
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
    print(f'email inferred         {sum(1 for r in rows if r.get("email_inferred"))}'
          f'   (unmasked, not read from the source)')
    print(f'author ellipsized      {sum(1 for r in rows if "..." in str(r.get("author", "")))}')
    print(f'subject present        {sum(1 for r in rows if r.get("subject"))}')
    print(f'message_id present     {sum(1 for r in rows if r.get("message_id"))}'
          f'   (the RFC header -- threading needs it)')
    print(f'gmail_id present       {sum(1 for r in rows if r.get("gmail_id"))}')
    print(f'date_iso present       {sum(1 for r in rows if r.get("date_iso"))}')
    print(f'body empty             {sum(1 for r in rows if not str(r.get("body") or "").strip())}')
    lens = [len(str(r.get('body') or '')) for r in rows]
    band = sum(1 for x in lens if 80 <= x <= 101)
    past = sum(1 for x in lens if 102 <= x <= 110)
    print(f'bodies 80-101 chars    {band}'
          f'   ({100 * band // max(n, 1)}% -- Groups preview snippets look like this)')
    print(f'bodies 102-110 chars   {past}'
          f'   (if this is ~0 while the line above is large, they ARE snippets)')
    print(f'body-prefix collisions {n - len(set(prefixes))}   '
          f'(first {PREFIX} chars alone -- why the day is in the key)')
    print(f'merge-key collisions   {n - len(set(keys))}   '
          f'(day+body{PREFIX}; 0 means the merge fuses nothing it should not)')
    print(f'years                  {yrs[0]}..{yrs[-1]}' if yrs else 'years   none')


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--mbox', action='append', default=[], metavar='FILE')
    p.add_argument('--group', default=GROUP,
                   help='keep only mbox messages addressed to this group '
                        f'(default {GROUP!r}). Empty string keeps EVERYTHING, '
                        'including the account\'s personal mail -- see '
                        'on_the_list().')
    p.add_argument('--jsonl', action='append', default=[], metavar='FILE')
    p.add_argument('--gmail', action='store_true')
    p.add_argument('--unmask', action='store_true',
                   help='fill `email` where the scrape ellipsized it, when '
                        'exactly one address in the corpus matches. See unmask().')
    p.add_argument('--mark-aedile', action='store_true',
                   help="set aedile_authored by cross-referencing aedile's Log; "
                        'costs one read call. See aedile_marker().')
    p.add_argument('--query',
                   default='list:kreweofvaporwave.googlegroups.com -in:drafts -in:scheduled',
                   help='Gmail search. Keep -in:drafts unless you mean to '
                        'ingest unsent text; see from_gmail().')
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
            yield from from_mbox(f, a.group)
        if a.gmail:
            lo, hi = (int(x) for x in a.years.split(':'))
            yield from from_gmail(a.query, lo, hi)
        for f in a.jsonl:
            yield from from_jsonl(f)

    rows = merge(streams())
    if a.unmask:
        unmask(rows)
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
