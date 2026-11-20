#!/bin/bash
# Local backend lifecycle only; reuse local-auth.py without changing configuration or schema.
# Start checks the database revision read-only and refuses to start when it does not match the
# migrations; it never migrates (development database upgrades need backup first, see AGENTS.md).
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
# The origin the running backend was started with; status compares it with the frontend's port.
ORIGIN_FILE="$STATE_DIR/origin"
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

# Read-only: compares the database's Alembic revision with this checkout's single migration head.
# Exit 0 up to date, 3 migration needed or database ahead of the code, 1 database unreachable.
check_schema() {
  (cd "$PROJECT_DIR/backend" && "$PYTHON" - <<'PY'
import sys

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from app.core.config import Settings
from app.db.schema import MIGRATIONS, get_expected_revision

expected = get_expected_revision()
engine = create_engine(
    Settings().database_url,
    hide_parameters=True,
    connect_args={"connect_timeout": 3, "options": "-c default_transaction_read_only=on"},
)
try:
    with engine.connect() as connection:
        exists = connection.execute(text("SELECT to_regclass('alembic_version')")).scalar()
        current = (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
            if exists
            else []
        )
except Exception as error:
    print(
        f"无法读取数据库版本（{type(error).__name__}）：请确认 PostgreSQL 已启动、根目录 .env 的 DATABASE_URL 正确。",
        file=sys.stderr,
    )
    sys.exit(1)
finally:
    engine.dispose()

if current == [expected]:
    print(f"数据库版本：{expected}（与代码一致，无需迁移）")
    sys.exit(0)
config = Config()
config.set_main_option("script_location", str(MIGRATIONS))
script = ScriptDirectory.from_config(config)
known = {revision.revision for revision in script.walk_revisions()}
if not current:
    pending = [r.revision for r in script.iterate_revisions(expected, "base")]
    print(f"数据库尚未初始化：需要执行全部 {len(pending)} 个迁移。", file=sys.stderr)
elif len(current) == 1 and current[0] in known:
    pending = [r.revision for r in script.iterate_revisions(expected, current[0])]
    print(f"数据库需要迁移：当前 {current[0]}，代码需要 {expected}。", file=sys.stderr)
    print(f"待执行 {len(pending)} 个：" + "、".join(reversed(pending)), file=sys.stderr)
else:
    print(
        f"数据库版本 {', '.join(current)} 不在本代码的迁移里（数据库比代码新，或切到了旧分支）："
        "请更新代码，不要降级数据库。",
        file=sys.stderr,
    )
    sys.exit(3)
print("脚本不会自动迁移开发库：请先备份数据库，确认后在 backend/ 下运行 .venv/bin/alembic upgrade head。", file=sys.stderr)
sys.exit(3)
PY
  )
}

# Writes only a hint: this repository's vite dev servers that listen on another port than the
# origin the backend accepts writes from. Such a frontend gets "请求来源或CSRF令牌不合法" on login.
check_frontend_origin() {
  local origin="$1" expected pid command cwd port ports=""
  expected="${origin##*:}"
  expected="${expected%%/*}"
  for pid in $(lsof -nP -t -iTCP -sTCP:LISTEN 2>/dev/null | sort -u); do
    command="$(ps -p "$pid" -o command= 2>/dev/null)" || continue
    case "$command" in *vite*" dev"*) ;; *) continue ;; esac
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    if [ "$cwd" != "$PROJECT_DIR/frontend" ]; then continue; fi
    for port in $(lsof -a -nP -p "$pid" -iTCP -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n.*:\([0-9][0-9]*\)$/\1/p' | sort -u); do
      if [ "$port" = "$expected" ]; then return 0; fi
      ports="$ports $port"
    done
  done
  if [ -z "$ports" ]; then return 0; fi
  echo "注意：本仓库的前端开发服务在端口${ports} 上运行，但后端只接受来源 $origin 的写请求，从该前端登录会被拒绝。" >&2
  port="<前端端口>"
  case "$ports" in *" "*" "*) ;; *) port="${ports# }" ;; esac
  echo "      二选一：SITE_ORIGIN=http://127.0.0.1:${port} ./backend.command restart，或用 pnpm dev --port ${expected} 启动前端。" >&2
}

status_backend() {
  local pid result
  pid="$(backend_pid)"; result=$?
  if [ "$result" -eq 2 ]; then return 1; fi
  if [ "$result" -ne 0 ]; then echo "后端已关闭（端口 ${PORT}）。"; return 0; fi
  if ready; then
    echo "后端运行中：$BASE_URL · PID $pid · 数据库已就绪。"
    if [ -f "$ORIGIN_FILE" ]; then check_frontend_origin "$(cat "$ORIGIN_FILE")"; fi
  else
    echo "后端进程存在（PID ${pid}），健康检查未通过，请查看日志：$LOG_FILE" >&2
    check_schema >/dev/null
    return 1
  fi
}

start_backend() {
  local pid result
  pid="$(backend_pid)"; result=$?
  if [ "$result" -eq 2 ]; then return 1; fi
  if [ "$result" -eq 0 ]; then status_backend; return $?; fi
  if [ ! -x "$PYTHON" ]; then echo "未找到后端虚拟环境：$PYTHON" >&2; return 1; fi
  if ! check_schema; then
    echo "后端未启动。" >&2
    return 1
  fi
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
  echo "$ORIGIN" >"$ORIGIN_FILE"
  for _ in {1..40}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "后端启动失败，请查看日志：$LOG_FILE" >&2
      return 1
    fi
    if is_project_backend "$pid" && ready; then
      echo "后端已启动：$BASE_URL · PID $pid"
      echo "前端来源：$ORIGIN"
      echo "日志：$LOG_FILE"
      check_frontend_origin "$ORIGIN"
      return 0
    fi
    sleep 0.25
  done
  echo "后端尚未就绪，请查看日志：$LOG_FILE" >&2
  return 1
}

stop_backend() {
  local pid result
  pid="$(backend_pid)"; result=$?
  if [ "$result" -eq 2 ]; then return 1; fi
  if [ "$result" -ne 0 ]; then rm -f "$PID_FILE" "$ORIGIN_FILE"; echo "后端已经关闭。"; return 0; fi
  if ! is_project_backend "$pid"; then echo "进程已变化，请重试。" >&2; return 1; fi
  kill -TERM "$pid" || return 1
  for _ in {1..40}; do
    if ! is_project_backend "$pid"; then
      rm -f "$PID_FILE" "$ORIGIN_FILE"
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
    check) if [ -x "$PYTHON" ]; then check_schema; result=$?; else echo "未找到后端虚拟环境：$PYTHON" >&2; result=1; fi ;;
    logs) if [ -f "$LOG_FILE" ]; then tail -n 60 "$LOG_FILE"; else echo "暂无日志。"; fi; result=0 ;;
    *) echo "用法：$0 [start|stop|restart|status|check|logs]"; result=1 ;;
  esac
  return "$result"
}

run_action() {
  local action="$1"
  case "$action" in
    status|check|logs) dispatch_action "$action"; return $? ;;
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
    echo "用法：$0 [start|stop|restart|status|check|logs]"
    echo "check 只读核对数据库版本与迁移；start 会先做同样的检查，数据库需要迁移时不启动。"
    echo "无参数时显示菜单；默认后端 8001、前端来源 http://127.0.0.1:5183。"
    exit 0
  fi
  run_action "$1"
  exit $?
fi

while true; do
  echo
  echo "RunNote 后端 · $BASE_URL"
  echo "1 启动   2 关闭   3 重启   4 状态   5 日志   6 检查数据库   0 退出"
  read -r -p "请选择：" choice || exit 0
  case "$choice" in
    1) run_action start ;; 2) run_action stop ;; 3) run_action restart ;;
    4) run_action status ;; 5) run_action logs ;; 6) run_action check ;; 0) exit 0 ;;
    *) echo "请输入 0–6。" ;;
  esac
done
