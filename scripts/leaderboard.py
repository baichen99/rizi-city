#!/usr/bin/env python3
"""生成 docs/leaderboard.md：按 agent 统计巡检城市数、被合并的有效更新、被驳回数和抽查准确率。

数据来自 GitHub（需要已登录的 gh CLI）：
  - 巡检 = 带 agent-patrol 标签的 Issue 和 PR，agent 由 agent:* 标签识别
  - 有效更新 = 已合并的巡检 PR
  - 被驳回 = 带 invalid 标签的巡检 Issue/PR
  - 准确率 = 维护者（OWNER/MEMBER/COLLABORATOR）评论里的「抽查：正确 X / 共 Y」累加
用法：python3 scripts/leaderboard.py [owner/repo]
"""
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

REPO = sys.argv[1] if len(sys.argv) > 1 else "baichen99/rizi-city"
OUT = Path(__file__).resolve().parent.parent / "docs" / "leaderboard.md"
NAMES = {"muse": "Muse", "dots": "dots", "grok-bot": "Grok Bot", "claude-code": "Claude Code",
         "codex": "Codex", "openclaw": "OpenClaw", "other": "其他"}
CHECK_RE = re.compile(r"抽查[:：]\s*正确\s*(\d+)\s*/\s*共\s*(\d+)")
TRUSTED = {"OWNER", "MEMBER", "COLLABORATOR"}


def gh(*args):
    return json.loads(subprocess.check_output(["gh", *args], text=True))


def items():
    fields = "number,title,labels,state,comments"
    iss = gh("issue", "list", "-R", REPO, "-l", "agent-patrol", "-s", "all", "-L", "500", "--json", fields)
    prs = gh("pr", "list", "-R", REPO, "-l", "agent-patrol", "-s", "all", "-L", "500",
             "--json", fields + ",mergedAt")
    return iss + prs


def main():
    stat = defaultdict(lambda: {"cities": set(), "patrols": 0, "merged": 0, "rejected": 0, "ok": 0, "checked": 0})
    for it in items():
        labels = [l["name"] for l in it["labels"]]
        agent = next((l.split(":", 1)[1] for l in labels if l.startswith("agent:")), "other")
        s = stat[agent]
        s["patrols"] += 1
        m = re.search(r"巡检[:：]\s*(\S+)", it["title"])
        if m:
            s["cities"].add(m.group(1))
        if it.get("mergedAt"):
            s["merged"] += 1
        if "invalid" in labels:
            s["rejected"] += 1
        for c in it.get("comments", []):
            if c.get("authorAssociation") in TRUSTED:
                for ok, total in CHECK_RE.findall(c.get("body", "")):
                    s["ok"] += int(ok)
                    s["checked"] += int(total)

    rows = []
    for a, s in stat.items():
        acc = f"{s['ok'] / s['checked']:.0%}（{s['ok']}/{s['checked']}）" if s["checked"] else "待抽查"
        rows.append((s["checked"] and s["ok"] / s["checked"] or -1, s["patrols"], a, s, acc))
    rows.sort(key=lambda r: (r[0], r[1]), reverse=True)

    lines = [
        "# 🏅 巡检榜", "",
        "各家 agent 帮忙巡检政策数据的记录。**准确率和次数一起看**：比的是“准”，不只是“勤快”。", "",
        "- 巡检次数：带 `agent-patrol` 标签的 Issue 和 PR",
        "- 有效更新：被人工合并的巡检 PR",
        "- 被驳回：核实后标为 `invalid` 的巡检",
        "- 准确率：维护者抽查（每份报告至少抽查 30% 的条目）中，与官网一致的比例", "",
        "| agent | 巡检次数 | 覆盖城市 | 有效更新 | 被驳回 | 抽查准确率 |",
        "|---|---|---|---|---|---|",
    ]
    for _, _, a, s, acc in rows:
        lines.append(f"| {NAMES.get(a, a)} | {s['patrols']} | {len(s['cities'])} | {s['merged']} | {s['rejected']} | {acc} |")
    if not rows:
        lines.append("| _还没有巡检记录，来做第一个吧_ | | | | | |")
    lines += ["", f"_更新于 {date.today().isoformat()}，由 `scripts/leaderboard.py` 生成。_", ""]
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"✓ {OUT}")


if __name__ == "__main__":
    main()
