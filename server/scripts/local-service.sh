#!/usr/bin/env bash
# 门户后端本地常驻服务管理（macOS launchd）。
#
#   bash scripts/local-service.sh install    安装并启动，开机自启
#   bash scripts/local-service.sh start      启动
#   bash scripts/local-service.sh stop       停止
#   bash scripts/local-service.sh restart    重启（改完代码用这个）
#   bash scripts/local-service.sh status     查看状态与健康检查
#   bash scripts/local-service.sh logs       跟踪日志
#   bash scripts/local-service.sh uninstall  停止并移除，不删数据库

set -uo pipefail

LABEL="com.hengdian.portal-server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$SERVER_DIR/logs"
NODE_BIN="$(command -v node)"
PORT="${PORT:-8787}"

info() { printf '  %s\n' "$1"; }

write_plist() {
  mkdir -p "$LOG_DIR" "$SERVER_DIR/data"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--experimental-strip-types</string>
    <string>$SERVER_DIR/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$SERVER_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
    <key>DB_PATH</key><string>$SERVER_DIR/data/portal.db</string>
    <key>COOKIE_SECURE</key><string>false</string>
    <key>ALLOWED_ORIGINS</key><string>http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173</string>
    <key>ADMIN_USERNAMES</key><string>hdadmin</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$LOG_DIR/server.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/server.error.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLISTEOF
}

health() {
  curl -s --noproxy '*' --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null
}

case "${1:-status}" in
  install)
    [[ -z "$NODE_BIN" ]] && { echo "未找到 node"; exit 1; }
    write_plist
    launchctl unload "$PLIST" 2>/dev/null
    launchctl load "$PLIST" || { echo "加载失败"; exit 1; }
    sleep 3
    info "已安装并启动　$LABEL"
    info "端口　$PORT"
    info "数据库　$SERVER_DIR/data/portal.db"
    info "日志　$LOG_DIR/server.log"
    info "健康检查　$(health)"
    ;;
  start)
    launchctl load "$PLIST" 2>/dev/null
    sleep 2; info "健康检查　$(health)"
    ;;
  stop)
    launchctl unload "$PLIST" 2>/dev/null
    info "已停止"
    ;;
  restart)
    launchctl unload "$PLIST" 2>/dev/null
    sleep 1
    launchctl load "$PLIST" 2>/dev/null
    sleep 3
    info "已重启　健康检查　$(health)"
    ;;
  status)
    # 先把输出取到变量再匹配。若写成 `launchctl list | grep -q`，
    # grep 命中后立即关闭管道，launchctl 收到 SIGPIPE 返回非零，
    # 在 set -o pipefail 下会被误判为「未注册」。
    listing="$(launchctl list 2>/dev/null)"
    if [[ "$listing" == *"$LABEL"* ]]; then
      info "launchd　已注册"
      detail="$(launchctl list "$LABEL" 2>/dev/null)"
      printf '%s\n' "$detail" | grep -E '"PID"|"LastExitStatus"' | sed 's/^/  /'
    else
      info "launchd　未注册（先执行 install）"
    fi
    local_health="$(health)"
    if [[ -n "$local_health" ]]; then
      info "服务　运行中"
      info "健康检查　$local_health"
    else
      info "服务　无响应"
    fi
    ;;
  logs)
    tail -f "$LOG_DIR/server.log" "$LOG_DIR/server.error.log"
    ;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    info "已移除服务定义。数据库与日志保留在 $SERVER_DIR"
    ;;
  *)
    echo "用法: bash scripts/local-service.sh {install|start|stop|restart|status|logs|uninstall}"
    exit 1
    ;;
esac
