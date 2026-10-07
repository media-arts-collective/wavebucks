#!/usr/bin/env python3
"""scrape-topics.py -- read the group's own topic pages and emit real mbox.

    python3 aedile/analysis/scrape-topics.py --limit 1 --verbose   # the session gate
    python3 aedile/analysis/scrape-topics.py                       # all topics, resumable
    python3 aedile/analysis/scrape-topics.py --out /path/x.mbox

Firefox, because that is the browser the cookies came from. NEVER WRITES THE VAULT:
output is an mbox at `--out`; merging is `ingest.py`'s job.
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
# Consecutive post-refresh denials that mean the SESSION died rather than the topic.
MAX_DENIED_IN_A_ROW = 6
# A run of topics that bank NOTHING. A run that survives a session refresh is a real stop.
REFRESH_AFTER_BARREN = 8
MAX_BARREN = 28
# Overridable so a second worker (`--reverse`) can run with its own ledger and mbox.
LEDGER = Path(os.environ.get(
    'SCRAPE_LEDGER', Path(__file__).resolve().parent / '.scrape-used.json'))

# `display<addr@host>` immediately followed by a date line. A message this account has
# never opened renders one more line, `unread,`, between the two.
HEADER_RE = re.compile(
    r'^(?P<display>[^\n<]{0,120})<(?P<addr>[^<>\s@]+@[^<>\s@]+)>\s*\n'
    r'(?:\s*unread,\s*\n)?'
    r'\s*(?P<date>[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2}\s*[AP]M)',
    re.M)


def load_cookies(path):
    """Netscape cookies.txt -> Playwright cookie dicts. Host-only cookies go in by `url`:
    a `__Host-` cookie is INVALID with any Domain attribute and is dropped silently."""
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


def refresh_cookies(ctx):
    """Re-export the live container session into the browser context. Google rotates
    the session cookies, so the exported file goes stale where it sits."""
    import subprocess
    exporter = Path(__file__).resolve().parent / 'container-cookies.py'
    # Fail loud: a refresh that quietly did nothing would be a silent stall.
    subprocess.run([sys.executable, str(exporter)], check=True,
                   stdout=subprocess.DEVNULL)
    ctx.clear_cookies()
    ctx.add_cookies(load_cookies(COOKIES))


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
    """'Jan 29, 2024, 2:48:24 PM' -> RFC2822. No timezone is rendered, so none is claimed."""
    for fmt in ('%b %d, %Y, %I:%M:%S %p', '%b %d, %Y, %I:%M %p'):
        try:
            return email.utils.format_datetime(datetime.strptime(s.strip(), fmt))
        except ValueError:
            continue
    return None


# Material Icons render as private-use codepoints in inner_text.
PUA_RE = re.compile(r'[\ue000-\uf8ff]')
# The per-message action rail follows every body. Cut at the first of these.
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


MSG_SEL = 'section[aria-expanded]'

# Readiness is a content test: `section[aria-expanded]` alone is matched by chrome that
# renders BEFORE the conversation does. A message section carries a timestamp.
TIME_RE = re.compile(r'\d{1,2}:\d{2}:\d{2}')

READY_JS = ("() => [...document.querySelectorAll('section[aria-expanded]')]"
            ".some(s => /\\d{1,2}:\\d{2}:\\d{2}/.test(s.innerText))")


def section_texts(page):
    """Every message-shaped section's rendered text, icons stripped."""
    return [t for t in (PUA_RE.sub('', el.inner_text())
                        for el in page.query_selector_all(MSG_SEL))
            if TIME_RE.search(t)]


def expand_all(page):
    """Expand every message in the topic before reading it: a COLLAPSED message renders
    its sender masked and its body truncated. `Show trimmed content` is deliberately
    NOT clicked -- that expands the quoted reply trail."""
    if all(HEADER_RE.match(t) for t in section_texts(page)):
        return  # nothing collapsed: a single-message topic arrives expanded
    btn = page.wait_for_selector('[aria-label="Expand all"]', state='visible',
                                 timeout=15000)
    try:
        btn.click(timeout=10000)
    except Exception:
        # `force` skips the actionability checks. If the click does nothing, the
        # all-expanded wait below still fails loudly.
        btn.click(force=True, timeout=10000)
    # Waiting on the attribute, not a guessed sleep: the sections expand asynchronously.
    page.wait_for_function(
        "() => [...document.querySelectorAll('section[aria-expanded]')]"
        ".every(s => s.getAttribute('aria-expanded') === 'true')",
        timeout=20000)


def messages_on_page(page, subject):
    """One record per message, read from its own section element."""
    texts = section_texts(page)
    out = []
    for t in texts:
        m = HEADER_RE.match(t)
        if not m:
            continue
        out.append({
            'subject': subject,
            'addr': m.group('addr').strip(),
            'display': m.group('display').strip(),
            'date': m.group('date').strip(),
            'body': clean_body(t[m.end():]),
        })
    # The count of message-shaped sections comes back too: a COLLAPSED message parses
    # to nothing, and without this a topic could bank short and look complete.
    return out, len(texts)


def as_mbox(records, topic_id):
    """mbox that `ingest.py --mbox` can read. Its `on_the_list()` filter needs a List-ID."""
    chunks = []
    for r in records:
        d = parse_date(r['date'])
        body = r['body'].replace('\nFrom ', '\n>From ')  # mbox From_ escaping
        head = [
            f"From {r['addr']} {time.asctime()}",
            # Real address only: ingest.py reads a masked display name as the address.
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


def scrape(limit=None, out_path=None, verbose=False, headless=True, reverse=False):
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    if not COOKIES.exists():
        sys.exit(f'no session at {COOKIES} -- run container-cookies.py first')
    cookies = load_cookies(COOKIES)

    used = set(json.loads(LEDGER.read_text())) if LEDGER.exists() else set()
    todo = [t for t in topic_ids() if t not in used]
    if reverse:
        todo.reverse()
    if limit:
        todo = todo[:limit]
    out_path = Path(out_path or (Path(tempfile.gettempdir()) / f'{GROUP}-topics.mbox'))
    print(f'topics: {len(todo)} to do, {len(used)} already in the ledger', flush=True)
    print(f'out: {out_path}', flush=True)

    done = failed = messages = 0
    # Consecutive access denials. One is a bad topic; a run of them is a lost session.
    denied = 0
    # Consecutive topics that banked nothing, by any route.
    barren, last_done = 0, 0
    with sync_playwright() as pw:
        browser = pw.firefox.launch(headless=headless)
        ctx = browser.new_context()
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        try:
            for n, tid in enumerate(todo, 1):
                # Compared against `done` so every failure path is covered in one place.
                if done == last_done:
                    barren += 1
                else:
                    barren, last_done = 0, done
                if barren and barren % REFRESH_AFTER_BARREN == 0:
                    print(f'  -- {barren} topics in a row banked nothing; re-exporting '
                          f'the container session', flush=True)
                    refresh_cookies(ctx)
                if barren >= MAX_BARREN:
                    print(f'\nSTOP: {barren} topics in a row banked nothing, through '
                          f'{barren // REFRESH_AFTER_BARREN} session refreshes. Something '
                          f'changed that a fresh cookie does not fix -- read the failures '
                          f'above; the ledger resumes.', flush=True)
                    break

                url = f'https://groups.google.com/g/{GROUP}/c/{tid}'
                t0 = time.monotonic()
                try:
                    # THE SESSION GATE, checked every page: a lapsed session renders the
                    # public shell, which is indistinguishable from an empty topic.
                    for attempt in (0, 1):
                        page.goto(url, wait_until='domcontentloaded', timeout=60000)
                        # Wait on the message sections, not on the page text.
                        try:
                            page.wait_for_function(READY_JS, timeout=25000)
                        except PWTimeout:
                            pass
                        text = page.inner_text('body')
                        subject = (page.title() or '').strip()
                        # A topic-level access error renders the same page as a dead
                        # session. One is a bad topic; many in a row is a lost session.
                        if not ('Sign in' in text and 'My groups' not in text):
                            break
                        if attempt == 0:
                            print(f'  [{n}/{len(todo)}] {tid}: signed out -- '
                                  f're-exporting the container session', flush=True)
                            refresh_cookies(ctx)
                    else:
                        denied += 1
                        if denied >= MAX_DENIED_IN_A_ROW:
                            print(f'\nSTOP: {denied} topics in a row denied after a fresh '
                                  f'export, last {tid}. That is a lost session, not bad '
                                  f'topics -- sign {GROUP} back in, then re-run; the '
                                  f'ledger resumes.', flush=True)
                            break
                        failed += 1
                        print(f'  [{n}/{len(todo)}] {tid}: access denied after refresh '
                              f'({denied} in a row) -- skipping this topic', flush=True)
                        continue
                    denied = 0

                    if 'Content unavailable' in text:
                        failed += 1
                        print(f'  [{n}/{len(todo)}] {tid}: topic unavailable (deleted or '
                              f'moderated) -- skipped, session is fine', flush=True)
                        continue

                    expand_all(page)
                    records, expected = messages_on_page(page, subject)
                    if records and len(records) < expected:
                        failed += 1
                        print(f'  [{n}/{len(todo)}] {tid}: PARTIAL {len(records)}/{expected}'
                              f' messages parsed -- not banked, will retry', flush=True)
                        continue
                    if not records:
                        failed += 1
                        # The page text: the ledger alone cannot tell this from a stall.
                        if verbose:
                            samp = ' / '.join(PUA_RE.sub('', text).split('\n')[:6])[:200]
                            print(f'  [{n}/{len(todo)}] {tid}: no messages parsed '
                                  f'({len(text)}c, {time.monotonic() - t0:.0f}s) '
                                  f'title={subject[:40]!r} text={samp!r}', flush=True)
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
                    # One topic dying costs one topic.
                    failed += 1
                    # The exception's first line, not just its class.
                    why = (str(e).splitlines() or [''])[0][:120]
                    print(f'  [{n}/{len(todo)}] {tid}: FAILED {type(e).__name__}: {why}',
                          flush=True)
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
    ap.add_argument('--reverse', action='store_true',
                    help='newest first, for a second concurrent worker')
    a = ap.parse_args()
    done, failed, _ = scrape(a.limit, a.out, a.verbose, headless=not a.headed,
                             reverse=a.reverse)
    sys.exit(0 if done else 1)


if __name__ == '__main__':
    main()
