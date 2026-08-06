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

echo "== 工作流 =="
check "工作流列表可读" '"slug":"concept-still"' "$(c "$BASE/api/workflows")"
check "工作流详情可读" '"outputKind":"image"' "$(c "$BASE/api/workflows/concept-still")"
check "不存在的工作流返回 404" '工作流不存在' "$(c "$BASE/api/workflows/not-a-workflow")"
check "配额可读" '"limitCredits"' "$(c "$BASE/api/workflows/quota")"

body='{"params":{"style":"cinematic","aspectRatio":"16:9","count":2}}'
check "缺必填参数被拒" '"sceneDescription"' "$(post /api/workflows/concept-still/runs "$body")"

body='{"params":{"sceneDescription":"黄昏的明清宫苑外景，长廊尽头逆光。","style":"cinematic","aspectRatio":"16:9","count":99}}'
check "越界参数被拒" '不能大于 4' "$(post /api/workflows/concept-still/runs "$body")"

body='{"params":{"sceneDescription":"黄昏的明清宫苑外景，长廊尽头逆光。","style":"cinematic","aspectRatio":"16:9","count":2,"evilFlag":"x"}}'
check "未定义参数被拒" '未定义的参数' "$(post /api/workflows/concept-still/runs "$body")"

body='{"params":{"sceneDescription":"黄昏的明清宫苑外景，长廊尽头逆光。","style":"cinematic","aspectRatio":"16:9","count":2,"referenceUrl":"javascript:alert(1)"}}'
check "非 http 参考图被拒" '只支持 http' "$(post /api/workflows/concept-still/runs "$body")"

body='{"params":{"sceneDescription":"黄昏的明清宫苑外景，长廊尽头逆光，地面积水倒映屋檐。","style":"cinematic","aspectRatio":"16:9","count":2}}'
RUN_JSON="$(post /api/workflows/concept-still/runs "$body")"
check "提交成功" '"workflowSlug":"concept-still"' "$RUN_JSON"
RUN_ID="$(printf '%s' "$RUN_JSON" | sed -n 's/.*"run":{"id":\([0-9]*\).*/\1/p')"

# 队列是异步的，给它几秒跑完；演示算力默认 1.5 秒。
for _ in 1 2 3 4 5 6 7 8 9 10; do
  RUN_DETAIL="$(c "$BASE/api/workflows/runs/$RUN_ID")"
  [[ "$RUN_DETAIL" == *'"status":"succeeded"'* ]] && break
  [[ "$RUN_DETAIL" == *'"status":"failed"'* ]] && break
  sleep 1
done
check "任务跑到成功态" '"status":"succeeded"' "$RUN_DETAIL"
check "任务带回产出" '"kind":"image"' "$RUN_DETAIL"
check "任务列表可读" "\"id\":$RUN_ID" "$(c "$BASE/api/workflows/runs")"
check "已完成任务不可取消" '无法取消' "$(c -X POST "$BASE/api/workflows/runs/$RUN_ID/cancel")"

body="{\"action\":\"workflow_view\",\"workflowSlug\":\"concept-still\",\"sourcePage\":\"/workflows\"}"
check "工作流埋点上报成功" '"ok":true' "$(post /api/events "$body")"

body="{\"action\":\"workflow_view\",\"sourcePage\":\"/workflows\"}"
check "缺 workflowSlug 的埋点被拒" 'workflowSlug' "$(post /api/events "$body")"

echo "== 画布 =="
check "工作流列表默认不含画布操作" '"surface":"library"' "$(c "$BASE/api/workflows")"
check "画布操作可显式索取" '"slug":"canvas-inpaint"' "$(c "$BASE/api/workflows?surface=canvas")"
check "非法 surface 被拒" 'surface 需为' "$(c "$BASE/api/workflows?surface=nope")"

body='{"name":"冒烟画布"}'
CANVAS_JSON="$(post /api/canvases "$body")"
check "新建画布" '"name":"冒烟画布"' "$CANVAS_JSON"
CANVAS_ID="$(printf '%s' "$CANVAS_JSON" | sed -n 's/.*"canvas":{"id":\([0-9]*\).*/\1/p')"

body='{"src":"javascript:alert(1)"}'
check "非法图片来源被拒" '只支持 http' "$(post "/api/canvases/$CANVAS_ID/items" "$body")"

body='{"src":"data:text/html,<b>x</b>"}'
check "非图片内联数据被拒" '只支持图片类型' "$(post "/api/canvases/$CANVAS_ID/items" "$body")"

body='{"src":"https://example.com/a.png","x":0,"y":0,"width":360,"height":203}'
ITEM_JSON="$(post "/api/canvases/$CANVAS_ID/items" "$body")"
check "加入图片成功" '"src":"https://example.com/a.png"' "$ITEM_JSON"
ITEM_ID="$(printf '%s' "$ITEM_JSON" | sed -n 's/.*"item":{"id":\([0-9]*\).*/\1/p')"

body='{"x":120,"y":60}'
check "移动图片" '"x":120' "$(c -X PATCH "$BASE/api/canvases/$CANVAS_ID/items/$ITEM_ID" -H "$JSON" -d "$body")"
check "画布详情含该图" "\"id\":$ITEM_ID" "$(c "$BASE/api/canvases/$CANVAS_ID")"
check "画布列表含计数" '"itemCount":1' "$(c "$BASE/api/canvases")"

body='{"params":{"sourceUrl":"https://example.com/a.png","prompt":"把天空换成黄昏","regionX":10,"regionY":10,"regionW":40,"regionH":30}}'
check "局部重绘可提交" '"workflowSlug":"canvas-inpaint"' "$(post /api/workflows/canvas-inpaint/runs "$body")"

body='{"params":{"sourceUrl":"https://example.com/a.png","prompt":"只改一点"}}'
check "缺选区被逐字段拒绝" 'regionW' "$(post /api/workflows/canvas-inpaint/runs "$body")"

check "删除图片" '"ok":true' "$(c -X DELETE "$BASE/api/canvases/$CANVAS_ID/items/$ITEM_ID")"
check "删除画布" '"ok":true' "$(c -X DELETE "$BASE/api/canvases/$CANVAS_ID")"
check "画布删除后不可读" '画布不存在' "$(c "$BASE/api/canvases/$CANVAS_ID")"

echo "== 统计权限 =="
check "非管理员被拒" '需要管理员权限' "$(c "$BASE/api/stats/weekly")"

echo "== 登出 =="
check "登出成功" '"ok":true' "$(c -X POST "$BASE/api/auth/logout")"
check "登出后 me 为空" '"user":null' "$(c "$BASE/api/auth/me")"
check "登出后收藏需鉴权" '未登录' "$(c "$BASE/api/favorites")"
check "登出后任务列表需鉴权" '未登录' "$(c "$BASE/api/workflows/runs")"
check "登出后画布需鉴权" '未登录' "$(c "$BASE/api/canvases")"

echo "== 管理员统计 =="
ADMIN="${ADMIN_USERNAME:-hdadmin}"
body="{\"username\":\"$ADMIN\",\"password\":\"Smoke12345\",\"displayName\":\"管理员\",\"identity\":\"individual\"}"
post /api/auth/register "$body" > /dev/null
body="{\"username\":\"$ADMIN\",\"password\":\"Smoke12345\"}"
post /api/auth/login "$body" > /dev/null
check "周报可出数" '"registeredUsers"' "$(c "$BASE/api/stats/weekly")"
check "周报含工具榜" '"topTools"' "$(c "$BASE/api/stats/weekly")"
check "CSV 可导出" '工具ID' "$(c "$BASE/api/stats/weekly.csv")"
check "周报含工作流口径" '"successRatePercent"' "$(c "$BASE/api/stats/weekly")"
check "工作流 CSV 可导出" '消耗额度' "$(c "$BASE/api/stats/weekly-workflows.csv")"
c -X POST "$BASE/api/auth/logout" > /dev/null

rm -f "$JAR"
echo
echo "通过 $PASS 项，失败 $FAIL 项"
[[ $FAIL -eq 0 ]]
