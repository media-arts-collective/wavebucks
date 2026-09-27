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
    check('mbox row count', len(rows), 2)
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

print('\n'.join(f'FAIL {f}' for f in fails) if fails
      else 'ingest.test.py: all cases pass')
sys.exit(1 if fails else 0)
