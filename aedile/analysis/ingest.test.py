#!/usr/bin/env python3
"""Cases for ingest.py. Run: python3 aedile/analysis/ingest.test.py

The mbox path is the one that cannot be exercised against live data yet -- no
mbox exists on this box, because producing one needs a Takeout from a mailbox
that was actually subscribed to the list. So it gets a fixture with the four
things that have already gone wrong in this corpus baked in: a timezone that
is not UTC, a MIME multipart body, a non-ASCII charset, and a reply carrying
In-Reply-To/References.
"""

import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
INGEST = os.path.join(HERE, 'ingest.py')

MBOX = b'''From kreweofvaporwave@gmail.com Sun Jan 28 20:48:24 2024
Message-ID: <root@mail.gmail.com>
Date: Mon, 29 Jan 2024 14:48:24 -0600
From: Krewe of Vaporwave <kreweofvaporwave@gmail.com>
To: kreweofvaporwave@googlegroups.com
Subject: Tuesday throws at 8640 Nelson
Content-Type: text/plain; charset="utf-8"

Hi

throws: 8640 Nelson Street, 5pm-10ish, Tuesday (tomorrow)

1. Bring a folding table.
2. Bring the good glue.

From wbbales@example.com Mon Jan 29 21:02:00 2024
Message-ID: <reply@mail.gmail.com>
In-Reply-To: <root@mail.gmail.com>
References: <root@mail.gmail.com>
Date: Mon, 29 Jan 2024 21:02:00 -0600
From: "Bales, W" <wbbales@example.com>
To: kreweofvaporwave@googlegroups.com
Subject: Re: Tuesday throws at 8640 Nelson
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="b1"

--b1
Content-Type: text/plain; charset="iso-8859-1"

I will bring the caf\xe9 table.
--b1
Content-Type: text/html; charset="iso-8859-1"

<div>I have the caf table.</div>
--b1--

From bank@example.com Tue Jan 30 08:00:00 2024
Message-ID: <personal@mail.gmail.com>
Date: Tue, 30 Jan 2024 08:00:00 -0600
From: Example Bank <no-reply@bank.example.com>
To: kreweofvaporwave@gmail.com
Subject: Your January statement is ready
Content-Type: text/plain; charset="utf-8"

Your statement is available. Do not reply.
'''

LEGACY = [
    # Same message as <root@...>, in the legacy shape: no headers, ellipsized
    # author, null email, local wall-clock date. Must dedupe against the mbox
    # row and lose to it.
    # Deliberately NOT byte-identical to the mbox copy, in the three ways the
    # real sources actually differ (measured): the send second is 40s off
    # because Groups logs delivery and Gmail logs receipt; U+202F sits before
    # PM where this tool writes a plain space; and the DOM-to-text pass
    # re-flowed the body, so it diverges past the first 60 characters. It must
    # still collapse onto the mbox row.
    {"author": "kreweofv...@gmail.com", "email": None,
     "date": "Jan 29, 2024, 2:47:44\u202fPM",
     "body": "Hi\n\n\nthrows: 8640 Nelson Street, 5pm-10ish, Tuesday (tomorrow)\n\n\n"
             "1. Bring a folding table. 2. Bring the good glue.\n",
     "topic_url": "https://groups.google.com/g/kreweofvaporwave/c/ONteRcSmHUc"},
    # A message the mbox does not have. Must survive.
    {"author": "T83", "email": None, "date": "Mar 2, 2021, 9:15:00 AM",
     "body": "anyone have a spare hot glue gun",
     "topic_url": "https://groups.google.com/g/kreweofvaporwave/c/aaaaaaaaaaa"},
]

fails = []


def check(name, got, want):
    if got != want:
        fails.append(f'{name}: got {got!r}, want {want!r}')


def run(*args):
    out = subprocess.run([sys.executable, INGEST, *args],
                         capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(f'ingest.py failed: {out.stderr}')
    return [json.loads(l) for l in out.stdout.splitlines()]


with tempfile.TemporaryDirectory() as d:
    mb, lg = os.path.join(d, 'a.mbox'), os.path.join(d, 'legacy.jsonl')
    open(mb, 'wb').write(MBOX)
    with open(lg, 'w') as f:
        for r in LEGACY:
            f.write(json.dumps(r) + '\n')

    rows = run('--mbox', mb)
    # A Takeout mbox is the WHOLE ACCOUNT. The bank statement is addressed to
    # the operator personally, not to the group, and must never reach a krewe
    # corpus that gets read back to a model and quoted in reports.
    check('mbox row count, personal mail excluded', len(rows), 2)
    check('no non-list message survives',
          [r for r in rows if 'statement' in str(r['subject']).lower()], [])
    root, reply = rows[0], rows[1]

    check('subject survives', root['subject'], 'Tuesday throws at 8640 Nelson')
    check('address is real, not ellipsized', root['email'], 'kreweofvaporwave@gmail.com')
    check('display name kept', root['author'], 'Krewe of Vaporwave')
    # -0600 is the whole point: date_iso keeps the offset, `date` keeps the
    # wall-clock hour the sender saw, and they are the same 2:48 PM.
    check('date_iso keeps the offset', root['date_iso'], '2024-01-29T14:48:24-06:00')
    check('legacy date spelling', root['date'], 'Jan 29, 2024, 2:48:24 PM')
    check('threading: in_reply_to', reply['in_reply_to'], '<root@mail.gmail.com>')
    check('threading: references', reply['references'], ['<root@mail.gmail.com>'])
    # The part is latin-1 and says so. Getting 'cafÃ©' back would mean the
    # charset was ignored -- the failure mode that puts mojibake in an archive.
    check('multipart picks text/plain, decoded per its charset',
          reply['body'].strip(), 'I will bring the caf\xe9 table.')
    check('source tagged', root['source'], 'mbox')
    # message_id is the RFC header and gmail_id is Gmail's own; an mbox row
    # has the first and never the second. Joining the two namespaces would
    # return nothing and read as an empty overlap.
    check('mbox carries no gmail_id', root['gmail_id'], None)

    # Merge: the legacy copy of the root message must collapse into the mbox
    # one, and the mbox one must win -- otherwise a re-ingest silently
    # reintroduces the redacted row alongside the good one.
    merged = run('--mbox', mb, '--jsonl', lg)
    check('merged row count', len(merged), 3)
    roots = [r for r in merged if 'throws: 8640 Nelson' in (r['body'] or '')]
    check('root not duplicated', len(roots), 1)
    check('mbox wins the merge', roots[0]['source'], 'mbox')
    check('mbox wins: email filled', roots[0]['email'], 'kreweofvaporwave@gmail.com')
    check('mbox wins: subject filled', roots[0]['subject'],
          'Tuesday throws at 8640 Nelson')
    check('legacy-only row survives', sum(1 for r in merged
                                          if r['source'] == 'legacy-scrape'), 1)

    # Order of sources must not change the outcome.
    other = run('--jsonl', lg, '--mbox', mb)
    check('merge is order-independent',
          sorted(r['message_id'] or r['body'] for r in other),
          sorted(r['message_id'] or r['body'] for r in merged))


# --- aedile_marker ----------------------------------------------------------
# Imported rather than driven through the CLI: the real marker reads the Log
# over the network, and these cases are about the matching, not the fetch.
import importlib.util

spec = importlib.util.spec_from_file_location('ingest', INGEST)
ingest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)

LOG = [
    # A real pair, verbatim from the Log: the send is 0.854s BEFORE its own
    # log row, and the two are written in different offsets. Compared as
    # strings that is False; they are the same instant.
    {'Timestamp': '2026-09-27T00:34:12.854Z', 'Action': 'headsup_draft_posted',
     'Subject': 'Laser harp build day. Sun 9/27 @ 1pm, 920 St. Mary'},
    # Drafted on the 14th, sent by a human on the 16th. A symmetric 36h
    # window called this one False, which was a miss and not skew.
    {'Timestamp': '2026-09-14T02:30:47.232Z', 'Action': 'recap_draft_posted',
     'Subject': 'Wings tonight at Half Moon'},
    {'Timestamp': '2026-07-22T05:44:00.000Z', 'Action': 'bump_auto_reply',
     'Subject': 'Vaporwave Ideas - Notes (Tyler & Zach)'},
    # Must be ignored: it names no outbound text.
    {'Timestamp': '2026-07-01T00:00:00.000Z', 'Action': 'no_action',
     'Subject': 'Something a human wrote'},
]
mark = ingest.aedile_marker(LOG)
KV = 'kreweofvaporwave@kreweofvaporwave.com'


def row(email, iso, subject):
    return {'email': email, 'date_iso': iso, 'subject': subject}


check('marker: same instant, different offsets, 0.854s early',
      mark(row(KV, '2026-09-26T19:34:12-05:00',
               'Laser harp build day. Sun 9/27 @ 1pm, 920 St. Mary')), True)
check('marker: drafted, sent 2.5 days later',
      mark(row(KV, '2026-09-16T09:47:00-05:00', 'Wings tonight at Half Moon')), True)
check('marker: a bump goes out as "Re: <logged subject>"',
      mark(row(KV, '2026-07-22T05:45:00+00:00',
               'Re: Vaporwave Ideas - Notes (Tyler & Zach)')), True)
check('marker: same subject 20 days later is not that draft',
      mark(row(KV, '2026-10-04T09:47:00-05:00', 'Wings tonight at Half Moon')), False)
check('marker: a message cannot precede its draft by an hour',
      mark(row(KV, '2026-09-13T20:30:47-05:00', 'Wings tonight at Half Moon')), False)
check('marker: not a krewe address, so not ambiguous at all',
      mark(row('dangerpine@gmail.com', '2026-09-16T09:47:00-05:00',
               'Wings tonight at Half Moon')), False)
check('marker: krewe address, no matching row -- the alias-ambiguity case',
      mark(row(KV, '2026-09-08T10:02:00-05:00',
               'long meeting / laser harps 2027')), False)
check('marker: older than the Log is None, NOT False',
      mark(row(KV, '2024-01-29T14:48:24-06:00', 'Tuesday throws')), None)
# Dated after the earliest OUTBOUND row, so this is a real False and not an
# out-of-window None: the no_action row is ignored, so it neither marks the
# message nor lowers the floor.
check('marker: a no_action row is not evidence of authorship',
      mark(row(KV, '2026-08-01T00:00:30+00:00', 'Something a human wrote')), False)


# --- unmask -----------------------------------------------------------------
# The ambiguous case is the one that matters and it is real: in the archive
# `kreweofv...@gmail.com` matches the operator AND kreweofvaporware@gmail.com,
# a different member, so 85 rows must stay null rather than be attributed.
UNMASK = [
    {'author': 'rlco...@gmail.com', 'email': None, 'body': 'a'},
    {'author': 'r c', 'email': 'rlcolbert@gmail.com', 'body': 'b'},
    {'author': 'kreweofv...@gmail.com', 'email': None, 'body': 'c'},
    {'author': 'ops', 'email': 'kreweofvaporwave@gmail.com', 'body': 'd'},
    {'author': 'someone else', 'email': 'kreweofvaporware@gmail.com', 'body': 'e'},
    {'author': 'nobody...@gmail.com', 'email': None, 'body': 'f'},
    # Already has an address; unmask must not touch it or claim it inferred.
    {'author': 'thejak...@gmail.com', 'email': 'thejakeman16@gmail.com', 'body': 'g'},
]
ingest.unmask(UNMASK)
by = {r['body']: r for r in UNMASK}

check('unmask: one candidate resolves', by['a']['email'], 'rlcolbert@gmail.com')
check('unmask: and is marked inferred', by['a']['email_inferred'], True)
check('unmask: two candidates stay null', by['c']['email'], None)
check('unmask: no candidate stays null', by['f']['email'], None)
check('unmask: an address already present is untouched',
      by['g']['email'], 'thejakeman16@gmail.com')
check('unmask: and is not claimed as inferred',
      by['g'].get('email_inferred'), None)


# --- on_the_list ------------------------------------------------------------
# The filter is the difference between importing a mailing list and importing
# someone's mail, so both directions get a case.
import email.message
import email.policy as _pol


def msg(**headers):
    m = email.message.EmailMessage(policy=_pol.default)
    for k, v in headers.items():
        m[k.replace('_', '-')] = v
    return m


check('list: List-ID header',
      ingest.on_the_list(msg(List_ID='<kreweofvaporwave.googlegroups.com>',
                             To='someone@example.com'), 'kreweofvaporwave'), True)
check('list: group in To',
      ingest.on_the_list(msg(To='kreweofvaporwave@googlegroups.com'),
                         'kreweofvaporwave'), True)
check('list: group in Cc',
      ingest.on_the_list(msg(To='a@b.com', Cc='kreweofvaporwave@googlegroups.com'),
                         'kreweofvaporwave'), True)
check('NOT list: personal mail to the operator',
      ingest.on_the_list(msg(To='kreweofvaporwave@gmail.com',
                             Subject='Your statement'), 'kreweofvaporwave'), False)
check('NOT list: unrelated mail entirely',
      ingest.on_the_list(msg(To='someone@example.com'), 'kreweofvaporwave'), False)

print('\n'.join(f'FAIL {f}' for f in fails) if fails
      else 'ingest.test.py: all cases pass')
sys.exit(1 if fails else 0)
