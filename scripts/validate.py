#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["pyyaml>=6"]
# ///
"""校验 data/cities/*.yaml。

用法：
  python3 scripts/validate.py            # 校验全部城市
  python3 scripts/validate.py hangzhou   # 只校验一座
  python3 scripts/validate.py --strict   # 警告也视为失败

错误（error）会让退出码为 1；警告（warning）默认不影响退出码。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    CITIES_DIR, DATE_RE, DEGREES, HUKOU_FACTS, MONTH_RE, SUBSIDY_FACTS,
    city_files, expired, is_empty, is_gov_url, load_yaml, today,
)

TOP_KEYS = ("city", "province", "maintainers", "last_patrol", "hukou", "subsidies",
            "social_security", "living", "flexible_employment", "civil_service", "commute",
            "pitfalls", "changelog")
SUBSIDY_TYPES = {"living", "rent", "housing_purchase", "other"}
PERIODS = {"once", "month", "year"}
SOURCE_TYPES = {"gov", "gov_account", "media"}
NAME_RE = re.compile(r"^[a-z]+$")


class Report:
    def __init__(self, name):
        self.name, self.errors, self.warnings = name, [], []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"{where}: {msg}")


def check_date(r, where, value, allow_month=False):
    if value is None:
        return
    s = str(value)
    if DATE_RE.match(s) or (allow_month and MONTH_RE.match(s)):
        return
    r.err(where, f"日期格式应为 YYYY-MM-DD{'（或 YYYY-MM）' if allow_month else ''}，实际为 {s!r}")


def check_common(r, where, sec, facts_present, require_gov):
    check_date(r, f"{where}.source_date", sec.get("source_date"), allow_month=True)
    check_date(r, f"{where}.valid_until", sec.get("valid_until"))
    check_date(r, f"{where}.verified_at", sec.get("verified_at"))

    if facts_present:
        if not sec.get("source_url"):
            r.err(where, "有内容但没有 source_url")
        if not sec.get("verified_at"):
            r.err(where, "有内容但没有 verified_at")
        if require_gov and sec.get("source_url") and not is_gov_url(sec["source_url"]):
            r.err(where, f"落户/补贴的 source_url 必须是政府官网（*.gov.cn），媒体报道请写进 lead/lead_url：{sec['source_url']}")
    if sec.get("lead") and not sec.get("lead_url"):
        r.err(where, "写了 lead 但没有 lead_url")
    if sec.get("needs_human") and not sec.get("needs_human_reason"):
        r.warn(where, "needs_human 为 true，但没写 needs_human_reason（卡在哪里）")
    if sec.get("access_blocked") and not sec.get("needs_human"):
        r.err(where, "access_blocked 为 true 时 needs_human 也必须为 true")
    if expired(sec) and not sec.get("needs_human"):
        r.warn(where, f"valid_until={sec.get('valid_until')} 已过期，但 needs_human 为 false；请查接替文件")
    v = sec.get("verified_at")
    if v and DATE_RE.match(str(v)) and str(v) > today().isoformat():
        r.err(where, f"verified_at={v} 晚于今天")


def check_degree_map(r, where, m, kind):
    if m is None:
        return
    if not isinstance(m, dict):
        r.err(where, "应为 {associate, bachelor, master, phd} 映射")
        return
    for k, v in m.items():
        if k not in DEGREES:
            r.err(where, f"未知学历键 {k!r}（应为 {', '.join(DEGREES)}）")
        if v is None:
            continue
        if kind == "bool" and not isinstance(v, bool):
            r.err(f"{where}.{k}", f"应为 true/false/null，实际为 {v!r}")
        if kind == "tier" and v not in ("direct", "job", "quota"):
            r.err(f"{where}.{k}", f"应为 direct/job/quota/null，实际为 {v!r}")
        if kind == "int" and (isinstance(v, bool) or not isinstance(v, int) or v < 0):
            r.err(f"{where}.{k}", f"应为非负整数（元或周岁），实际为 {v!r}")


def check_hukou(r, h):
    if not isinstance(h, dict):
        r.err("hukou", "缺失或不是映射")
        return
    facts = any(not is_empty(h.get(k)) for k in HUKOU_FACTS)
    check_common(r, "hukou", h, facts, require_gov=True)
    check_degree_map(r, "hukou.eligible_by_degree", h.get("eligible_by_degree"), "bool")
    check_degree_map(r, "hukou.tier_by_degree", h.get("tier_by_degree"), "tier")
    check_degree_map(r, "hukou.age_max_by_degree", h.get("age_max_by_degree"), "int")
    if facts and not h.get("policy_name"):
        r.warn("hukou", "有内容但没写 policy_name（文件名和文号）")


def check_subsidies(r, subs):
    if subs is None:
        r.err("subsidies", "缺失（没有补贴请写 []）")
        return
    if not isinstance(subs, list):
        r.err("subsidies", "应为列表")
        return
    for i, s in enumerate(subs):
        w = f"subsidies[{i}]"
        if not isinstance(s, dict):
            r.err(w, "应为映射")
            continue
        facts = any(not is_empty(s.get(k)) for k in SUBSIDY_FACTS)
        if not s.get("name") and (facts or s.get("lead")):
            r.err(w, "缺少 name")
        if not s.get("name") and not facts and not s.get("lead"):
            r.warn(w, "空条目（没有补贴请写 subsidies: []）")
            continue
        if s.get("type") not in SUBSIDY_TYPES:
            r.err(w, f"type 应为 {sorted(SUBSIDY_TYPES)} 之一，实际为 {s.get('type')!r}")
        if s.get("period") is not None and s.get("period") not in PERIODS:
            r.err(w, f"period 应为 {sorted(PERIODS)} 之一，实际为 {s.get('period')!r}")
        pm = s.get("periods_max")
        if pm is not None and (isinstance(pm, bool) or not isinstance(pm, int) or pm < 1):
            r.err(w, f"periods_max 应为正整数，实际为 {pm!r}")
        if s.get("period") == "once" and pm not in (None, 1):
            r.err(w, "period=once 时 periods_max 只能为 1")
        check_degree_map(r, f"{w}.amount_by_degree", s.get("amount_by_degree"), "int")
        if not is_empty(s.get("amount_by_degree")) and not s.get("amount"):
            r.err(w, "填了 amount_by_degree 但没写原文口径 amount")
        check_common(r, w, s, facts, require_gov=True)


def check_social_security(r, ss):
    if not isinstance(ss, dict):
        r.err("social_security", "缺失或不是映射")
        return
    w = "social_security"
    for k in ("base_min", "base_max"):
        v = ss.get(k)
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float))):
            r.err(f"{w}.{k}", f"应为数字，实际为 {v!r}")
    has = ss.get("base_min") is not None or ss.get("base_max") is not None
    check_date(r, f"{w}.verified_at", ss.get("verified_at"))
    if ss.get("source_type") is not None and ss.get("source_type") not in SOURCE_TYPES:
        r.err(w, f"source_type 应为 {sorted(SOURCE_TYPES)} 之一")
    if has:
        for k in ("source_url", "verified_at", "year", "source_type"):
            if not ss.get(k):
                r.err(w, f"有基数但没有 {k}")
    if ss.get("source_type") == "media" and not ss.get("needs_human"):
        r.err(w, "source_type 为 media 时 needs_human 必须为 true")
    if ss.get("source_type") == "gov" and ss.get("source_url") and not is_gov_url(ss["source_url"]):
        r.err(w, f"source_type 为 gov 但 source_url 不是 *.gov.cn：{ss['source_url']}")
    if ss.get("needs_human") and not ss.get("needs_human_reason"):
        r.warn(w, "needs_human 为 true，但没写 needs_human_reason")
    if ss.get("access_blocked") and not ss.get("needs_human"):
        r.err(w, "access_blocked 为 true 时 needs_human 也必须为 true")


def check_living(r, lv):
    if not isinstance(lv, dict):
        r.err("living", "缺失或不是映射")
        return
    w = "living"
    for k in ("rent_avg_per_sqm", "consumption_per_capita", "income_per_capita"):
        v = lv.get(k)
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float))):
            r.err(f"{w}.{k}", f"应为数字，实际为 {v!r}")
    check_date(r, f"{w}.verified_at", lv.get("verified_at"))
    any_value = False
    if lv.get("rent_avg_per_sqm") is not None:
        any_value = True
        for k in ("rent_period", "rent_source_url"):
            if not lv.get(k):
                r.err(w, f"有房租但没有 {k}")
        if not lv.get("rent_source"):
            r.warn(w, "有房租但没写 rent_source（机构与口径）")
    if lv.get("consumption_per_capita") is not None or lv.get("income_per_capita") is not None:
        any_value = True
        for k in ("stats_year", "stats_source_url"):
            if not lv.get(k):
                r.err(w, f"有统计数据但没有 {k}")
    if any_value and not lv.get("verified_at"):
        r.err(w, "有数字但没有 verified_at")
    if lv.get("needs_human") and not lv.get("needs_human_reason"):
        r.warn(w, "needs_human 为 true，但没写 needs_human_reason")
    if lv.get("access_blocked") and not lv.get("needs_human"):
        r.err(w, "access_blocked 为 true 时 needs_human 也必须为 true")


def _num(r, w, sec, keys):
    for k in keys:
        v = sec.get(k)
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float))):
            r.err(f"{w}.{k}", f"应为数字，实际为 {v!r}")


def _flags(r, w, sec):
    check_date(r, f"{w}.verified_at", sec.get("verified_at"))
    if sec.get("needs_human") and not sec.get("needs_human_reason"):
        r.warn(w, "needs_human 为 true，但没写 needs_human_reason")
    if sec.get("access_blocked") and not sec.get("needs_human"):
        r.err(w, "access_blocked 为 true 时 needs_human 也必须为 true")


def check_flexible(r, fe):
    w = "flexible_employment"
    if not isinstance(fe, dict):
        r.err(w, "缺失或不是映射")
        return
    _num(r, w, fe, ("pension_base_min", "pension_rate", "medical_monthly_min", "monthly_total_min"))
    _flags(r, w, fe)
    if fe.get("nonlocal_allowed") is not None and not isinstance(fe["nonlocal_allowed"], bool):
        r.err(w, "nonlocal_allowed 应为 true/false/null")
    if fe.get("pension_base_min") is not None or fe.get("pension_rate") is not None:
        for k in ("source_url", "verified_at", "pension_year"):
            if not fe.get(k):
                r.err(w, f"有养老基数/比例但没有 {k}")
    if fe.get("medical_monthly_min") is not None and not (fe.get("medical_source_url") or fe.get("source_url")):
        r.err(w, "有医保金额但没有来源")
    if fe.get("monthly_total_min") is not None:
        if not fe.get("calc"):
            r.err(w, "monthly_total_min 必须写明算法 calc")
        if fe.get("pension_base_min") is None or fe.get("pension_rate") is None or fe.get("medical_monthly_min") is None:
            r.err(w, "monthly_total_min 只能由本节已填的养老基数、比例和医保金额算出")
    if (fe.get("hukou_restriction") or fe.get("nonlocal_allowed") is not None) \
            and not (fe.get("hukou_source_url") or fe.get("source_url")):
        r.err(w, "写了户籍限制但没有来源")


def check_civil(r, cs):
    w = "civil_service"
    if not isinstance(cs, dict):
        r.err(w, "缺失或不是映射")
        return
    _flags(r, w, cs)
    if any(cs.get(k) for k in ("fresh_grad_rule", "exam_schedule")):
        if not cs.get("source_url"):
            r.err(w, "有内容但没有 source_url")
        elif not is_gov_url(cs["source_url"]):
            r.err(w, f"考公口径必须来自政府官网：{cs['source_url']}")
        if not cs.get("verified_at"):
            r.err(w, "有内容但没有 verified_at")


def check_commute(r, cm):
    w = "commute"
    if not isinstance(cm, dict):
        r.err(w, "缺失或不是映射")
        return
    _num(r, w, cm, ("avg_commute_minutes",))
    _flags(r, w, cm)
    if cm.get("avg_commute_minutes") is not None:
        for k in ("year", "report", "source_url", "verified_at"):
            if not cm.get(k):
                r.err(w, f"有通勤时间但没有 {k}")


def check_pitfalls(r, pits):
    if pits is None:
        return
    if not isinstance(pits, list):
        r.err("pitfalls", "应为列表")
        return
    for i, p in enumerate(pits):
        if not isinstance(p, dict) or (not p.get("text") and not p.get("source_url")):
            r.warn(f"pitfalls[{i}]", "空条目")
            continue
        if p.get("text") and not p.get("source_url"):
            r.err(f"pitfalls[{i}]", "坑必须附 source_url")


def check_changelog(r, cl):
    if cl is None:
        r.err("changelog", "缺失（没有记录请写 []）")
        return
    if not isinstance(cl, list):
        r.err("changelog", "应为列表")
        return
    for i, c in enumerate(cl):
        w = f"changelog[{i}]"
        if not isinstance(c, dict):
            r.err(w, "应为映射 {date, field, old, new, basis}")
            continue
        for k in ("date", "field", "basis"):
            if not c.get(k):
                r.err(w, f"缺少 {k}")
        check_date(r, f"{w}.date", c.get("date"))


def validate_file(path: Path, is_template=False) -> Report:
    r = Report(path.name)
    try:
        d = load_yaml(path)
    except Exception as e:  # noqa: BLE001
        r.err("yaml", f"解析失败：{e}")
        return r
    if not isinstance(d, dict):
        r.err("yaml", "顶层应为映射")
        return r
    for k in TOP_KEYS:
        if k not in d:
            r.err(k, "缺少顶层字段")
    if is_template:
        return r
    if not NAME_RE.match(path.stem):
        r.err("filename", "文件名应为小写拼音，如 hangzhou.yaml")
    for k in ("city", "province"):
        if not d.get(k):
            r.err(k, "不能为空")
    check_date(r, "last_patrol", d.get("last_patrol"))
    check_hukou(r, d.get("hukou"))
    check_subsidies(r, d.get("subsidies"))
    check_social_security(r, d.get("social_security"))
    check_living(r, d.get("living"))
    check_flexible(r, d.get("flexible_employment"))
    check_civil(r, d.get("civil_service"))
    check_commute(r, d.get("commute"))
    check_pitfalls(r, d.get("pitfalls"))
    check_changelog(r, d.get("changelog"))
    return r


def main(argv):
    strict = "--strict" in argv
    names = [a for a in argv if not a.startswith("-")]
    reports = [validate_file(CITIES_DIR / "_template.yaml", is_template=True)]
    files = [CITIES_DIR / f"{n}.yaml" for n in names] if names else city_files()
    for p in files:
        if not p.exists():
            print(f"✗ 找不到 {p}")
            return 1
        reports.append(validate_file(p))

    n_err = n_warn = 0
    for r in reports:
        n_err += len(r.errors)
        n_warn += len(r.warnings)
        mark = "✗" if r.errors else ("!" if r.warnings else "✓")
        print(f"{mark} {r.name}")
        for e in r.errors:
            print(f"    error   {e}")
        for w in r.warnings:
            print(f"    warning {w}")
    print(f"\n{len(reports) - 1} 座城市，{n_err} 个错误，{n_warn} 个警告")
    return 1 if n_err or (strict and n_warn) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
