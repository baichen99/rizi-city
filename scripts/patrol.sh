#!/usr/bin/env bash
# 用本机 agent 巡检一座城市，跑完开 PR（没有写权限时自动走 fork）。
#   scripts/patrol.sh hangzhou              # 默认 claude -p
#   AGENT=codex scripts/patrol.sh chengdu   # 改用 codex exec
#   MODEL=gpt-5 AGENT=codex scripts/patrol.sh chengdu   # 写进报告的模型名
#   NO_PR=1 scripts/patrol.sh hangzhou      # 只改本地文件，不开 PR
#   SCOPE=civil_service scripts/patrol.sh guangzhou  # 只查考公考编
set -euo pipefail

UPSTREAM="baichen99/rizi-city"
CITY="${1:?用法：scripts/patrol.sh <城市拼音>}"
AGENT="${AGENT:-claude}"
MODEL="${MODEL:-unknown}"
SCOPE="${SCOPE:-all}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[[ "$CITY" =~ ^[a-z]+$ && "$CITY" != "_template" ]] || { echo "城市必须是小写拼音" >&2; exit 1; }
case "$SCOPE" in
  all|hukou|subsidies|social_security|living|flexible_employment|civil_service|commute|pitfalls) ;;
  *) echo "不支持的 SCOPE=$SCOPE；见 agent/patrol.md" >&2; exit 1 ;;
esac
FILE="data/cities/${CITY}.yaml"
[[ -f "$FILE" ]] || { echo "找不到 $FILE" >&2; exit 1; }

case "$AGENT" in
  claude) AGENT_NAME="Claude Code" ;;
  codex)  AGENT_NAME="Codex" ;;
  *) echo "不支持的 AGENT=$AGENT（可选 claude / codex）" >&2; exit 1 ;;
esac

PY="python3"; [[ -x .venv/bin/python ]] && PY=".venv/bin/python"
TODAY="$(date +%F)"
RUN_ID="$($PY -c 'import uuid; print(uuid.uuid4().hex[:12])')"
BRANCH="patrol/${CITY}-${SCOPE}-$(date -u +%Y%m%dT%H%M%SZ)-${RUN_ID}"
LOCK="$(git rev-parse --git-path rizi-patrol.lock)"
mkdir "$LOCK" 2>/dev/null || { echo "工作区已有巡检锁：$LOCK；先确认没有巡检进程，不要并行复用同一工作区。" >&2; exit 1; }
SUMMARY=""
cleanup() { [[ -z "$SUMMARY" ]] || rm -f "$SUMMARY"; rmdir "$LOCK"; }
trap cleanup EXIT
SUMMARY="$(mktemp)"

[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || { echo "工作区有未提交或未跟踪的文件，请先处理；不会丢弃它们。" >&2; exit 1; }

if [[ -z "${NO_PR:-}" ]]; then
  BASE_REMOTE="$(git remote -v | awk -v u="$UPSTREAM" '$2 ~ u && $3=="(fetch)" {print $1; exit}')"
  BASE_REMOTE="${BASE_REMOTE:-origin}"
  git fetch -q "$BASE_REMOTE" main
  git checkout -q -b "$BRANCH" "$BASE_REMOTE/main"
fi
BASE_SHA="$(git rev-parse HEAD)"

check_paths() {
  local phase="${1:-built}"
  # 检查先于运行构建脚本，避免误执行 agent 改动的无关脚本。
  [[ "$(git rev-parse HEAD)" == "$BASE_SHA" ]] || { echo "agent 改变了 HEAD，停止并保留工作区。" >&2; exit 1; }
  git diff --cached --quiet || { echo "agent 改变了暂存区，停止并保留工作区。" >&2; exit 1; }
  while IFS= read -r -d '' changed; do
    case "$changed" in
      "$FILE") ;;
      site/data/cities.json|README.md)
        [[ "$phase" == "built" ]] || { echo "agent 不应修改构建产物：$changed；停止并保留工作区。" >&2; exit 1; } ;;
      *) echo "发现无关修改，停止提交并保留工作区：$changed" >&2; exit 1 ;;
    esac
  done < <(git diff HEAD --name-only -z)
  [[ -z "$(git ls-files --others --exclude-standard)" ]] || { echo "发现新增未跟踪文件，停止提交并保留工作区。" >&2; exit 1; }
}

PROMPT="$(cat agent/patrol.md)

---
本次巡检城市：${CITY}（本地文件 ${FILE}，你可以直接读写这个本地文件，不必从 raw.githubusercontent.com 读）。今天是 ${TODAY}。
本次范围：${SCOPE}。all 表示完整巡检；其他值只修改该顶层领域及 changelog，subsidies 同时包含 subsidy_scan。领域巡检不得修改 last_patrol、maintainers 或其他领域。
你的 agent 名称：${AGENT_NAME}；模型：${MODEL}。
按第 4 节方式 A 直接修改本地 YAML，但**不要**执行 git、gh 命令，脚本会负责提交和开 PR。
只修改本城 YAML。不要修改 README、生成 JSON 或脚本，也不要运行校验、构建、安装命令；外层脚本会在你完成后处理校验和构建。
完成后把第 5 节格式的完整报告作为你的最后一段输出。"

case "$AGENT" in
  claude) claude -p "$PROMPT" --permission-mode acceptEdits \
            --allowedTools "Read,Edit,Write,WebFetch,WebSearch,Bash(python3 scripts/*),Bash(.venv/bin/python scripts/*)" | tee "$SUMMARY" ;;
  codex)  codex exec --full-auto "$PROMPT" | tee "$SUMMARY" ;;
esac

check_paths yaml
# 对照本次起点检查领域范围；不把未完成的局部核验记成完整巡检。
$PY - "$FILE" "$SCOPE" <<'PY'
import pathlib, subprocess, sys, yaml
path, scope = sys.argv[1:]
before = yaml.safe_load(subprocess.check_output(['git', 'show', f'HEAD:{path}']))
after = yaml.safe_load(pathlib.Path(path).read_text())
if not isinstance(after, dict):
    sys.exit('城市 YAML 必须是映射')
changed = {key for key in before.keys() | after.keys() if before.get(key) != after.get(key)}
domains = {'hukou', 'subsidies', 'subsidy_scan', 'social_security', 'living',
           'flexible_employment', 'civil_service', 'commute', 'pitfalls'}
allowed = domains | {'last_patrol', 'changelog'} if scope == 'all' else {scope, 'changelog'}
if scope == 'subsidies':
    allowed.add('subsidy_scan')
if changed - allowed:
    sys.exit('修改超出本次巡检范围：' + ', '.join(sorted(changed - allowed)))
PY

$PY scripts/validate.py "$CITY"
$PY scripts/build.py

# 构建后再核对一次，只提交本城和指定构建产物。
check_paths

[[ -n "${NO_PR:-}" ]] && { echo "NO_PR 已设置，改动留在本地。"; exit 0; }
if git diff HEAD --quiet; then echo "没有改动，不开 PR。"; exit 0; fi

git add -- "$FILE" site/data/cities.json README.md
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
gh pr create --draft --repo "$UPSTREAM" --head "$HEAD_REF" --title "巡检：${CITY} ${TODAY}" \
  --body "${BODY:-（agent 未输出巡检小结，请查看 diff）}

---
Agent: ${AGENT_NAME}
Model: ${MODEL}
由 \`scripts/patrol.sh\` 生成。所有合并须仓库维护者批准。"
