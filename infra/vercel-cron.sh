#!/bin/bash
# Calls the web app's cron endpoints from the VPS, for Vercel plans that only run crons daily.
#
#   infra/vercel-cron.sh knowledge     every 5 minutes
#   infra/vercel-cron.sh maintenance   hourly
#
# Reads WEB_API_URL and CRON_SECRET (the same value as on Vercel) from /etc/voice-cron.env.
set -euo pipefail
. /etc/voice-cron.env
job="$1"
case "$job" in knowledge|maintenance) ;; *) echo "usage: $0 knowledge|maintenance" >&2; exit 2 ;; esac
curl -fsS --max-time 310 -H "Authorization: Bearer $CRON_SECRET" "$WEB_API_URL/api/cron/$job" \
  | logger -t "voice-cron-$job"
