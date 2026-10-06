#!/bin/bash
# loops.sh -- open loops, one per line: Id, owner, due, counterpart, ask.
# The SessionStart hook in .claude/settings.json runs this (#85), so a session
# starts knowing what the krewe owes. Reads the private sheet; prints nothing
# that is in git.
set -euo pipefail
"$(dirname "$0")/call.sh" get loops open=true | python3 -c "
import json, sys
d = json.load(sys.stdin)
if not d.get('ok'): sys.exit('loops.sh: ' + json.dumps(d))
print('Open loops (%d):' % d['count'])
for r in d['rows']:
    print('  %s  %s  due %s  %s: %s' % (r['Id'], r['Owner'], str(r['Due'])[:10] or '-', r['Counterpart'] or '-', r['Ask']))
"
