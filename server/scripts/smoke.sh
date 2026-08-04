#!/usr/bin/env bash
# 门户后端端到端冒烟。改动后端后必跑。
#
# 用法：先启动服务，再执行 bash scripts/smoke.sh
# 本机若开启系统代理，curl 需要 --noproxy '*'，脚本已带。
#
# 注意：JSON 请求体一律先赋值给变量再传给 curl。
# 直接把 -d "{\"a\":1}" 写在 "$( ... )" 里会触发花括号展开，请求体会在逗号处被拆成多个参数。

set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8787}"
JAR="$(mktemp)"
PASS=0
FAIL=0

JSON='Content-Type: application/json'

c() { curl -s -L --noproxy '*' -b "$JAR" -c "$JAR" "$@"; }

post() { local path="$1" body="$2"; c -X POST "$BASE$path" -H "$JSON" -d "$body"; }

check() {
  local name="$1" expect="$2" actual="$3"
  if [[ "$actual" == *"$expect"* ]]; then
    printf '  ✓ %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  ✗ %s\n     期望包含: %s\n     实际: %s\n' "$name" "$expect" "${actual:0:220}"
    FAIL=$((FAIL + 1))
  fi
}

# 每次用不同用户名，避免重复运行时 409
U="smoke$(date +%s)"

echo "== 健康检查 =="
check "health 返回 ok" '"ok":true' "$(c "$BASE/api/health")"

echo "== 身份 =="
body="{\"username\":\"$U\",\"password\":\"onlyletters\",\"displayName\":\"冒烟\",\"identity\":\"crew\"}"
check "弱口令被拒" '口令需同时包含字母和数字' "$(post /api/auth/register "$body")"

body="{\"username\":\"$U\",\"password\":\"Smoke12345\",\"displayName\":\"冒烟\",\"identity\":\"boss\"}"
check "非法身份被拒" '身份需为' "$(post /api/auth/register "$body")"

body="{\"username\":\"ab\",\"password\":\"Smoke12345\",\"displayName\":\"冒烟\",\"identity\":\"crew\"}"
check "用户名过短被拒" '用户名为 3 至 32 位' "$(post /api/auth/register "$body")"

body="{\"username\":\"$U\",\"password\":\"Smoke12345\",\"displayName\":\"冒烟测试\",\"identity\":\"crew\",\"org\":\"测试剧组\"}"
check "注册成功" '"ok":true' "$(post /api/auth/register "$body")"

body="{\"username\":\"$U\",\"password\":\"Smoke12345\",\"displayName\":\"冒烟\",\"identity\":\"crew\"}"
check "用户名重复被拒" '已被占用' "$(post /api/auth/register "$body")"

check "me 返回已登录用户" "\"username\":\"$U\"" "$(c "$BASE/api/auth/me")"

echo "== 收藏 =="
check "收藏工具 1" '"favorited":true' "$(c -X PUT "$BASE/api/favorites/1")"
check "收藏工具 2" '"favorited":true' "$(c -X PUT "$BASE/api/favorites/2")"
check "取消收藏 1" '"favorited":false' "$(c -X PUT "$BASE/api/favorites/1")"
check "收藏列表含 2" '2' "$(c "$BASE/api/favorites")"
check "合并本机收藏" '"ok":true' "$(post /api/favorites/merge '{"toolIds":[7,8,9]}')"
check "非法 toolId 被拒" 'toolId 不合法' "$(c -X PUT "$BASE/api/favorites/abc")"

echo "== 埋点 =="
check "缺字段被拒" '埋点字段缺失' "$(post /api/events '{"action":"tool_click","toolId":1}')"
check "非法 action 被拒" 'action 需为' "$(post /api/events '{"action":"hack"}')"

body='{"action":"tool_click","toolId":1,"toolName":"火龙果写作","scene":"剧本创作","sourcePage":"/tools"}'
check "完整点击上报成功" '"ok":true' "$(post /api/events "$body")"

body='{"action":"search","keyword":"分镜","sourcePage":"/tools"}'
check "搜索上报成功" '"ok":true' "$(post /api/events "$body")"

check "尾斜杠可用" '"ok":true' "$(post /api/events/ "$body")"
check "完整率接口可用" '"threshold":95' "$(c "$BASE/api/events/completeness")"

echo "== 统计权限 =="
check "非管理员被拒" '需要管理员权限' "$(c "$BASE/api/stats/weekly")"

echo "== 登出 =="
check "登出成功" '"ok":true' "$(c -X POST "$BASE/api/auth/logout")"
check "登出后 me 为空" '"user":null' "$(c "$BASE/api/auth/me")"
check "登出后收藏需鉴权" '未登录' "$(c "$BASE/api/favorites")"

echo "== 管理员统计 =="
ADMIN="${ADMIN_USERNAME:-hdadmin}"
body="{\"username\":\"$ADMIN\",\"password\":\"Smoke12345\",\"displayName\":\"管理员\",\"identity\":\"individual\"}"
post /api/auth/register "$body" > /dev/null
body="{\"username\":\"$ADMIN\",\"password\":\"Smoke12345\"}"
post /api/auth/login "$body" > /dev/null
check "周报可出数" '"registeredUsers"' "$(c "$BASE/api/stats/weekly")"
check "周报含工具榜" '"topTools"' "$(c "$BASE/api/stats/weekly")"
check "CSV 可导出" '工具ID' "$(c "$BASE/api/stats/weekly.csv")"
c -X POST "$BASE/api/auth/logout" > /dev/null

rm -f "$JAR"
echo
echo "通过 $PASS 项，失败 $FAIL 项"
[[ $FAIL -eq 0 ]]
