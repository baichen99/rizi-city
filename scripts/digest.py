#!/usr/bin/env python3
"""每周摘要：用 gh 拉取过去 N 天的 Issue 和 PR，输出 Markdown。

只输出到 stdout 或 --out 指定的本地文件；推送到哪里由维护者的私有配置决定，本脚本不发送任何东西。
用法：python3 scripts/digest.py [--days 7] [--repo owner/repo] [--out digest.md]
"""
import argparse
import json
import subprocess
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


def gh(*args):
    return json.loads(subprocess.check_output(["gh", *args], text=True))


def fmt(it):
    return f"- #{it['number']} {it['title']}（{', '.join(l['name'] for l in it['labels']) or '无标签'}）"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--repo", default="baichen99/rizi-city")
    ap.add_argument("--out")
    a = ap.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=a.days)
    f = "number,title,labels,state,updatedAt,createdAt"
    iss = gh("issue", "list", "-R", a.repo, "-s", "all", "-L", "300", "--json", f)
    prs = gh("pr", "list", "-R", a.repo, "-s", "all", "-L", "300", "--json", f + ",mergedAt,isDraft")
    recent = lambda x: datetime.fromisoformat(x["updatedAt"].replace("Z", "+00:00")) >= since
    iss, prs = [i for i in iss if recent(i)], [p for p in prs if recent(p)]
    has = lambda x, l: l in [y["name"] for y in x["labels"]]

    out = [f"# rizi-city 周报 {date.today()}（近 {a.days} 天）", ""]
    out += ["## 待合并的 PR"] + ([fmt(p) for p in prs if p["state"] == "OPEN"] or ["- 无"]) + [""]
    out += ["## needs-human"] + ([fmt(x) for x in iss + prs if x["state"] == "OPEN" and has(x, "needs-human")] or ["- 无"]) + [""]
    out += ["## 新认领的城市"] + ([fmt(i) for i in iss if has(i, "claim-city")] or ["- 无"]) + [""]
    out += ["## 巡检动态"] + ([fmt(x) for x in iss + prs if has(x, "agent-patrol")] or ["- 无"]) + [""]
    out += ["## 已合并"] + ([fmt(p) for p in prs if p.get("mergedAt")] or ["- 无"]) + [""]
    lb = Path(__file__).resolve().parent.parent / "docs" / "leaderboard.md"
    if lb.exists():
        out += ["## 巡检榜（当前）", "", *[l for l in lb.read_text(encoding="utf-8").splitlines() if l.startswith("|")], ""]
    text = "\n".join(out)
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
        print(f"✓ {a.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
