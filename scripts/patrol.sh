#!/usr/bin/env bash
# 用本机 agent 巡检一座城市，跑完开 PR（没有写权限时自动走 fork）。
#   scripts/patrol.sh hangzhou              # 默认 claude -p
#   AGENT=codex scripts/patrol.sh chengdu   # 改用 codex exec
#   MODEL=gpt-5 AGENT=codex scripts/patrol.sh chengdu   # 写进报告的模型名
#   NO_PR=1 scripts/patrol.sh hangzhou      # 只改本地文件，不开 PR
set -euo pipefail

UPSTREAM="baichen99/rizi-city"
CITY="${1:?用法：scripts/patrol.sh <城市拼音>}"
AGENT="${AGENT:-claude}"
MODEL="${MODEL:-unknown}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FILE="data/cities/${CITY}.yaml"
[[ -f "$FILE" ]] || { echo "找不到 $FILE" >&2; exit 1; }

case "$AGENT" in
  claude) AGENT_NAME="Claude Code" ;;
  codex)  AGENT_NAME="Codex" ;;
  *) echo "不支持的 AGENT=$AGENT（可选 claude / codex）" >&2; exit 1 ;;
esac

PY="python3"; [[ -x .venv/bin/python ]] && PY=".venv/bin/python"
TODAY="$(date +%F)"
BRANCH="patrol/${CITY}-${TODAY}"
SUMMARY="$(mktemp)"
trap 'rm -f "$SUMMARY"' EXIT

if [[ -z "${NO_PR:-}" ]]; then
  git diff --quiet && git diff --cached --quiet || { echo "工作区有未提交的改动，请先处理" >&2; exit 1; }
  BASE_REMOTE="$(git remote -v | awk -v u="$UPSTREAM" '$2 ~ u && $3=="(fetch)" {print $1; exit}')"
  BASE_REMOTE="${BASE_REMOTE:-origin}"
  git fetch -q "$BASE_REMOTE" main
  git checkout -q -B "$BRANCH" "$BASE_REMOTE/main"
fi

PROMPT="$(cat agent/patrol.md)

---
本次巡检城市：${CITY}（本地文件 ${FILE}，你可以直接读写这个本地文件，不必从 raw.githubusercontent.com 读）。今天是 ${TODAY}。
你的 agent 名称：${AGENT_NAME}；模型：${MODEL}。
按第 4 节方式 A 直接修改本地 YAML，但**不要**执行 git、gh 命令，脚本会负责提交和开 PR。
完成后把第 5 节格式的完整报告作为你的最后一段输出。"

case "$AGENT" in
  claude) claude -p "$PROMPT" --permission-mode acceptEdits \
            --allowedTools "Read,Edit,Write,WebFetch,WebSearch,Bash(python3 scripts/*),Bash(.venv/bin/python scripts/*)" | tee "$SUMMARY" ;;
  codex)  codex exec --full-auto "$PROMPT" | tee "$SUMMARY" ;;
esac

$PY scripts/validate.py "$CITY"
$PY scripts/build.py

[[ -n "${NO_PR:-}" ]] && { echo "NO_PR 已设置，改动留在本地。"; exit 0; }
if git diff --quiet; then echo "没有改动，不开 PR。"; exit 0; fi

git add data/ site/data/ README.md
git commit -q -m "patrol(${CITY}): ${TODAY} 巡检（${AGENT_NAME}）"

# 有写权限就推上游，否则推到自己的 fork
ME="$(gh api user -q .login)"
PERM="$(gh api "repos/${UPSTREAM}" -q .permissions.push 2>/dev/null || echo false)"
if [[ "$PERM" == "true" ]]; then
  git push -q -u "$BASE_REMOTE" "$BRANCH"; HEAD_REF="$BRANCH"
else
  gh repo fork "$UPSTREAM" --remote --remote-name fork >/dev/null 2>&1 || true
  git push -q -u fork "$BRANCH"; HEAD_REF="${ME}:${BRANCH}"
fi

BODY="$(sed -n '/## 巡检小结/,$p' "$SUMMARY")"
gh pr create --repo "$UPSTREAM" --head "$HEAD_REF" --title "巡检：${CITY} ${TODAY}" \
  --body "${BODY:-（agent 未输出巡检小结，请查看 diff）}

---
Agent: ${AGENT_NAME}
Model: ${MODEL}
由 \`scripts/patrol.sh\` 生成。所有合并由人工完成。"
