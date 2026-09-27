#!/usr/bin/env python3
"""scrape-topics.py -- read the group's own topic pages and emit real mbox.

    python3 aedile/analysis/scrape-topics.py --limit 1 --verbose   # the session gate
    python3 aedile/analysis/scrape-topics.py                       # all 628, resumable
    python3 aedile/analysis/scrape-topics.py --out /path/x.mbox

WHAT THIS FIXES. `messages.jsonl` has no `subject` field at all, `email` is null on 325 of
1099 rows with `author` ellipsized on 802 more, and 28% of bodies are ~101-character Google
Groups list PREVIEWS rather than messages. All three come from scraping the wrong page. A
rendered topic page carries the real subject, the unmangled sender, a timestamp and the full
body -- verified on topic `-13eA6RehIM`:

    <title>  'event promo NEED HELP / throws tomorrow`NEED HELP'
    sender   kreweofv...@gmail.com<kreweofvaporwave@gmail.com>   <- owner rights unmangle it
    date     Jan 29, 2024, 2:48:24 PM
    body     "throws: 8640 Nelson Street, 5pm-10ish, Tuesday (tomorrow) ..."

ENUMERATION IS ALREADY SOLVED, which is why this is small. The corpus carries `topic_url` on
every row: 628 distinct topic IDs. There is no list to paginate, no `_escaped_fragment_`, and
no AJAX crawl -- the fragile half of every Google Groups scraper is simply not needed. Both
published tools for this are dead anyway; see `scrape-paths.md`.

WHY FIREFOX AND NOT CHROMIUM. The session comes out of a Firefox container and Chromium
refused it through three separate cookie-semantics fixes. Playwright's Firefox build accepts
it. Not worth re-litigating: use the browser the cookies came from.

WHY TEXT AND NOT SELECTORS. `[data-message-id]` matches menu buttons here -- three of them,
all carrying the same id, with bodies of "Delete" and "Copy link". The message text is in the
page's rendered text, so this splits that on the header pattern Google renders for every
message (`display<address>` then a date line). That survives a Boq DOM reshuffle in a way a
jsname selector does not.

NEVER WRITES THE VAULT. Output is an mbox at `--out`; merging is `ingest.py`'s job and it
writes a new file.
"""

import argparse
import email.utils
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

VAULT_JSONL = Path('/srv/vaporwave-reports/obsidian-vault/mailing-list-archive/messages.jsonl')
COOKIES = Path('/srv/vaporwave-reports/aedile/.groups-cookies.txt')
GROUP = 'kreweofvaporwave'
LEDGER = Path(__file__).resolve().parent / '.scrape-used.json'

# `display<addr@host>` immediately followed by a date line. Google renders the masked display
# form and the real address together, which is the whole reason owner rights matter.
HEADER_RE = re.compile(
    r'^(?P<display>[^\n<]{0,120})<(?P<addr>[^<>\s@]+@[^<>\s@]+)>\s*\n'
    r'\s*(?P<date>[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2}\s*[AP]M)',
    re.M)


def load_cookies(path):
    """Netscape cookies.txt -> Playwright cookie dicts.

    Host-only cookies go in by `url`, not `domain`: a `__Host-` cookie is INVALID with any
    Domain attribute and the browser drops it silently. Six of these are `__Host-`.
    """
    out = []
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        f = line.split('\t')
        if len(f) < 7:
            continue
        domain, sub, p, secure, expiry, name, value = f[:7]
        is_secure = secure.upper() == 'TRUE'
        c = {'name': name, 'value': value, 'secure': is_secure}
        if sub.upper() != 'TRUE' or name.startswith('__Host-'):
            c['url'] = f"{'https' if is_secure else 'http'}://{domain.lstrip('.')}{p or '/'}"
        else:
            c['domain'] = domain
            c['path'] = p or '/'
        c['sameSite'] = 'None' if is_secure else 'Lax'
        try:
            e = int(float(expiry))
        except (ValueError, OverflowError):
            e = 0
        # Exporters emit 0 for a session cookie and values past 2^31; Playwright accepts only
        # -1 or in-range unix seconds.
        c['expires'] = e if 0 < e < 2 ** 31 else -1
        out.append(c)
    return out


def topic_ids(path=VAULT_JSONL):
    """Every distinct topic id the corpus already knows about, oldest first."""
    seen = {}
    for line in path.read_text(encoding='utf8').splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        m = re.search(r'/c/([^/?#]+)', row.get('topic_url') or '')
        if m:
            seen.setdefault(m.group(1), row.get('date') or '')
    return [t for t, _ in sorted(seen.items(), key=lambda kv: kv[1])]


def parse_date(s):
    """'Jan 29, 2024, 2:48:24 PM' -> RFC2822. No timezone is rendered, so none is claimed:
    the archive's own dates are bare local strings too and `corpus.mjs` documents that."""
    for fmt in ('%b %d, %Y, %I:%M:%S %p', '%b %d, %Y, %I:%M %p'):
        try:
            return email.utils.format_datetime(datetime.strptime(s.strip(), fmt))
        except ValueError:
            continue
    return None


# Material Icons render as private-use codepoints in inner_text, so a raw body arrives
# starting "\ue83a\ue15f\ue5d4" -- three icon buttons, indistinguishable from content to
# anything downstream.
PUA_RE = re.compile(r'[\ue000-\uf8ff]')
# The per-message action rail follows every body. Cutting at the first of these is what
# keeps "Reply all / Reply to author / Forward" out of the corpus.
TAIL_RE = re.compile(
    r'\n\s*(?:Reply all|Reply to author|Forward|Copy link|Report message|Delete|'
    r'Show original|Unsubscribe|You received this message because)\b')


def clean_body(raw):
    """Strip the UI out of a rendered message body."""
    b = PUA_RE.sub('', raw)
    # The recipient line sits between the icons and the text; it is metadata, not body.
    b = re.sub(r'^\s*to [^\n]*\n', '', b, count=1, flags=re.M)
    cut = TAIL_RE.search(b)
    if cut:
        b = b[:cut.start()]
    return re.sub(r'\n{3,}', '\n\n', b).strip()


def split_messages(page_text, subject):
    """One record per message, split on the rendered sender/date header."""
    hits = list(HEADER_RE.finditer(page_text))
    out = []
    for i, m in enumerate(hits):
        body = page_text[m.end():(hits[i + 1].start() if i + 1 < len(hits) else len(page_text))]
        body = clean_body(body)
        out.append({
            'subject': subject,
            'addr': m.group('addr').strip(),
            'display': m.group('display').strip(),
            'date': m.group('date').strip(),
            'body': body,
        })
    return out


def as_mbox(records, topic_id):
    """mbox that `ingest.py --mbox` can read. Its `on_the_list()` filter needs a List-ID."""
    chunks = []
    for r in records:
        d = parse_date(r['date'])
        body = r['body'].replace('\nFrom ', '\n>From ')  # mbox From_ escaping
        head = [
            f"From {r['addr']} {time.asctime()}",
            # Real address only. Emitting `masked <real>` made ingest.py read the MASKED
            # display name as the address, reintroducing the ellipsized form this whole
            # scrape exists to eliminate.
            f"From: <{r['addr']}>",
            f"Subject: {r['subject']}",
            f"List-ID: <{GROUP}.googlegroups.com>",
            f"X-Topic-Id: {topic_id}",
            'Content-Type: text/plain; charset=utf-8',
        ]
        if d:
            head.append(f'Date: {d}')
        chunks.append('\n'.join(head) + '\n\n' + body + '\n\n')
    return ''.join(chunks)


def scrape(limit=None, out_path=None, verbose=False, headless=True):
    from playwright.sync_api import sync_playwright

    if not COOKIES.exists():
        sys.exit(f'no session at {COOKIES} -- run container-cookies.py first')
    cookies = load_cookies(COOKIES)

    used = set(json.loads(LEDGER.read_text())) if LEDGER.exists() else set()
    todo = [t for t in topic_ids() if t not in used]
    if limit:
        todo = todo[:limit]
    out_path = Path(out_path or (Path(tempfile.gettempdir()) / f'{GROUP}-topics.mbox'))
    print(f'topics: {len(todo)} to do, {len(used)} already in the ledger', flush=True)
    print(f'out: {out_path}', flush=True)

    done = failed = messages = 0
    with sync_playwright() as pw:
        browser = pw.firefox.launch(headless=headless)
        ctx = browser.new_context()
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        try:
            for n, tid in enumerate(todo, 1):
                url = f'https://groups.google.com/g/{GROUP}/c/{tid}'
                try:
                    page.goto(url, wait_until='domcontentloaded', timeout=60000)
                    # Poll for the message header rather than sleeping a guessed interval.
                    # A fixed 2.5s read the nav chrome and none of the conversation, which
                    # parses to zero messages and is indistinguishable from an empty topic.
                    # Fast pages now cost ~1s instead of 2.5, slow ones get up to 25.
                    text, subject = '', ''
                    deadline = time.monotonic() + 25
                    while time.monotonic() < deadline:
                        page.wait_for_timeout(700)
                        text = page.inner_text('body')
                        if HEADER_RE.search(text):
                            break
                        if 'Content unavailable' in text:
                            break
                    subject = (page.title() or '').strip()

                    # THE SESSION GATE. Checked every page, not just the first: a session
                    # can lapse mid-run and the failure mode is 628 pages of a public shell
                    # that parse to zero messages and look like an empty group.
                    if 'Content unavailable' in text or (
                            'Sign in' in text and 'My groups' not in text):
                        print(f'\nSTOP: not signed in at topic {n} ({tid}). '
                              f'Re-run container-cookies.py; Firefox must have written the '
                              f'session to disk.', flush=True)
                        break

                    records = split_messages(text, subject)
                    if not records:
                        failed += 1
                        if verbose:
                            print(f'  [{n}/{len(todo)}] {tid}: no messages parsed', flush=True)
                        continue

                    # Flush per topic, so a crash costs the topic in flight and nothing
                    # before it. Ledger written after the append, never before.
                    with out_path.open('a', encoding='utf8') as fh:
                        fh.write(as_mbox(records, tid))
                    used.add(tid)
                    LEDGER.write_text(json.dumps(sorted(used)))
                    done += 1
                    messages += len(records)
                    if verbose or n % 25 == 0:
                        print(f'  [{n}/{len(todo)}] {tid}: {len(records)} msg  '
                              f'subject={subject[:48]!r}', flush=True)
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    # One topic dying costs one topic. duel.mjs learned this the hard way.
                    failed += 1
                    print(f'  [{n}/{len(todo)}] {tid}: FAILED {type(e).__name__}', flush=True)
        finally:
            browser.close()

    print(f'\ntopics scraped {done}, failed {failed}, messages {messages}', flush=True)
    print(f'mbox: {out_path}', flush=True)
    return done, failed, messages


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--limit', type=int)
    ap.add_argument('--out')
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--headed', action='store_true', help='watch it work')
    a = ap.parse_args()
    done, failed, _ = scrape(a.limit, a.out, a.verbose, headless=not a.headed)
    sys.exit(0 if done else 1)


if __name__ == '__main__':
    main()
