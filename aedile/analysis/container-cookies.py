#!/usr/bin/env python3
"""container-cookies.py -- export one Firefox container's cookies as Netscape cookies.txt.

    python3 aedile/analysis/container-cookies.py            # kreweofvaporwave -> the default path
    python3 aedile/analysis/container-cookies.py --list      # show containers, export nothing
    python3 aedile/analysis/container-cookies.py --stdout    # print to stdout instead of the file

WHY THIS IS IN THE REPO. `henryk/gggd` scrapes a Google Group through its internal web RPC
endpoints using an authenticated session, and it wants that session as a Netscape
`cookies.txt` (it drives lynx, whose jar is that format). The session already exists: the
krewe's Google identity lives in a Firefox Multi-Account Container called
`kreweofvaporwave`. Zach, 2026-09-26: *"The firefox container kreweofvaporwave should be
owned by this repo."* So the extraction is a versioned, reviewable script rather than a
remembered click path through a browser add-on.

WHY THE CONTAINER MATTERS AND IS NOT A DETAIL. Firefox partitions cookies per container
via `originAttributes`, so the same `host` appears once per identity. An export that
ignores that silently grabs whichever Google session happens to be in the default
container -- a personal account, most likely -- and the scrape then runs as the wrong
identity and returns either less data or someone else's. This filters on
`userContextId` parsed as a field, never as a substring: `userContextId=8` must not match
`userContextId=80`, which is exactly the class of bug that put a different member's mail
into an operator pool earlier the same day.

WHAT IT DELIBERATELY DOES NOT DO. It never prints a cookie value, not even truncated, and
its summary is counts and hostnames only. The output goes to a 0600 file OUTSIDE the repo,
alongside `.aedile-api-secrets`, because a cookie file inside the repo would not be
ignored by `.gitignore` -- there is no secret pattern there. A guard for that is being
added alongside this, so the mistake becomes impossible rather than merely avoided.

Firefox holds a write lock on `cookies.sqlite` while running, so the DB is copied to a
private temp file first and opened read-only. Nothing about this writes to the browser.

The exported file is a live credential for the krewe's Google account. It expires on its
own, it can be revoked by signing that container out, and it should be deleted once the
scrape is done.
"""

import argparse
import json
import os
import shutil
import sqlite3
import stat
import sys
import tempfile
from pathlib import Path

PROFILE = Path.home() / '.mozilla/firefox/6z5w2rl8.default'
DEFAULT_CONTAINER = 'kreweofvaporwave'
DEFAULT_OUT = Path('/srv/vaporwave-reports/aedile/.groups-cookies.txt')
# The scrape only ever talks to Google. Exporting anything else would put unrelated
# sessions in a file whose whole purpose is one group.
DOMAINS = ('google.com', 'googlegroups.com', 'googleusercontent.com')


def containers(profile=PROFILE):
    """{name: userContextId} for the profile's public containers."""
    data = json.loads((profile / 'containers.json').read_text())
    return {i.get('name'): i['userContextId']
            for i in data.get('identities', [])
            if i.get('public', True) and i.get('name')}


def context_id_of(origin_attributes):
    """Parse userContextId out of Firefox's originAttributes, as a FIELD.

    The string looks like `^userContextId=8` or
    `^firstPartyDomain=example.test&userContextId=8&partitionKey=...`. Substring matching
    would make `userContextId=8` match `userContextId=80`.
    """
    for part in str(origin_attributes or '').lstrip('^').split('&'):
        key, _, value = part.partition('=')
        if key == 'userContextId':
            return value
    return '0'  # the default container writes no attribute at all


def netscape_lines(rows):
    """Netscape cookies.txt: domain, includeSubdomains, path, secure, expiry, name, value."""
    out = ['# Netscape HTTP Cookie File',
           '# Exported by aedile/analysis/container-cookies.py -- one container only.',
           '# This is a live credential. Delete it when the scrape is done.']
    for host, path, name, value, expiry, is_secure in rows:
        out.append('\t'.join([
            host,
            'TRUE' if str(host).startswith('.') else 'FALSE',
            path or '/',
            'TRUE' if is_secure else 'FALSE',
            str(int(expiry or 0)),
            name,
            value,
        ]))
    return '\n'.join(out) + '\n'


def export(container, out_path, to_stdout=False):
    known = containers()
    if container not in known:
        sys.exit(f'container {container!r} not found. Have: {", ".join(sorted(known))}')
    want = str(known[container])

    src = PROFILE / 'cookies.sqlite'
    if not src.exists():
        sys.exit(f'no cookie store at {src}')

    # Copied because Firefox holds a write lock while running. Opened read-only, and the
    # copy lives in a 0700 temp dir that is removed on the way out.
    tmpdir = tempfile.mkdtemp(prefix='cookie-export-')
    os.chmod(tmpdir, stat.S_IRWXU)
    tmp = Path(tmpdir) / 'cookies.sqlite'
    try:
        shutil.copy2(src, tmp)
        con = sqlite3.connect(f'file:{tmp}?mode=ro', uri=True)
        try:
            rows = con.execute(
                'SELECT host, path, name, value, expiry, isSecure, originAttributes '
                'FROM moz_cookies'
            ).fetchall()
        finally:
            con.close()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    mine, skipped_container, skipped_domain = [], 0, 0
    for host, path, name, value, expiry, is_secure, oa in rows:
        if context_id_of(oa) != want:
            skipped_container += 1
            continue
        h = str(host).lstrip('.')
        if not any(h == d or h.endswith('.' + d) for d in DOMAINS):
            skipped_domain += 1
            continue
        mine.append((host, path, name, value, expiry, is_secure))

    text = netscape_lines(mine)

    # Counts and hostnames only. A cookie value never reaches stdout or a log.
    hosts = sorted({r[0] for r in mine})
    print(f'container {container!r} (userContextId={want})')
    print(f'  cookies exported : {len(mine)}')
    print(f'  hosts            : {", ".join(hosts) if hosts else "(none)"}')
    print(f'  skipped, other containers : {skipped_container}')
    print(f'  skipped, non-Google hosts : {skipped_domain}')
    if not mine:
        sys.exit('\nNothing to export. Sign that container in to Google Groups first.')

    if to_stdout:
        sys.stdout.write(text)
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Created 0600 BEFORE anything is written, so the secret is never briefly readable.
    fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as fh:
        fh.write(text)
    print(f'\nwrote {out_path}  mode {oct(out_path.stat().st_mode & 0o777)}')
    print('This is a live credential for the krewe Google account. Delete it when done.')


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--container', default=DEFAULT_CONTAINER)
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--list', action='store_true', help='show containers and exit')
    ap.add_argument('--stdout', action='store_true', help='print instead of writing the file')
    a = ap.parse_args()

    if a.list:
        for name, cid in sorted(containers().items(), key=lambda kv: kv[1]):
            print(f'  userContextId={cid:<4} {name}')
        return
    export(a.container, a.out, to_stdout=a.stdout)


if __name__ == '__main__':
    main()
