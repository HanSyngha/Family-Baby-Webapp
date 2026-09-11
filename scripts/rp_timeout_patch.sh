#!/bin/bash
# 리버스 프록시 2290 블록의 업로드 타임아웃 60→600초. 안전하게: 백업→수정→nginx -t→reload, 실패 시 롤백.
set -e
CONF=/etc/nginx/sites-enabled/server.ReverseProxy.conf
# ⚠️ 백업은 반드시 sites-enabled 밖(/root)에 — 안에 두면 nginx가 중복 서버로 읽어 -t 실패.
BAK="/root/ReverseProxy.conf.bak-$(date +%s)"
cp "$CONF" "$BAK"
echo "backup: $BAK"
# listen 2290 server 블록 안에서만 치환
sed -i '/listen 2290/,/^}/ s/\(proxy_\(connect\|read\|send\)_timeout\) 60;/\1 600;/' "$CONF"
if nginx -t 2>&1 | grep -q successful; then
  nginx -s reload
  echo "PATCHED_AND_RELOADED"
else
  cp "$BAK" "$CONF"
  echo "VALIDATION_FAILED_ROLLED_BACK"
  nginx -t 2>&1 | tail -3
  exit 1
fi
echo "--- 2290 block timeouts now ---"
sed -n '/listen 2290/,/^}/p' "$CONF" | grep -E 'timeout|proxy_pass'
