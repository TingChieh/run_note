#!/bin/bash
# Local backend lifecycle only; reuse local-auth.py without changing configuration or schema.
set -u
umask 077

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PORT="${BACKEND_PORT:-8001}"
ORIGIN="${SITE_ORIGIN:-http://127.0.0.1:5183}"
PYTHON="$PROJECT_DIR/backend/.venv/bin/python"

case "$PORT" in ''|*[!0-9]*) echo "BACKEND_PORT 必须是数字。" >&2; exit 1 ;; esac
if [ "${#PORT}" -gt 5 ] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "BACKEND_PORT 必须在 1–65535 之间。" >&2
  exit 1
fi
PORT=$((10#$PORT))
STATE_DIR="$PROJECT_DIR/.cache/backend-$PORT"
PID_FILE="$STATE_DIR/backend.pid"
LOG_FILE="$STATE_DIR/backend.log"
BASE_URL="http://127.0.0.1:$PORT"

is_project_backend() {
  local pid="$1" command cwd
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  command="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  case "$command" in
    *" -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port $PORT") ;;
    *) return 1 ;;
  esac
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  [ "$cwd" = "$PROJECT_DIR/backend" ]
}

# Exit 1 means stopped; exit 2 means the port belongs to another process.
backend_pid() {
  local listener pid
  listener="$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u)"
  if [ -n "$listener" ]; then
    if is_project_backend "$listener"; then echo "$listener"; return 0; fi
    echo "端口 ${PORT} 被其他服务占用，未操作该进程。" >&2
    return 2
  fi
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE")"
    if is_project_backend "$pid"; then echo "$pid"; return 0; fi
  fi
  return 1
}

ready() {
  curl --fail --silent --max-time 2 "$BASE_URL/api/v1/health/ready" >/dev/null
}

status_backend() {
  local pid result
  pid="$(backend_pid)"; result=$?
  if [ "$result" -eq 2 ]; then return 1; fi
  if [ "$result" -ne 0 ]; then echo "后端已关闭（端口 ${PORT}）。"; return 0; fi
  if ready; then
    echo "后端运行中：$BASE_URL · PID $pid · 数据库已就绪。"
  else
    echo "后端进程存在（PID ${pid}），健康检查未通过，请查看日志：$LOG_FILE" >&2
    return 1
  fi
}

start_backend() {
  local pid result attempt
  pid="$(backend_pid)"; result=$?
  if [ "$result" -eq 2 ]; then return 1; fi
  if [ "$result" -eq 0 ]; then status_backend; return $?; fi
  if [ ! -x "$PYTHON" ]; then echo "未找到后端虚拟环境：$PYTHON" >&2; return 1; fi
  # local-auth.py preserves the existing key and loads the repository's existing .env.
  pid="$("$PYTHON" - "$PROJECT_DIR" "$PORT" "$ORIGIN" "$LOG_FILE" <<'PY'
import subprocess
import sys
from pathlib import Path

root, port, origin, log = sys.argv[1:]
with open(log, 'ab') as output:
    process = subprocess.Popen(
        [sys.executable, str(Path(root) / 'scripts/local-auth.py'), 'serve',
         '--port', port, '--site-origin', origin],
        cwd=str(Path(root) / 'backend'), stdin=subprocess.DEVNULL,
        stdout=output, stderr=subprocess.STDOUT, start_new_session=True,
    )
print(process.pid)
PY
)" || return 1
  echo "$pid" >"$PID_FILE"
  for attempt in {1..40}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "后端启动失败，请查看日志：$LOG_FILE" >&2
      return 1
    fi
    if is_project_backend "$pid" && ready; then
      echo "后端已启动：$BASE_URL · PID $pid"
      echo "前端来源：$ORIGIN"
      echo "日志：$LOG_FILE"
      return 0
    fi
    sleep 0.25
  done
  echo "后端尚未就绪，请查看日志：$LOG_FILE" >&2
  return 1
}

stop_backend() {
  local pid result attempt
  pid="$(backend_pid)"; result=$?
  if [ "$result" -eq 2 ]; then return 1; fi
  if [ "$result" -ne 0 ]; then rm -f "$PID_FILE"; echo "后端已经关闭。"; return 0; fi
  if ! is_project_backend "$pid"; then echo "进程已变化，请重试。" >&2; return 1; fi
  kill -TERM "$pid" || return 1
  for attempt in {1..40}; do
    if ! is_project_backend "$pid"; then
      rm -f "$PID_FILE"
      echo "后端已关闭（PID ${pid}）。"
      return 0
    fi
    sleep 0.25
  done
  echo "后端仍在处理请求，未强制终止；稍后再检查状态。" >&2
  return 1
}

dispatch_action() {
  local action="$1" result
  case "$action" in
    start) start_backend; result=$? ;;
    stop) stop_backend; result=$? ;;
    restart) stop_backend && start_backend; result=$? ;;
    status) status_backend; result=$? ;;
    logs) if [ -f "$LOG_FILE" ]; then tail -n 60 "$LOG_FILE"; else echo "暂无日志。"; fi; result=0 ;;
    *) echo "用法：$0 [start|stop|restart|status|logs]"; result=1 ;;
  esac
  return "$result"
}

run_action() {
  local action="$1"
  case "$action" in
    status|logs) dispatch_action "$action"; return $? ;;
    start|stop|restart) ;;
    *) dispatch_action "$action"; return $? ;;
  esac
  if [ ! -x "$PYTHON" ]; then echo "未找到后端虚拟环境：$PYTHON" >&2; return 1; fi
  mkdir -p "$STATE_DIR" || return 1
  # An OS file lock is released even after a crash; the lock file can safely remain.
  "$PYTHON" - "$PROJECT_DIR/backend.command" "$action" "$STATE_DIR/action.lock" <<'PY'
import fcntl
import subprocess
import sys

script, action, path = sys.argv[1:]
with open(path, 'a') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('另一个启动/关闭操作正在执行，请稍后重试。', file=sys.stderr)
        sys.exit(1)
    sys.exit(subprocess.call(['/bin/bash', script, '--locked-action', action],
                             pass_fds=(lock.fileno(),)))
PY
}

if [ "$#" -eq 2 ] && [ "$1" = "--locked-action" ]; then
  dispatch_action "$2"
  exit $?
fi

if [ "$#" -gt 0 ]; then
  if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "用法：$0 [start|stop|restart|status|logs]"
    echo "无参数时显示菜单；默认后端 8001、前端来源 http://127.0.0.1:5183。"
    exit 0
  fi
  run_action "$1"
  exit $?
fi

while true; do
  echo
  echo "RunNote 后端 · $BASE_URL"
  echo "1 启动   2 关闭   3 重启   4 状态   5 日志   0 退出"
  read -r -p "请选择：" choice || exit 0
  case "$choice" in
    1) run_action start ;; 2) run_action stop ;; 3) run_action restart ;;
    4) run_action status ;; 5) run_action logs ;; 0) exit 0 ;;
    *) echo "请输入 0–5。" ;;
  esac
done
