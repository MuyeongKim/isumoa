#!/bin/sh
# 이수모아를 systemd 서비스(isumoa)로 등록한다. 이전 이름(edu-cert)으로 등록해 둔 것은 지우고 바꾼다. root로 실행:
#   sudo ./service/install-service.sh
# 서비스는 설치 폴더 주인 계정으로 돈다 (RUN_USER=계정 으로 바꿀 수 있음). root 계정으로 돌리지 않기를 권한다.
set -e
[ "$(id -u)" -eq 0 ] || { echo "root 권한이 필요합니다: sudo $0"; exit 1; }
DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${RUN_USER:-$(stat -c %U "$DIR")}"
UNIT=/etc/systemd/system/isumoa.service
OLD_UNIT=/etc/systemd/system/edu-cert.service

# 이전 이름으로 등록되어 있으면 멈추고 지운다 (자료·설정은 그대로)
if [ -f "$OLD_UNIT" ]; then
  systemctl disable --now edu-cert.service 2>/dev/null || true
  rm -f "$OLD_UNIT"
  echo "이전 이름(edu-cert) 서비스 등록을 지웠습니다."
fi

cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=Isumoa - statutory training certificate platform
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$DIR
Environment=ECP_CONFIG=$DIR/config.json
ExecStart=$DIR/node/bin/node --disable-warning=ExperimentalWarning $DIR/app/server/src/index.ts
Restart=always
RestartSec=5
# 처리 중인 쪽을 마칠 때까지 기다린다
TimeoutStopSec=150
# 443 같은 1024 아래 포트를 root 없이 쓰도록
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT_EOF

systemctl daemon-reload
systemctl enable --now isumoa.service
echo "등록했습니다: isumoa (실행 계정 $RUN_USER)"
echo "상태: systemctl status isumoa · 로그: journalctl -u isumoa 또는 $DIR/logs"
