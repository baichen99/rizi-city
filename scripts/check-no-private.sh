#!/usr/bin/env bash
# 防泄露检查：私有文件、私有标记、疑似 token 一律拒绝提交。
#   bash scripts/check-no-private.sh          # 检查暂存区（pre-commit 用）
#   bash scripts/check-no-private.sh --all    # 检查所有已跟踪文件（CI 用）
set -uo pipefail

MARK="PRIVATE-DO-""NOT-COMMIT"                       # 拆开写，避免本脚本自己命中
TOKEN_RE='(gh''p_[A-Za-z0-9]+|github_''pat_[A-Za-z0-9_]+|(^|[^A-Za-z0-9])s''k-[A-Za-z0-9_-]{8,}|xox''b-[A-Za-z0-9-]+)'

if [[ "${1:-}" == "--all" ]]; then
  LIST="$(git ls-files)"
  read_file() { cat -- "$1" 2>/dev/null; }
else
  LIST="$(git diff --cached --name-only --diff-filter=ACMR)"
  read_file() { git show ":$1" 2>/dev/null; }
fi

fail=0; n=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  [[ -f "$f" || "${1:-}" != "--all" ]] || continue
  base="$(basename "$f")"
  if [[ "$f" == *rizi-city-private* || "$f" == *.private* || "$f" == .private/* || "$f" == */.private/* ]] \
     || [[ "$base" == .env || ( "$base" == .env.* && "$base" != .env.example ) ]]; then
    echo "✗ 私有路径不能提交：$f"; fail=1; continue
  fi
  content="$(read_file "$f" | LC_ALL=C tr -d '\000')"
  if grep -qF -- "$MARK" <<<"$content"; then
    echo "✗ 含私有标记：$f"; fail=1
  fi
  if hit="$(LC_ALL=C grep -nE -- "$TOKEN_RE" <<<"$content" | head -3)" && [[ -n "$hit" ]]; then
    echo "✗ 疑似 token：$f"; sed 's/^/    /' <<<"$hit" | cut -c1-80; fail=1
  fi
  n=$((n+1))
done <<<"$LIST"

if [[ $fail -ne 0 ]]; then
  echo "防泄露检查未通过，提交已拒绝。确属误报请联系维护者调整规则，不要用 --no-verify 绕过。"
  exit 1
fi
echo "✓ 防泄露检查通过（$n 个文件）"
