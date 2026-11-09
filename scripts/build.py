#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["pyyaml>=6"]
# ///
"""由 data/cities/*.yaml 和 data/national.yaml 生成：
  - site/data/cities.json   网页数据（含日子指数的各项原始指标，算法见 docs/index-method.md）
  - dist/rizi-city-offline.html   内联数据的单文件离线版（不提交，Release 时作为附件）
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
NATIONAL = ROOT / "data" / "national.yaml"
SITE = ROOT / "site"
OFFLINE = ROOT / "dist" / "rizi-city-offline.html"
INDEX_VERSION = "v0.1"
ROOM_SQM = 30   # 单间折算面积（㎡），见 docs/index-method.md
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
        first_year = 0
        for it in counted:
            if it["period"] == "once":
                first_year += it["total"]
            elif it["period"] == "year":
                first_year += it["per"]
            elif it["period"] == "month":
                first_year += it["per"] * min(12, it["total"] // it["per"] if it["per"] else 12)
        by_degree[deg] = {
            "hukou_eligible": (h.get("eligible_by_degree") or {}).get(deg),
            "hukou_age_max": (h.get("age_max_by_degree") or {}).get(deg),
            "total": total,
            "rent_subsidy_per_year": rent_per_year,
            "first_year": first_year,
            "counted": counted,
            "excluded": excluded,
        }
    return by_degree


# ---------- 日子指数的原始指标（归一化和加权在网页里做） ----------

def _income_ok(lv: dict) -> bool:
    # needs_human_fields 写明了待核实的只是别的值（如消费支出）时，收入仍可用
    flagged = lv.get("needs_human") and (not lv.get("needs_human_fields")
                                         or "income_per_capita" in lv["needs_human_fields"])
    return (lv.get("income_per_capita") is not None and bool(lv.get("stats_source_url"))
            and bool(lv.get("verified_at")) and not flagged and not lv.get("access_blocked"))


def _flex_ok(fe: dict) -> bool:
    return (fe.get("monthly_total_min") is not None and bool(fe.get("source_url"))
            and bool(fe.get("verified_at")) and not fe.get("needs_human") and not fe.get("access_blocked"))


def _subsidy_unknown_amount(city: dict) -> list[str]:
    """已核实、但金额无法取单一值的现金补贴（如按区分档），这类补贴让「补贴力度」无法计算。"""
    out = []
    for s in city.get("subsidies") or []:
        if not s or s.get("type") not in ("living", "rent") or exclusion_reason(s):
            continue
        if all(v is None for v in (s.get("amount_by_degree") or {}).values()):
            out.append(s.get("name"))
    return out


def index_inputs(city: dict) -> dict:
    """每项返回 {value, ok, reason}；ok=False 的项不参与计算。"""
    st, lv = city["status"], city.get("living") or {}
    fe, h = city.get("flexible_employment") or {}, city.get("hukou") or {}
    inc = lv.get("income_per_capita")
    month_inc = inc / 12 if inc else None
    out = {}

    def put(key, value, reason):
        out[key] = {"value": None if reason else value, "ok": reason is None, "reason": reason}

    # 房租负担
    if st["rent"] != "verified":
        put("rent", None, "房租未核实")
    elif not _income_ok(lv):
        put("rent", None, "人均可支配收入未核实")
    else:
        put("rent", round(lv["rent_avg_per_sqm"] * ROOM_SQM / month_inc, 4), None)

    # 生活成本
    put("cost", (round(lv["consumption_per_capita"] / inc, 4) if st["cost"] == "verified" else None),
        None if st["cost"] == "verified" else "人均消费支出或可支配收入未核实")

    # 落户难度
    tier = (h.get("tier_by_degree") or {}).get("bachelor")
    if st["hukou"] != "verified":
        put("hukou", None, "落户政策未核实")
    elif tier not in ("direct", "job", "quota"):
        put("hukou", None, "本科落户难度未分档")
    else:
        put("hukou", tier, None)

    # 补贴力度（本科）
    b = city["by_degree"]["bachelor"]
    bad = [k for k in ("living_subsidy", "rent_subsidy") if st[k] not in ("verified", "none")]
    pending = [x["name"] for x in b["excluded"] if x.get("type") in ("living", "rent")]
    unknown = _subsidy_unknown_amount(city)
    if bad or pending:
        put("subsidy", None, "有补贴待核实：" + "、".join(pending or [DIMENSION_LABEL[k] for k in bad]))
    elif unknown:
        put("subsidy", None, "金额无法取单一值（如按区分档）：" + "、".join(unknown))
    else:
        put("subsidy", b["first_year"], None)

    # 通勤：暂停用（没有可用的统一口径来源）
    put("commute", None, "通勤指标暂停用")

    # 社保负担
    if not _flex_ok(fe):
        put("social", None, "灵活就业最少自缴额未核实")
    elif not _income_ok(lv):
        put("social", None, "人均可支配收入未核实")
    else:
        put("social", round(fe["monthly_total_min"] / month_inc, 4), None)
    return out


def freelance_floor(city: dict) -> dict:
    """自由职业每月生活底线 = 最少自缴社保 + 单间房租（30㎡ × 每平米月租）；⚠️ 项不计入。"""
    lv, fe = city.get("living") or {}, city.get("flexible_employment") or {}
    rent_ok = city["status"]["rent"] == "verified"
    rent = round(lv["rent_avg_per_sqm"] * ROOM_SQM) if rent_ok else None
    ss = fe.get("monthly_total_min") if _flex_ok(fe) else None
    return {"rent": rent, "social": ss,
            "total": round(ss + rent) if (rent is not None and ss is not None) else None}


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
        d["index"] = index_inputs(d)
        d["floor"] = freelance_floor(d)
        cities.append(d)

    latest = max((c["latest_verified"] for c in cities if c["latest_verified"]), default=None)
    payload = {
        "latest_verified": latest,
        "city_count": len(cities),
        "disclaimer": "仅供参考，申请前以官方页面为准。",
        "index_version": INDEX_VERSION,
        "room_sqm": ROOM_SQM,
        "national": load_yaml(NATIONAL) if NATIONAL.exists() else None,
        "cities": cities,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"✓ {OUT_JSON.relative_to(ROOT)}（{len(cities)} 座城市）")
    update_readme(cities, latest)
    build_offline(payload)


def build_offline(payload: dict):
    """把 style.css、app.js 和数据内联进一个 HTML，双击即可打开。"""
    html_p = SITE / "index.html"
    if not html_p.exists():
        return
    html = html_p.read_text(encoding="utf-8")
    css = (SITE / "style.css").read_text(encoding="utf-8")
    js = (SITE / "app.js").read_text(encoding="utf-8")
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>")
    html = html.replace('<script src="app.js"></script>',
                        f"<script>window.RIZI_DATA={data};window.RIZI_OFFLINE=true;</script>\n<script>\n{js}\n</script>")
    OFFLINE.parent.mkdir(parents=True, exist_ok=True)
    OFFLINE.write_text(html, encoding="utf-8")
    print(f"✓ {OFFLINE.relative_to(ROOT)}（离线单文件，{len(html.encode()) // 1024} KB）")


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
