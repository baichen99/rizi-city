#!/usr/bin/env bash
# 批量创建 / 更新仓库标签。用法：scripts/setup-labels.sh [owner/repo]
set -euo pipefail
REPO="${1:-baichen99/rizi-city}"
mk() { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null && echo "✓ $1"; }
# 类型
mk data-error   d73a4a "数据和官网不一致"
mk new-city     0e8a16 "申请新增城市"
mk claim-city   1d76db "认领城市巡检"
mk agent-patrol 5319e7 "agent 巡检报告或巡检 PR"
mk question     d876e3 "提问"
mk discussion   c5def5 "讨论（如日子指数权重）"
# 状态
mk needs-source fbca04 "缺少官方来源或来源不在白名单"
mk verifying    f9d0c4 "维护者正在核实"
mk needs-human  b60205 "需要人工裁决"
mk fix-ready    0e8a16 "已核实，修复 PR 已就绪，待人工合并"
mk duplicate    cfd3d7 "重复"
mk invalid      e4e669 "核实不属实或不符合规则"
# agent
for a in muse dots grok-bot claude-code codex openclaw other; do mk "agent:$a" bfdadc "巡检 agent：$a"; done
