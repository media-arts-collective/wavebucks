#!/usr/bin/env python3
"""Cases for scrape-topics.py. Run: python3 aedile/analysis/scrape-topics.test.py

The browser half cannot be tested here and is not the risky half. What decides whether
the corpus is right is the PARSING: which rendered text counts as a message header, what
gets stripped out of a body, and how a cookie file becomes cookies a browser accepts.
Every one of those functions is pure, and every case below is a defect that actually
happened on 2026-09-27 rather than a shape someone imagined:

  - a COLLAPSED message renders its sender with no address at all, and must not parse
  - `TIME_RE` was written `r'\\d'` in a raw string, so it matched a literal backslash and
    every topic "parsed zero messages" in 2-3 seconds
  - Material Icons arrive as private-use codepoints and looked like body content
  - the per-message action rail followed every body into the corpus
  - a `__Host-` cookie is invalid with a Domain attribute and was being dropped silently
  - an expiry outside 0 < e < 2**31 made Playwright reject the whole cookie set
"""

import importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('st', os.path.join(HERE, 'scrape-topics.py'))
st = importlib.util.module_from_spec(spec)
spec.loader.exec_module(st)

fails = []


def check(name, got, want):
    if got != want:
        fails.append(f'{name}: got {got!r}, want {want!r}')


# --- the header, which is the whole difference between expanded and collapsed ----------

EXPANDED = 'mburns70124<mburns70124@gmail.com>\nApr 29, 2022, 11:08:42 AM\n\nI have a 4 runner.'
COLLAPSED = 'mburns70124\nApr 29, 2022, 11:08:42 AM\n\nI have a 4 runner and can be'

m = st.HEADER_RE.match(EXPANDED)
check('expanded header matches', bool(m), True)
check('address is the real one', m.group('addr') if m else None, 'mburns70124@gmail.com')
check('display keeps the masked form', m.group('display') if m else None, 'mburns70124')
# THE LOAD-BEARING CASE. A collapsed message has no address, so it must not parse -- that
# is what makes a partial extraction detectable instead of silently banked short.
check('collapsed header does NOT match', bool(st.HEADER_RE.match(COLLAPSED)), False)
check('masked-only sender does not match',
      bool(st.HEADER_RE.match('kreweofv...@gmail.com\nApr 29, 2022, 10:55:22 AM\n\nhi')), False)
# The operator's own messages render both forms together; owner rights are what reveal it.
check('masked display with real address matches',
      bool(st.HEADER_RE.match('kreweofv...@gmail.com<kreweofvaporwave@gmail.com>\n'
                              'Apr 29, 2022, 10:55:22 AM\n\nhi')), True)

# --- TIME_RE: the raw-string bug, as its own case --------------------------------------

check('TIME_RE finds a rendered timestamp',
      bool(st.TIME_RE.search('Apr 29, 2022, 11:08:42 AM')), True)
check('TIME_RE does not match a literal backslash-d',
      bool(st.TIME_RE.search(r'\d')), False)
check('TIME_RE needs seconds, not just h:mm',
      bool(st.TIME_RE.search('11:08 AM')), False)

# --- clean_body ------------------------------------------------------------------------

check('private-use icon codepoints are stripped',
      st.clean_body(' hello'), 'hello')
check('the action rail is cut at the first marker',
      st.clean_body('the real body\nReply all\nForward\nCopy link'), 'the real body')
check('a recipient line is metadata, not body',
      st.clean_body('to mburns70124, kreweofvaporwave\nthe real body'), 'the real body')
check('Show original is a rail marker too',
      st.clean_body('body here\nShow original'), 'body here')
check('runs of blank lines collapse to one gap',
      st.clean_body('a\n\n\n\n\nb'), 'a\n\nb')
# "Reply" inside prose is not the rail. The markers are anchored to a line start.
check('the word Forward inside a sentence survives',
      st.clean_body('Please Forward this to the krewe'), 'Please Forward this to the krewe')

# --- parse_date -----------------------------------------------------------------------

check('a rendered date becomes RFC2822',
      st.parse_date('Apr 29, 2022, 11:08:42 AM').startswith('Fri, 29 Apr 2022 11:08:42'), True)
check('the seconds-less form also parses',
      st.parse_date('Apr 29, 2022, 11:08 AM') is not None, True)
check('an unparseable date returns None, it does not raise',
      st.parse_date('sometime last Tuesday'), None)

# --- as_mbox: the masked-address regression -------------------------------------------

rec = [{'subject': 'tomorrow 10am', 'addr': 'mburns70124@gmail.com',
        'display': 'mburns70124', 'date': 'Apr 29, 2022, 11:08:42 AM',
        'body': 'I have a 4 runner.'}]
box = st.as_mbox(rec, 'TqKFCHIWJEw')
# Emitting `masked <real>` made ingest.py read the MASKED name as the address, which is
# the exact defect the scrape exists to remove.
check('From: carries the real address alone', 'From: <mburns70124@gmail.com>' in box, True)
check('the masked display name is NOT in the From header',
      'From: mburns70124<' in box, False)
check('List-ID is present so ingest.py on_the_list() keeps it',
      'List-ID: <kreweofvaporwave.googlegroups.com>' in box, True)
check('the topic id is recorded', 'X-Topic-Id: TqKFCHIWJEw' in box, True)
check('the subject survives', 'Subject: tomorrow 10am' in box, True)
# mbox From_ escaping: a body line starting "From " would otherwise split the message.
esc = st.as_mbox([{**rec[0], 'body': 'hi\nFrom the top'}], 'x')
check('a body line beginning "From " is escaped', '\n>From the top' in esc, True)

# --- load_cookies: the two rules that silently dropped a session -----------------------

import tempfile
COOKIES = '\n'.join([
    '# Netscape HTTP Cookie File',
    '\t'.join(['.google.com', 'TRUE', '/', 'TRUE', '1900000000', 'SID', 'v1']),
    '\t'.join(['groups.google.com', 'FALSE', '/', 'TRUE', '1900000000', 'HOSTONLY', 'v2']),
    '\t'.join(['.google.com', 'TRUE', '/', 'TRUE', '1900000000', '__Host-X', 'v3']),
    '\t'.join(['.google.com', 'TRUE', '/', 'TRUE', '0', 'SESSIONCOOKIE', 'v4']),
    '\t'.join(['.google.com', 'TRUE', '/', 'TRUE', '99999999999', 'FARFUTURE', 'v5']),
    'malformed line with too few fields',
])
with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False) as fh:
    fh.write(COOKIES + '\n')
    path = fh.name
try:
    import pathlib
    cs = {c['name']: c for c in st.load_cookies(pathlib.Path(path))}
finally:
    os.unlink(path)

check('the malformed line is skipped, not fatal', len(cs), 5)
check('a normal cookie goes in by domain', cs['SID'].get('domain'), '.google.com')
check('a host-only cookie goes in by url, never domain',
      ('url' in cs['HOSTONLY'], 'domain' in cs['HOSTONLY']), (True, False))
# A `__Host-` cookie is INVALID with any Domain attribute; six of these were being
# dropped silently, which is a session that looks complete and does not authenticate.
check('a __Host- cookie goes in by url even though the file says TRUE',
      ('url' in cs['__Host-X'], 'domain' in cs['__Host-X']), (True, False))
check('expiry 0 (a session cookie) becomes -1', cs['SESSIONCOOKIE']['expires'], -1)
check('an expiry past 2**31 becomes -1 rather than being rejected',
      cs['FARFUTURE']['expires'], -1)
check('an in-range expiry is kept', cs['SID']['expires'], 1900000000)

print('\n'.join(f'FAIL {f}' for f in fails) if fails
      else 'scrape-topics.test.py: all cases pass')
sys.exit(1 if fails else 0)
