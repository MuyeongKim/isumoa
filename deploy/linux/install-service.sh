#!/bin/sh
# 법정교육 이수증 종합 플랫폼을 systemd 서비스(edu-cert)로 등록한다. root로 실행:
#   sudo ./service/install-service.sh
# 서비스는 설치 폴더 주인 계정으로 돈다 (RUN_USER=계정 으로 바꿀 수 있음). root 계정으로 돌리지 않기를 권한다.
set -e
[ "$(id -u)" -eq 0 ] || { echo "root 권한이 필요합니다: sudo $0"; exit 1; }
DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${RUN_USER:-$(stat -c %U "$DIR")}"
UNIT=/etc/systemd/system/edu-cert.service

cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=Statutory training certificate platform (edu-cert)
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
# 처리 중인 쪽을 마칠 때까지 기다린다 (AI 제한 시간보다 길게)
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
systemctl enable --now edu-cert.service
echo "등록했습니다: edu-cert (실행 계정 $RUN_USER)"
echo "상태: systemctl status edu-cert · 로그: journalctl -u edu-cert 또는 $DIR/logs"
