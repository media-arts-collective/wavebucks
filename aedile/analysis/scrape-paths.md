# Getting the krewe's Google Group history: what works, what is dead

Tested 2026-09-26 with a real session. Every verdict below has the command that produced
it. This file exists so nobody spends another evening on a tool that cannot work.

## The session works. Authentication was never the blocker.

`aedile/analysis/container-cookies.py` exports the `kreweofvaporwave` Firefox container
(userContextId=8) as Netscape `cookies.txt`. Zach holds group **owner** on that account.

```
$ curl -s -b /srv/vaporwave-reports/aedile/.groups-cookies.txt \
    -o /tmp/probe.html -w 'http=%{http_code} redirects=%{num_redirects}\n' \
    -L 'https://groups.google.com/g/kreweofvaporwave'
http=200 redirects=0        bytes=1079224
access-error: 0             account email present in page: 7
```

A previous session concluded both scraping routes were "dead on authentication" after two
tests: anonymous `curl`, and one browser that is not a member of this group. That
conclusion was wrong about the cause. The session is fine; the **endpoints** are gone.

## Dead: `henryk/gggd`

Python 2.7 (no `python2` on this host) driving lynx, and every URL it uses is retired:

| endpoint | result |
|---|---|
| `/forum/feed/GROUP/msgs/rss.xml?num=N` | **404** |
| `/forum/feed/GROUP/msgs/atom.xml?num=N` | **404** |
| `/forum/?_escaped_fragment_=topic/GROUP/TOPIC` | 200, but 21 KB of *"Redirecting to Google Groups"* |
| `/forum/message/raw?msg=GROUP/TOPIC/MSG` | **404** |

`_escaped_fragment_` was Google's AJAX-crawling scheme, deprecated in 2015. The
`/forum/message/raw` endpoint would have been the prize — raw RFC822 per message — and it
is gone with the rest of the old UI.

## Dead: `icy/google-group-crawler`

Its own README, first line: *"WARNING: This project doesn't work and it's deprecated.
**Reason:** Ajax support is completely deprecated by Google."* Same `_escaped_fragment_`
dependency. Not tested further; the author's notice is enough.

## Dead for our purpose: the modern page as HTML

```
$ curl -s -b <cookies> 'https://groups.google.com/g/kreweofvaporwave/c/-13eA6RehIM'
1014118 bytes
  AF_initDataCallback blobs: 17, sizes 51..659
  contains 'Hi friends': 0    'Subject': 0    'wrote:': 0
```

A megabyte of Boq SPA shell with no message content in it. Topic bodies arrive in a
follow-up `batchexecute` RPC, so `curl` alone cannot reach them however good the session is.

## What is left, and it is better than it sounds

**A browser-driven scrape of each topic's DETAIL view.** Two facts make this much smaller
and safer than "write a Google Groups crawler":

1. **Enumeration is already solved.** `messages.jsonl` carries `topic_url` on all 1099 rows,
   **628 distinct topic IDs**. So there is no list to paginate, no AJAX crawl, no
   `_escaped_fragment_`. Visit 628 known URLs. Pagination is the fragile half of every DOM
   scraper and we do not need it.

2. **The detail view does not have the defect the old scrape had.** The corpus's 343
   truncated bodies (~101 characters, 31% of rows) are *topic-list previews* — that is what
   a list row shows. A rendered topic view contains the full message and the real subject.
   So the defect this whole effort exists to fix came from scraping the wrong page, not from
   DOM scraping as such.

What a DOM scrape still will not give: RFC822 headers. `Message-ID`, `In-Reply-To` and
`References` are not rendered, so threading stays inferred. Google's per-message "show
original" is the only route to those and its modern URL has not been found. Not a blocker
for anything currently built — everything in `analysis/` groups by the date a message points
at, parsed from body text, never by thread.

**Available infrastructure:** this ecosystem already drives a persistent logged-in Chrome
over CDP (`groc-browser` on dexter, see the `groc-cart` skill). That plus the 628 known URLs
plus the krewe cookies is the whole job.

## Not the path: Google Takeout

Never tested by anyone, and it answers a different question. Takeout returns **a member's
copy**, not the Group archive: only what that account received, only since it subscribed,
minus anything deleted. Measured: the Office mailbox holds **0 threads before
2025/01/01**, and `dangerpine@gmail.com` first posts 2023-01. The account that spans
2019→2026 is `kreweofvaporwave@gmail.com` with 480 messages, so its Sent folder alone would
be most of what is missing — but that is still one mailbox's copy, which is Zach's own
objection to the approach and it is correct.

## Acceptance test, whatever the method

`python3 aedile/analysis/ingest.py --audit <merged>.jsonl` against today's baseline:

| field | now | after a real scrape |
|---|---|---|
| email null | 325 | near 0 (owner rights should unmangle) |
| subject | **0** | near total |
| message_id | 0 | stays 0 for a DOM scrape |
| bodies 80-101 chars | **343 (31%)** | must collapse toward **9** |

If that last band does not collapse, the source is not delivering full bodies and the rest
is not worth running.
