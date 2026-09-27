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
# Consecutive post-refresh denials that mean the SESSION died rather than the topic.
MAX_DENIED_IN_A_ROW = 6
# A run of topics that bank NOTHING, whatever the individual symptom. Measured 2026-09-27:
# 70 consecutive topics failed the same way over 40 minutes while the ledger sat still and
# the log looked busy. Refreshing the session is the cheap thing that has fixed every such
# run so far, so it is tried on a schedule; a run that survives the refresh is a real stop.
REFRESH_AFTER_BARREN = 8
MAX_BARREN = 28
# Overridable so a SECOND worker can run concurrently over the same 628 topics from the
# other end of the list (`--reverse`) with its own ledger and its own mbox. The two never
# write the same file, so there is no lock and no race; they meet in the middle, and the
# handful of topics both reach are fused by ingest.py's merge key (day + first 60 body
# characters), which reports 0 collisions on this corpus. Halves wall-clock on a run whose
# per-topic cost is dominated by waiting on Google, not on this box.
LEDGER = Path(os.environ.get(
    'SCRAPE_LEDGER', Path(__file__).resolve().parent / '.scrape-used.json'))

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


def refresh_cookies(ctx):
    """Re-export the live container session into the browser context.

    THE COOKIE FILE IS A SNAPSHOT OF A ROTATING CREDENTIAL. Measured 2026-09-27: a run
    scraped 18 topics, then every subsequent page came back as the signed-out shell. A
    fresh export of the SAME container made the SAME topic (`jx04kDZAANg`) scrape
    immediately -- so the session had not been revoked and this was not rate limiting; a
    throttled host does not hand you a working credential one second later. Google rotates
    the session cookies, Firefox writes the new values, and the exported file goes stale
    where it sits. Any run longer than a few dozen pages outlives its own credential.

    So the export is re-run mid-scrape rather than being a precondition. It reads the
    live browser's cookie DB, which is the only place the current values exist.
    """
    import subprocess
    exporter = Path(__file__).resolve().parent / 'container-cookies.py'
    # Fail loud: a refresh that quietly did nothing would restore the exact silent
    # stall this exists to end.
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


MSG_SEL = 'section[aria-expanded]'

# READINESS IS A CONTENT TEST, NOT A SELECTOR TEST. `section[aria-expanded]` alone is
# matched by non-message chrome that renders BEFORE the conversation does, so waiting on
# the selector returned after ~2 seconds on a page with no messages in it yet: 111 topics
# in one run reported "no messages parsed" in 2-3s each while interleaved topics
# succeeded. A message section carries a timestamp whether it is collapsed or expanded,
# so that is the signal.
TIME_RE = re.compile(r'\d{1,2}:\d{2}:\d{2}')

READY_JS = ("() => [...document.querySelectorAll('section[aria-expanded]')]"
            ".some(s => /\\d{1,2}:\\d{2}:\\d{2}/.test(s.innerText))")


def section_texts(page):
    """Every message-shaped section's rendered text, icons stripped."""
    return [t for t in (PUA_RE.sub('', el.inner_text())
                        for el in page.query_selector_all(MSG_SEL))
            if TIME_RE.search(t)]


def expand_all(page):
    """Expand every message in the topic before reading it.

    THIS IS THE WHOLE SCRAPE. A COLLAPSED message renders its sender MASKED with no
    address at all (`mburns70124`) and its body TRUNCATED mid-sentence ("ESPECIALLY if
    you have a") -- the same ~101-character preview defect this file exists to eliminate,
    reappearing one page deeper than the list view where it was first found. Google
    expands only the LAST message of a topic, so reading the page as rendered keeps
    single-message topics and drops every discussion: 27 topics banked, all `1 msg`, while
    every multi-message topic "parsed to zero". Measured on `TqKFCHIWJEw`: `mburns70124`
    becomes `mburns70124<mburns70124@gmail.com>` and the three bodies come out 308, 846
    and 493 characters instead of one preview.

    THE EXPAND BUTTON IS WAITED FOR ONLY WHEN SOMETHING IS ACTUALLY COLLAPSED. An earlier
    version asked `is_visible()` and returned early if the button had not rendered yet,
    which turned a slow render into a silently dropped topic -- 32 of 47 topics in one
    pass failed that way in 2-3 seconds each. But waiting for a button unconditionally
    costs 15s on every single-message topic, and those are the majority. A collapsed
    message is detectable directly: its section carries a timestamp but no address for
    HEADER_RE to match. So that is the test, and the wait is paid only when it is owed.

    `Show trimmed content` is deliberately NOT clicked -- that expands the quoted reply
    trail, which is not the message and which `normalizeBody` strips everywhere else.
    """
    if all(HEADER_RE.match(t) for t in section_texts(page)):
        return  # nothing collapsed: a single-message topic arrives expanded
    btn = page.wait_for_selector('[aria-label="Expand all"]', state='visible',
                                 timeout=15000)
    try:
        btn.click(timeout=10000)
    except Exception:
        # An obscured or shifting button fails Playwright's actionability checks rather
        # than the click itself. `force` skips those checks; if the click genuinely does
        # nothing, the all-expanded wait below still fails and the topic is still lost
        # loudly, so this cannot quietly bank a truncated message.
        btn.click(force=True, timeout=10000)
    # Waiting on the attribute, not a guessed sleep: the sections expand asynchronously
    # and a fixed delay reads some of them still masked and truncated, which is the
    # failure mode above wearing a smaller number.
    page.wait_for_function(
        "() => [...document.querySelectorAll('section[aria-expanded]')]"
        ".every(s => s.getAttribute('aria-expanded') === 'true')",
        timeout=20000)


def messages_on_page(page, subject):
    """One record per message, read from its own section element.

    Per section rather than a regex over the whole page: each section's text STARTS with
    the header, so message boundaries come from the DOM instead of being inferred from
    where the next header happens to match. `section[aria-expanded]` is also a far better
    handle than `[data-message-id]`, which matches three menu buttons here, all carrying
    the same id, with bodies of "Delete" and "Copy link".
    """
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
    # The count of message-shaped sections comes back too. A record per section or the
    # topic does not land: a COLLAPSED message parses to nothing (it renders no address
    # for HEADER_RE to match), so without this a 3-message topic could bank only its one
    # auto-expanded message and enter the ledger looking complete. That is the snippet
    # defect's exact shape -- quiet, plausible, and only visible in aggregate.
    return out, len(texts)


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
    # Consecutive topics that banked nothing, by any route. See the loop head.
    barren, last_done = 0, 0
    with sync_playwright() as pw:
        browser = pw.firefox.launch(headless=headless)
        ctx = browser.new_context()
        ctx.add_cookies(cookies)
        page = ctx.new_page()
        try:
            for n, tid in enumerate(todo, 1):
                # BARREN RUN DETECTION, in one place because every failure path leads
                # here. Compared against `done` rather than counted in each `except`:
                # there are five ways for a topic to bank nothing and they are not worth
                # five copies of this. A frozen ledger under a busy log is the single
                # symptom every session failure in this scrape has produced.
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
                    # THE SESSION GATE, checked every page and not just the first, with one
                    # refresh-and-retry. A lapsed session renders the public shell, which
                    # parses to zero messages and is indistinguishable from an empty topic,
                    # so 600 pages of nothing look exactly like a slow scrape. Two gated
                    # reads in a row on the SAME topic means the refresh did not help and it
                    # stops -- no third attempt, no evasion.
                    for attempt in (0, 1):
                        page.goto(url, wait_until='domcontentloaded', timeout=60000)
                        # Wait on the message sections, not on a header regex over the
                        # page text. The old poll could not tell "still loading" from
                        # "loaded, but every message is collapsed", so it burned its full
                        # 26-second budget on every multi-message topic and then reported
                        # zero messages.
                        try:
                            page.wait_for_function(READY_JS, timeout=25000)
                        except PWTimeout:
                            pass
                        text = page.inner_text('body')
                        subject = (page.title() or '').strip()
                        # A TOPIC-LEVEL ACCESS ERROR LOOKS EXACTLY LIKE A DEAD SESSION.
                        # Google redirects an inaccessible topic to
                        # `groups.google.com/access-error`, and renders that page in
                        # SIGNED-OUT chrome: "Sign in", no "My groups", 169 characters,
                        # "try switching accounts". So the page cannot tell you which of
                        # the two it is -- and reading it as a dead session aborted a
                        # whole pass on one bad topic, at the NEWEST topic in the list,
                        # while the forward worker ran on happily.
                        #
                        # The refresh below is the right move for either cause and costs
                        # one re-export, so it runs first. What distinguishes them is
                        # whether it KEEPS happening: one topic is a bad topic, many in a
                        # row is a lost session. That is the counter in the caller.
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
                        # The page text, not just the count. A zero-message topic is
                        # indistinguishable from a stall by the ledger alone -- the ledger
                        # only grows on success -- and every guess about WHY was wrong until
                        # this printed what actually rendered.
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
                    # One topic dying costs one topic. duel.mjs learned this the hard way.
                    failed += 1
                    # The exception's first line, not just its class. `TimeoutError` alone
                    # cannot tell a 60s page load from a section that refused to expand,
                    # and those want different fixes.
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
