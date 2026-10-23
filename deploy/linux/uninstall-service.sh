#!/bin/sh
# systemd 서비스(edu-cert)를 멈추고 등록을 지운다. 데이터는 그대로 둔다.
set -e
[ "$(id -u)" -eq 0 ] || { echo "root 권한이 필요합니다: sudo $0"; exit 1; }
systemctl disable --now edu-cert.service 2>/dev/null || true
rm -f /etc/systemd/system/edu-cert.service
systemctl daemon-reload
echo "edu-cert 서비스 등록을 지웠습니다."
