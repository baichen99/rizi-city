#!/usr/bin/env bash
# 启用仓库自带的 git hooks（pre-commit 防泄露检查）
git config core.hooksPath .githooks && chmod +x .githooks/* && echo "✓ 已启用 .githooks/pre-commit"
