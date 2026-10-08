#!/usr/bin/env bash
# Only let your carriers reach the SIP port (5060). The internet is full of bots that try to place
# free calls through any open SIP server; LiveKit rejects them, but each attempt costs CPU and logs.
#
# Uses the carrier IPs already in infra/.env (TELNYX_SIP_IPS, TWILIO_SIP_IPS). Safe to run again
# after changing them. Run as root:   sudo ./sip-firewall.sh
# Undo:                               sudo ./sip-firewall.sh --remove
set -euo pipefail

cd "$(dirname "$0")"
CHAIN=VOICE_SIP
PORT=5060

remove() {
  for t in iptables ip6tables; do
    for p in udp tcp; do
      while $t -D INPUT -p "$p" --dport "$PORT" -j "$CHAIN" 2>/dev/null; do :; done
    done
    $t -F "$CHAIN" 2>/dev/null || true
    $t -X "$CHAIN" 2>/dev/null || true
  done
}

if [[ "${1:-}" == "--remove" ]]; then
  remove
  echo "SIP firewall removed: port $PORT is open to everyone again."
  exit 0
fi

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' '; }
IFS=',' read -r -a IPS <<< "$(env_value TELNYX_SIP_IPS),$(env_value TWILIO_SIP_IPS)"

v4=() v6=()
for ip in "${IPS[@]}"; do
  [[ -z "$ip" ]] && continue
  if [[ "$ip" == *:* ]]; then v6+=("$ip"); else v4+=("$ip"); fi
done
if (( ${#v4[@]} + ${#v6[@]} == 0 )); then
  echo "TELNYX_SIP_IPS and TWILIO_SIP_IPS are empty in infra/.env, so nothing would get through. Not changing anything." >&2
  exit 1
fi

# Servers that use ufw: add the rules there (installing iptables-persistent would remove ufw).
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  remove
  for p in udp tcp; do
    ufw --force delete allow "$PORT/$p" >/dev/null 2>&1 || true
    ufw --force delete allow "$PORT" >/dev/null 2>&1 || true
    ufw --force delete deny "$PORT/$p" >/dev/null 2>&1 || true  # re-added last, after the allows
    for ip in "${v4[@]}" "${v6[@]}"; do ufw allow proto "$p" from "$ip" to any port "$PORT" >/dev/null; done
    ufw deny "$PORT/$p" >/dev/null
  done
  echo "ufw: SIP port $PORT now only accepts ${v4[*]} ${v6[*]} (ufw keeps the rules after a reboot)."
  exit 0
fi

remove
for t in iptables ip6tables; do
  $t -N "$CHAIN"
  for p in udp tcp; do $t -I INPUT -p "$p" --dport "$PORT" -j "$CHAIN"; done
done
for ip in "${v4[@]}"; do iptables -A "$CHAIN" -s "$ip" -j RETURN; done
for ip in "${v6[@]}"; do ip6tables -A "$CHAIN" -s "$ip" -j RETURN; done
iptables -A "$CHAIN" -j DROP
ip6tables -A "$CHAIN" -j DROP

echo "SIP port $PORT now only accepts: ${v4[*]} ${v6[*]}"
if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save >/dev/null && echo "Saved: the rules survive a reboot."
else
  echo "These rules last until the next reboot. To keep them: apt-get install -y iptables-persistent && netfilter-persistent save"
  echo "(Only if you don't use ufw: installing iptables-persistent removes it.)"
fi
