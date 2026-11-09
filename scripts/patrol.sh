#!/usr/bin/env bash
# 用本机 agent 巡检一座城市，跑完开 PR。
#   scripts/patrol.sh hangzhou            # 默认 claude -p
#   AGENT=codex scripts/patrol.sh chengdu # 改用 codex exec
#   NO_PR=1 scripts/patrol.sh hangzhou    # 只改本地文件，不开 PR
set -euo pipefail

CITY="${1:?用法：scripts/patrol.sh <城市拼音>}"
AGENT="${AGENT:-claude}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FILE="data/cities/${CITY}.yaml"
[[ -f "$FILE" ]] || { echo "找不到 $FILE" >&2; exit 1; }

TODAY="$(date +%F)"
BRANCH="patrol/${CITY}-${TODAY}"
SUMMARY="$(mktemp)"
trap 'rm -f "$SUMMARY"' EXIT

if [[ -z "${NO_PR:-}" ]]; then
  git diff --quiet && git diff --cached --quiet || { echo "工作区有未提交的改动，请先处理" >&2; exit 1; }
  git fetch -q origin main && git checkout -q -B "$BRANCH" origin/main
fi

PROMPT="$(cat agent/patrol.md)

---
本次巡检城市：${CITY}（文件 ${FILE}），今天是 ${TODAY}。
完成后把「巡检小结」作为你的最后一段输出。"

case "$AGENT" in
  claude) claude -p "$PROMPT" --permission-mode acceptEdits \
            --allowedTools "Read,Edit,Write,WebFetch,WebSearch,Bash(python3 scripts/*)" | tee "$SUMMARY" ;;
  codex)  codex exec --full-auto "$PROMPT" | tee "$SUMMARY" ;;
  *) echo "不支持的 AGENT=$AGENT（可选 claude / codex）" >&2; exit 1 ;;
esac

python3 scripts/validate.py "$CITY"
python3 scripts/build.py

[[ -n "${NO_PR:-}" ]] && { echo "NO_PR 已设置，改动留在本地。"; exit 0; }

if git diff --quiet; then
  echo "没有改动，不开 PR。"; exit 0
fi

git add data/ site/data/ README.md
git commit -q -m "patrol(${CITY}): ${TODAY} 巡检"
git push -q -u origin "$BRANCH"
BODY="$(sed -n '/## 巡检小结/,$p' "$SUMMARY")"
gh pr create --title "巡检：${CITY} ${TODAY}" \
  --body "${BODY:-（agent 未输出巡检小结，请查看 diff）}

---
由 \`scripts/patrol.sh\`（AGENT=${AGENT}）生成。合并前请人工抽查至少一处 source_url。"
