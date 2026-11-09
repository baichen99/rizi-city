#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["pyyaml>=6"]
# ///
"""由 data/cities/*.yaml 生成：
  - site/data/cities.json   网页数据
  - README.md 中 <!-- CITY_TABLE:START --> 与 <!-- CITY_TABLE:END --> 之间的城市速览表

合计金额只累加「有官方来源、已核验、无需人工、未过期」的补贴；其余列入 excluded 并说明原因。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    DEGREES, DIMENSION_LABEL, DIMENSIONS, ROOT, STATUS_ICON,
    city_files, dimension_status, expired, is_gov_url, load_yaml, today,
)

OUT_JSON = ROOT / "site" / "data" / "cities.json"
README = ROOT / "README.md"
START, END = "<!-- CITY_TABLE:START -->", "<!-- CITY_TABLE:END -->"


def exclusion_reason(s: dict) -> str | None:
    if s.get("access_blocked"):
        return "官网无法访问，待人工核实"
    if not s.get("source_url"):
        return "仅有线索，未找到官方原文"
    if not is_gov_url(s.get("source_url")):
        return "来源不是政府官网"
    if expired(s):
        return f"政策已于 {s.get('valid_until')} 到期，接替文件待核实"
    if s.get("needs_human"):
        return s.get("needs_human_reason") or "待人工核实"
    if not s.get("verified_at"):
        return "未核验"
    return None


def subsidy_value(s: dict, degree: str):
    """返回 (每期金额, 上限总额)；原文没给就返回 None。"""
    per = (s.get("amount_by_degree") or {}).get(degree)
    if per is None:
        return None, None
    n = 1 if s.get("period") == "once" else s.get("periods_max")
    return per, (per * n if n else None)


def summarize(city: dict) -> dict:
    by_degree = {}
    for deg in DEGREES:
        counted, excluded = [], []
        total = 0
        rent_per_year = None
        for i, s in enumerate(city.get("subsidies") or []):
            if not s or not s.get("name"):
                continue
            per, cap = subsidy_value(s, deg)
            reason = exclusion_reason(s)
            item = {"index": i, "name": s["name"], "type": s.get("type"), "per": per,
                    "period": s.get("period"), "total": cap}
            if per is None and reason is None:
                continue  # 该学历不适用
            if reason is None and cap is not None:
                counted.append(item)
                total += cap
                if s.get("type") == "rent" and s.get("period") == "year":
                    rent_per_year = (rent_per_year or 0) + per
            else:
                item["reason"] = reason or "原文未写明发放期数，无法合计"
                excluded.append(item)
        h = city.get("hukou") or {}
        by_degree[deg] = {
            "hukou_eligible": (h.get("eligible_by_degree") or {}).get(deg),
            "hukou_age_max": (h.get("age_max_by_degree") or {}).get(deg),
            "total": total,
            "rent_subsidy_per_year": rent_per_year,
            "counted": counted,
            "excluded": excluded,
        }
    return by_degree


def all_verified_dates(city: dict) -> list[str]:
    secs = [city.get("hukou"), city.get("social_security"), city.get("living"),
            *(city.get("subsidies") or [])]
    return sorted(str(s["verified_at"]) for s in secs if s and s.get("verified_at"))


def count_needs_human(city: dict) -> int:
    secs = [city.get("hukou"), city.get("social_security"), city.get("living"),
            *(city.get("subsidies") or [])]
    return sum(1 for s in secs if s and s.get("needs_human"))


def build():
    cities = []
    for p in city_files():
        d = load_yaml(p)
        d["id"] = p.stem
        d["status"] = dimension_status(d)
        d["by_degree"] = summarize(d)
        dates = all_verified_dates(d)
        d["latest_verified"] = dates[-1] if dates else None
        d["needs_human_count"] = count_needs_human(d)
        cities.append(d)

    latest = max((c["latest_verified"] for c in cities if c["latest_verified"]), default=None)
    payload = {
        "latest_verified": latest,
        "city_count": len(cities),
        "disclaimer": "仅供参考，申请前以官方页面为准。",
        "cities": cities,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"✓ {OUT_JSON.relative_to(ROOT)}（{len(cities)} 座城市）")
    update_readme(cities, latest)


def fmt_money(n):
    if n is None:
        return "—"
    if n >= 10000:
        return f"{n / 10000:.2f}".rstrip("0").rstrip(".") + " 万"
    return f"{n:,}"


def table(cities) -> str:
    if not cities:
        return "_数据采集中，首批城市即将上线。_"
    head = "| 城市 | 本科能领 | 硕士能领 | 博士能领 | " + " | ".join(DIMENSION_LABEL[k] for k in DIMENSIONS) + " |"
    sep = "|" + "---|" * (4 + len(DIMENSIONS))
    rows = [head, sep]

    def cell(c, deg):
        b = c["by_degree"][deg]
        s = fmt_money(b["total"]) if b["counted"] else "—"
        return s + (" ⚠️" if b["excluded"] else "")

    for c in sorted(cities, key=lambda c: -c["by_degree"]["master"]["total"]):
        icons = " | ".join(STATUS_ICON[c["status"][k]] for k in DIMENSIONS)
        rows.append(f"| [{c['city']}](data/cities/{c['id']}.yaml) | {cell(c, 'bachelor')} | "
                    f"{cell(c, 'master')} | {cell(c, 'phd')} | {icons} |")
    rows.append("")
    rows.append("「能领」只合计有官方原文、已核验、未过期的现金补贴（按原文上限）；⚠️ 表示还有未计入的待核实项。"
                "✅ 已核实 · ✅无 已核实没有市级现金补贴 · ⚠️ 仅有线索/待核实 · ❌ 未找到 · 🔒 无法访问")
    return "\n".join(rows)


def update_readme(cities, latest):
    if not README.exists():
        return
    text = README.read_text(encoding="utf-8")
    if START not in text or END not in text:
        print("! README.md 中没有 CITY_TABLE 标记，跳过")
        return
    before, rest = text.split(START, 1)
    _, after = rest.split(END, 1)
    new = f"{before}{START}\n{table(cities)}\n{END}{after}"
    if new != text:
        README.write_text(new, encoding="utf-8")
        print("✓ README.md 速览表已更新")
    else:
        print("· README.md 无变化")


if __name__ == "__main__":
    build()
