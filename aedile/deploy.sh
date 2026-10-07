#!/usr/bin/env bash
# deploy.sh "<description>" -- the only way the anonymous /exec changes: suites, then
# saved code, then a new version on the deployment call.sh and redige.mjs post to.
# Zach, 2026-10-07: "only push the deployment when the test suite passes."
set -euo pipefail
cd "$(dirname "$0")"
desc=${1:?usage: deploy.sh "<description>"}
[ -z "$(git status --porcelain .)" ] || { echo "deploy: aedile/ has uncommitted changes" >&2; exit 1; }
./test.sh
# The deployment the /exec URL names, read from call.sh, not retyped.
id=$(grep -o 'AKfycb[A-Za-z0-9_-]*' recap/call.sh | sort -u)
[ "$(wc -l <<<"$id")" = 1 ] || { echo "deploy: expected one deployment id in recap/call.sh" >&2; exit 1; }
clasp -u aedile push
clasp -u aedile deploy -i "$id" -d "$desc ($(git rev-parse --short HEAD))"
clasp -u aedile deployments
