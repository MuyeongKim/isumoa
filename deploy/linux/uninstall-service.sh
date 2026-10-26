#!/bin/sh
# systemd 서비스(isumoa, 이전 이름 edu-cert 포함)를 멈추고 등록을 지운다. 데이터는 그대로 둔다.
set -e
[ "$(id -u)" -eq 0 ] || { echo "root 권한이 필요합니다: sudo $0"; exit 1; }
for name in isumoa edu-cert; do
  systemctl disable --now "$name.service" 2>/dev/null || true
  rm -f "/etc/systemd/system/$name.service"
done
systemctl daemon-reload
echo "isumoa 서비스 등록을 지웠습니다."
