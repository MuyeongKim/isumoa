#!/bin/sh
# 관리자(root) 권한 없이 서버를 백그라운드로 실행한다. 멈추면 5초 뒤 다시 켠다.
# 서비스 등록(install-service.sh)을 할 수 없는 곳(개인 할당 공간, 컨테이너 등)에서 쓴다.
#   ./service/run-background.sh          켜기
#   ./service/run-background.sh status   상태
#   ./service/run-background.sh stop     끄기 (처리 중인 쪽을 마칠 때까지 기다림)
# 컴퓨터가 다시 켜질 때 자동으로 켜려면 crontab -e 에 한 줄 추가:
#   @reboot /설치폴더/service/run-background.sh
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")/.." || exit 1
DIR="$PWD"
LOGS="$DIR/logs"
mkdir -p "$LOGS"
WATCHER="$LOGS/watcher.pid"
NODE_PID="$LOGS/node.pid"
STOP="$LOGS/stop-requested"
export ECP_CONFIG="$DIR/config.json"

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

case "$1" in
  __loop)
    while [ ! -f "$STOP" ]; do
      "$DIR/node/bin/node" --disable-warning=ExperimentalWarning "$DIR/app/server/src/index.ts" &
      echo $! > "$NODE_PID"
      wait $!
      [ -f "$STOP" ] && break
      echo "$(date '+%F %T') 서버가 멈춰 5초 뒤 다시 켭니다" >> "$LOGS/console.log"
      sleep 5
    done
    rm -f "$STOP" "$NODE_PID" "$WATCHER"
    ;;
  stop)
    if ! alive "$WATCHER"; then echo "실행 중이 아닙니다."; exit 0; fi
    touch "$STOP"
    alive "$NODE_PID" && kill "$(cat "$NODE_PID")"
    i=0
    while alive "$WATCHER" && [ $i -lt 150 ]; do sleep 1; i=$((i + 1)); done
    if alive "$WATCHER"; then echo "아직 끝나지 않았습니다. 잠시 뒤 다시 확인하세요."; exit 1; fi
    echo "껐습니다."
    ;;
  status)
    if alive "$WATCHER"; then
      echo "실행 중 (감시 PID $(cat "$WATCHER"), 서버 PID $(cat "$NODE_PID" 2>/dev/null))"
      echo "로그: $LOGS"
    else
      echo "실행 중이 아닙니다."
      exit 1
    fi
    ;;
  *)
    if alive "$WATCHER"; then echo "이미 실행 중입니다 (PID $(cat "$WATCHER"))."; exit 0; fi
    rm -f "$STOP"
    nohup sh "$SELF" __loop >> "$LOGS/console.log" 2>&1 &
    echo $! > "$WATCHER"
    sleep 3
    if alive "$NODE_PID"; then
      echo "켰습니다. 접속 주소와 오류는 $LOGS 의 로그에서 확인하세요."
    else
      echo "서버가 바로 멈췄습니다. $LOGS/console.log 를 확인하세요."
      exit 1
    fi
    ;;
esac
