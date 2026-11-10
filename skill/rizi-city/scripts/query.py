#!/usr/bin/env python3
"""rizi-city 查询脚本：只用标准库，读「日子人城市指南」的数据，输出带来源和核验日期的 Markdown。

数据来源（按顺序找）：
  1. --data 指定的 cities.json
  2. 环境变量 RIZI_DATA
  3. 从当前目录往上找 site/data/cities.json（在 rizi-city 仓库里时）
  4. 网页版 https://baichen99.github.io/rizi-city/data/cities.json

用法：
  query.py list
  query.py city 杭州 [--degree master]
  query.py compare 杭州 成都 --degree master
  query.py rank [--degree bachelor] [--by money|hukou|rent] [--top 10]
  query.py free [城市 ...]
  query.py freshgrad
  query.py index [--w 1.1.1.1.1] [--city 武汉]
  query.py overview 广州 [上海 ...]
  query.py history 广州 [--metric wage_nonprivate_mean]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request
from pathlib import Path

REMOTE = "https://baichen99.github.io/rizi-city/data/cities.json"
REPO = "https://github.com/baichen99/rizi-city"
DEG = {"associate": "专科", "bachelor": "本科", "master": "硕士", "phd": "博士"}
DEG_ALIAS = {"专科": "associate", "大专": "associate", "本科": "bachelor", "学士": "bachelor",
             "硕士": "master", "研究生": "master", "博士": "phd"}
TIER = {"direct": "直接落户（不要求先就业）", "job": "先就业或缴社保后落户", "quota": "单位指标或积分"}
STATUS = {"verified": "✅", "none": "✅无", "lead": "⚠️", "missing": "❌", "blocked": "🔒"}
DISCLAIMER = "> 仅供参考，申请前以官方页面为准。数据来自 rizi-city（" + REPO + "），⚠️ 表示未核实或未计入。"


# ---------- 读数据 ----------

def load(path: str | None) -> tuple[dict, str]:
    cand = path or os.environ.get("RIZI_DATA")
    if not cand:
        here = Path.cwd()
        for d in (here, *here.parents):
            p = d / "site" / "data" / "cities.json"
            if p.exists():
                cand = str(p)
                break
    if cand:
        return json.loads(Path(cand).read_text(encoding="utf-8")), cand
    req = urllib.request.Request(REMOTE, headers={"User-Agent": "rizi-city-skill"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8")), REMOTE


def find(data: dict, name: str) -> dict:
    key = name.strip().removesuffix("市").lower()
    for c in data["cities"]:
        if key in (c["id"], c["city"].removesuffix("市").lower()):
            return c
    names = "、".join(c["city"] for c in data["cities"])
    sys.exit(f"没有「{name}」的数据。目前收录：{names}。\n想加这座城市？{REPO}/issues/new?template=new-city.yml")


def deg_key(s: str) -> str:
    if s in DEG:
        return s
    if s in DEG_ALIAS:
        return DEG_ALIAS[s]
    sys.exit(f"学历只能是：{'、'.join(DEG.values())}（或 associate/bachelor/master/phd）")


# ---------- 小工具 ----------

def money(n) -> str:
    if n is None:
        return "—"
    if n >= 10000:
        return f"{n / 10000:.2f}".rstrip("0").rstrip(".") + " 万元"
    return f"{n:,.0f} 元"


def src(url, verified=None, label="来源") -> str:
    s = f"[{label}]({url})" if url else "（无来源链接）"
    return s + (f"，核验 {verified}" if verified else "，未核验")


def expired_now(sec: dict | None) -> bool:
    v = (sec or {}).get("valid_until")
    try:
        return bool(v) and dt.date.fromisoformat(str(v)) < dt.date.today()
    except ValueError:
        return False


def stale_note(data: dict) -> str:
    lv = data.get("latest_verified")
    try:
        days = (dt.date.today() - dt.date.fromisoformat(lv)).days
    except (TypeError, ValueError):
        return ""
    return f"\n> ⚠️ 这份数据最近一次核验是 {lv}（{days} 天前），政策可能已更新。\n" if days > 90 else ""


# ---------- 各段输出 ----------

def hukou_md(c: dict, deg: str) -> str:
    h = c.get("hukou") or {}
    b = c["by_degree"][deg]
    st = c["status"]["hukou"]
    tier = (h.get("tier_by_degree") or {}).get(deg)
    if st != "verified":
        verdict = "🔒 官网无法访问，待核实" if st == "blocked" else "⚠️ 待核实"
    elif b["hukou_eligible"] is True:
        verdict = "能落户" + (f"：{TIER[tier]}" if tier else "")
        amax = b["hukou_age_max"]
        if amax:
            verdict += f"；年龄上限 {amax} 周岁（含义照原文：{h.get('age_limit') or '见原文'}）"
    elif b["hukou_eligible"] is False:
        verdict = "不能按学历落户"
    else:
        verdict = "⚠️ 不确定"
    lines = [f"- **落户（{DEG[deg]}）**：{verdict}"]
    if h.get("summary"):
        lines.append(f"  - 原文口径：{h['summary']}")
    for x in h.get("conditions") or []:
        lines.append(f"  - {x}")
    tail = src(h.get("source_url"), h.get("verified_at"), h.get("policy_name") or "原文")
    if h.get("valid_until"):
        tail += f"；有效期至 {h['valid_until']}" + ("（⚠️ 已过期）" if expired_now(h) else "")
    if h.get("needs_human"):
        tail += f"；⚠️ {h.get('needs_human_reason') or '待人工核实'}"
    lines.append(f"  - {tail}")
    return "\n".join(lines)


def subsidy_md(c: dict, deg: str) -> str:
    b = c["by_degree"][deg]
    subs = c.get("subsidies") or []
    lines = [f"- **能领多少（{DEG[deg]}，只算已核实、未过期的市级现金补贴，按原文上限）**：{money(b['total']) if b['counted'] else '0 元'}"]
    for it in b["counted"]:
        s = subs[it["index"]]
        per = {"once": "一次性", "year": "/年", "month": "/月"}.get(it["period"], "")
        exp = "（⚠️ 现在已过有效期，请先查接替文件）" if expired_now(s) else ""
        lines.append(f"  - ✅ {it['name']}：{money(it['per'])}{per}，合计上限 {money(it['total'])}{exp}")
        if s.get("amount"):
            lines.append(f"    - 原文：{s['amount']}")
        if s.get("target"):
            lines.append(f"    - 对象：{s['target']}")
        for x in s.get("conditions") or []:
            lines.append(f"    - 条件：{x}")
        if s.get("deadline_rule"):
            lines.append(f"    - 申请时限：{s['deadline_rule']}")
        lines.append(f"    - {src(s.get('source_url'), s.get('verified_at'), s.get('policy_name') or '原文')}"
                     + (f"；有效期至 {s['valid_until']}" if s.get("valid_until") else ""))
    for it in b["excluded"]:
        s = subs[it["index"]]
        amt = f"（原文 {money(it['per'])}）" if it.get("per") is not None else ""
        lines.append(f"  - ⚠️ 未计入：{it['name']}{amt}。原因：{it['reason']}")
        if s.get("source_url"):
            lines.append(f"    - {src(s.get('source_url'), s.get('verified_at'))}")
        elif s.get("lead_url"):
            lines.append(f"    - 线索（非官方，不作数）：{s['lead_url']}")
    st = c["status"]
    scan = c.get("subsidy_scan") or {}
    none = [n for k, n in (("living_subsidy", "生活补贴"), ("rent_subsidy", "租房补贴")) if st[k] == "none"]
    if none:
        lines.append(f"  - ✅ 已核实：没有面向普通应届生的市级现金{'、'.join(none)}（区级、限行业、限专业的不算）。"
                     f"{scan.get('basis') or ''} {src(scan.get('source_url'), scan.get('verified_at'), '依据')}")
    if not b["counted"] and not b["excluded"] and not none:
        if st["rent_subsidy"] == "verified" or st["living_subsidy"] == "verified":
            lines.append("  - ⚠️ 有补贴，但原文金额无法取单一值（如按区分档），没有计入合计；具体见 `city` 输出的原文。")
        else:
            lines.append("  - ⚠️ 这一学历的补贴还没查清。")
    return "\n".join(lines)


def living_md(c: dict) -> str:
    lv, ss = c.get("living") or {}, c.get("social_security") or {}
    out = []
    if lv.get("rent_avg_per_sqm") is not None:
        out.append(f"- **房租**：{lv['rent_avg_per_sqm']} 元/㎡/月（30㎡ 单间约 {money(round(lv['rent_avg_per_sqm'] * 30))}/月），"
                   f"{lv.get('rent_source') or ''}，{lv.get('rent_period') or ''}；{src(lv.get('rent_source_url'), lv.get('verified_at'))}")
    inc, con = lv.get("income_per_capita"), lv.get("consumption_per_capita")
    if inc or con:
        flag = " ⚠️" if lv.get("needs_human") else ""
        out.append(f"- **收入 / 消费**{flag}：人均可支配收入 {money(inc)}/年，人均消费支出 {money(con)}/年（{lv.get('stats_year') or ''}）；"
                   f"{src(lv.get('stats_source_url'), lv.get('verified_at'))}"
                   + (f"；⚠️ {lv.get('needs_human_reason')}" if lv.get("needs_human") else ""))
    if ss.get("base_min") is not None:
        flag = "" if c["status"]["social_security"] == "verified" else " ⚠️"
        out.append(f"- **职工社保缴费基数**{flag}：{money(ss['base_min'])}–{money(ss.get('base_max'))}/月（{ss.get('year') or ''}，{ss.get('scope') or ''}）；"
                   f"{src(ss.get('source_url'), ss.get('verified_at'))}")
    return "\n".join(out)


def pitfalls_md(c: dict) -> str:
    ps = [p for p in c.get("pitfalls") or [] if p and p.get("text")]
    if not ps:
        return ""
    return "- **容易踩的坑**：\n" + "\n".join(f"  - {p['text']}（{src(p.get('source_url'), label='依据').split('，')[0]}）" for p in ps)


def city_md(c: dict, deg: str) -> str:
    parts = [f"## {c['city']}", hukou_md(c, deg), subsidy_md(c, deg), living_md(c), pitfalls_md(c),
             f"- 完整数据：{REPO}/blob/main/data/cities/{c['id']}.yaml"]
    return "\n".join(p for p in parts if p)


# ---------- 子命令 ----------

def cmd_list(data, a):
    print(f"共 {data['city_count']} 座城市，最近核验 {data['latest_verified']}：\n")
    print("| 城市 | id | " + " | ".join(["落户", "生活补贴", "租房补贴", "房租", "社保", "生活成本"]) + " |")
    print("|---|---|" + "---|" * 6)
    for c in data["cities"]:
        s = c["status"]
        print(f"| {c['city']} | {c['id']} | " + " | ".join(STATUS[s[k]] for k in
              ("hukou", "living_subsidy", "rent_subsidy", "rent", "social_security", "cost")) + " |")


def cmd_city(data, a):
    deg = deg_key(a.degree)
    print(stale_note(data))
    for n in a.names:
        print(city_md(find(data, n), deg) + "\n")
    print(DISCLAIMER)


def cmd_compare(data, a):
    deg = deg_key(a.degree)
    cs = [find(data, n) for n in a.names]
    print(stale_note(data))
    print(f"### {DEG[deg]}：{' vs '.join(c['city'] for c in cs)}\n")
    print("| 城市 | 能领（已核实合计） | 未计入的 ⚠️ 项 | 落户 | 30㎡ 单间月租 |")
    print("|---|---|---|---|---|")
    for c in sorted(cs, key=lambda c: -c["by_degree"][deg]["total"]):
        b = c["by_degree"][deg]
        h = c.get("hukou") or {}
        tier = (h.get("tier_by_degree") or {}).get(deg)
        hk = ("能落户·" + TIER[tier].split("（")[0] if tier and b["hukou_eligible"] else
              "不能" if b["hukou_eligible"] is False else "⚠️ 待核实") if c["status"]["hukou"] == "verified" else "⚠️ 待核实"
        rent = (c.get("living") or {}).get("rent_avg_per_sqm")
        print(f"| {c['city']} | {money(b['total']) if b['counted'] else '0'} | {len(b['excluded']) or '—'} | {hk} | "
              f"{money(round(rent * 30)) if rent else '—'} |")
    print("\n明细（每个数字的来源和核验日期）：\n")
    for c in cs:
        print(city_md(c, deg) + "\n")
    print(DISCLAIMER)


def cmd_rank(data, a):
    deg = deg_key(a.degree)
    tier_rank = {"direct": 0, "job": 1, "quota": 2}

    def key(c):
        b = c["by_degree"][deg]
        if a.by == "money":
            return (-b["total"], len(b["excluded"]))
        if a.by == "rent":
            r = (c.get("living") or {}).get("rent_avg_per_sqm")
            return (r is None, r or 0)
        t = (c.get("hukou") or {}).get("tier_by_degree", {}) or {}
        ok = c["status"]["hukou"] == "verified" and b["hukou_eligible"]
        return (not ok, tier_rank.get(t.get(deg), 3))
    rows = sorted(data["cities"], key=key)[: a.top]
    title = {"money": "最能领钱", "rent": "房租最低", "hukou": "落户最容易"}[a.by]
    print(stale_note(data))
    print(f"### {DEG[deg]} · {title} Top {len(rows)}\n")
    print("| # | 城市 | 能领（已核实） | ⚠️ 未计入 | 落户 | 每平米月租 |")
    print("|---|---|---|---|---|---|")
    for i, c in enumerate(rows, 1):
        b = c["by_degree"][deg]
        t = ((c.get("hukou") or {}).get("tier_by_degree") or {}).get(deg)
        hk = TIER[t].split("（")[0] if (t and c["status"]["hukou"] == "verified" and b["hukou_eligible"]) else "⚠️"
        r = (c.get("living") or {}).get("rent_avg_per_sqm")
        print(f"| {i} | {c['city']} | {money(b['total']) if b['counted'] else '0'} | {len(b['excluded']) or '—'} | {hk} | {r if r is not None else '—'} |")
    print("\n想看某座城市每个数字的来源，用 `query.py city <城市>`。\n")
    print(DISCLAIMER)


def cmd_free(data, a):
    cs = [find(data, n) for n in a.names] if a.names else data["cities"]
    print(stale_note(data))
    print("### 灵活就业每月最少自缴社保（养老 + 医保最低档）\n")
    print("底线成本 = 最少自缴社保 + 30㎡ 单间月租；⚠️ 未核实的不计入。\n")
    ok = sorted([c for c in cs if c.get("floor", {}).get("social") is not None], key=lambda c: c["floor"]["social"])
    for c in ok + [c for c in cs if c not in ok]:
        fe = c.get("flexible_employment") or {}
        fl = c.get("floor") or {}
        nl = {True: "外地户籍可以参保", False: "限本地户籍", None: "⚠️ 外地户籍能否参保未核实"}[fe.get("nonlocal_allowed")]
        if fl.get("social") is not None:
            head = f"- **{c['city']}**：每月最少 {money(fl['social'])}，底线成本约 {money(fl.get('total'))}/月；{nl}"
        elif fe.get("monthly_total_min") is not None:
            head = f"- **{c['city']}** ⚠️：原文测算 {money(fe['monthly_total_min'])}/月，但有未核实部分，不计入；{nl}"
        else:
            head = f"- **{c['city']}** ⚠️：每月最少自缴还算不出来；{nl}"
        print(head)
        if fe.get("calc"):
            print(f"  - 算法：{fe['calc']}")
        print(f"  - {src(fe.get('source_url'), fe.get('verified_at'), '养老基数来源')}"
              + (f"；{src(fe.get('medical_source_url'), label='医保来源').split('，')[0]}" if fe.get("medical_source_url") else "")
              + (f"；{src(fe.get('hukou_source_url'), label='户籍限制依据').split('，')[0]}" if fe.get("hukou_source_url") else ""))
        if fe.get("needs_human"):
            print(f"  - ⚠️ {fe.get('needs_human_reason')}")
    print("\n" + DISCLAIMER)


def cmd_freshgrad(data, a):
    cs = (data.get("national") or {}).get("civil_service")
    if not cs:
        sys.exit("这份数据里还没有国家层面的应届认定规则（data/national.yaml）。")
    fg = cs["fresh_grad"]
    print(f"### {cs['exam']}：谁算应届生\n")
    print(f"- 本次应届届别：{fg['current_class']} 届")
    print(f"- 可按应届对待的往届：{'、'.join(map(str, fg['choose_job_years']))} 届，条件：{fg['rule']}")
    print(f"- 社保：{fg['social_security_note']}")
    print(f"- 服务基层项目：{fg['grassroots_project']}")
    print(f"- 留学回国：{fg['returnee']}")
    print(f"- 截止时间：{fg['qualification_deadline']}")
    print(f"- {src(cs['source_url'], cs.get('verified_at'), cs.get('source_title') or '原文')}\n")
    print("> 这是国考口径。省考、事业单位招聘可能不同，以具体招考公告为准。")


ACTIVE = [("rent", "房租负担", -1), ("cost", "生活成本", -1), ("hukou", "落户难度", 1),
          ("subsidy", "补贴力度", 1), ("social", "社保负担", -1)]
TIER_SCORE = {"direct": 2, "job": 1, "quota": 0}


def cmd_index(data, a):
    """与网页 site/app.js 的 computeIndex() 同一算法，见 docs/index-method.md。"""
    try:
        w = [int(x) for x in a.w.split(".")]
        assert len(w) == len(ACTIVE) and all(0 <= x <= 5 for x in w)
    except (ValueError, AssertionError):
        sys.exit("--w 要写 5 个 0–5 的整数，用点隔开，顺序：房租.生活成本.落户.补贴.社保，如 3.1.1.1.1")
    W = dict(zip([k for k, _, _ in ACTIVE], w))

    def raw(c, k):
        v = c["index"][k]
        if not v["ok"]:
            return None
        return TIER_SCORE[v["value"]] if k == "hukou" else v["value"]
    rows = [{"c": c, "miss": [lab for k, lab, _ in ACTIVE if not c["index"][k]["ok"]]} for c in data["cities"]]
    ranked = [r for r in rows if len(r["miss"]) <= 1]
    pending = [r for r in rows if len(r["miss"]) > 1]
    rng = {}
    for k, _, _ in ACTIVE:
        vals = [raw(r["c"], k) for r in ranked if raw(r["c"], k) is not None]
        rng[k] = (min(vals), max(vals))
    for r in ranked:
        sw = s = 0
        r["sc"] = {}
        for k, _, d in ACTIVE:
            v = raw(r["c"], k)
            if v is None:
                continue
            lo, hi = rng[k]
            sc = 100 if hi == lo else ((hi - v) if d < 0 else (v - lo)) / (hi - lo) * 100
            r["sc"][k] = sc
            sw += W[k]
            s += W[k] * sc
        r["total"] = s / sw if sw else None
    ranked.sort(key=lambda r: -(r["total"] or -1))
    print(f"### 日子指数 {data.get('index_version', '')}（权重 房租×{w[0]} 生活成本×{w[1]} 落户×{w[2]} 补贴×{w[3]} 社保×{w[4]}；通勤暂停用）\n")
    print("| # | 城市 | 指数 | " + " | ".join(lab for _, lab, _ in ACTIVE) + " | 缺失 |")
    print("|---|---|---|" + "---|" * len(ACTIVE) + "---|")
    for i, r in enumerate(ranked, 1):
        cells = " | ".join(f"{r['sc'][k]:.0f}" if k in r["sc"] else "⚠️" for k, _, _ in ACTIVE)
        t = f"{r['total']:.0f}" if r["total"] is not None else "—"
        print(f"| {i} | {r['c']['city']} | {t} | {cells} | {'、'.join(r['miss']) or '—'} |")
    print(f"\n数据收集中（缺 2 项及以上，不排名）：{'、'.join(r['c']['city'] + '（缺' + '、'.join(r['miss']) + '）' for r in pending)}\n")
    if a.city:
        c = find(data, a.city)
        hit = next((i for i, r in enumerate(ranked, 1) if r["c"]["id"] == c["id"]), None)
        print(f"**{c['city']}**：" + (f"第 {hit} / {len(ranked)}" if hit else "还在数据收集中，暂不排名") + "\n")
    print(f"算法：{REPO}/blob/main/docs/index-method.md 。日子指数仅反映公开数据，不代表城市好坏。")


def life_source(life, record):
    source = next((s for s in life.get("sources", []) if s.get("id") == record.get("source_id")), {})
    return src(source.get("url") or source.get("source_url"),
               record.get("verified_at") or source.get("verified_at"),
               source.get("title") or source.get("source_title") or "官方原文")


def life_value(record):
    value = record.get("value")
    if value is None:
        return "—（" + (record.get("missing_reason") or "尚未覆盖") + "）"
    return f"{value:,} {record.get('unit', '')}"


def life_current_record(life, record):
    """An old downloaded JSON must not bypass its source review deadline."""
    current = dict(record)
    source = next((s for s in life.get("sources", []) if s.get("id") == record.get("source_id")), {})
    due = source.get("review_due")
    if due and due < dt.date.today().isoformat():
        current.update(value=None, review_status="stale", missing_reason="已超过来源复核期限，复核前暂不展示数值。")
    return current


def cmd_overview(data, a):
    """居民概况不要求学历，不把统计工资等同于个人收入。"""
    for name in a.names:
        c = find(data, name)
        life = c.get("life") or {}
        print(f"### {c['city']} · 本城概况\n")
        print("统计资料不是个人工资或寿命预测；房价指数不是元/㎡房价。资料年份与核验日期不同。\n")
        if not life.get("overview"):
            print("新版概况尚未覆盖；可用 city 命令查看已收录政策与租金资料。")
        for record in life.get("overview", []):
            r = life_current_record(life, record)
            print(f"- **{r.get('label') or r.get('metric')}**：{life_value(r)}")
            print(f"  - 资料期：{r.get('period') or '未说明'}；对象：{r.get('population_scope') or '口径未说明'}；地域：{r.get('geographic_scope') or '未说明'}")
            print(f"  - 状态：{r.get('review_status') or '未核验'}；{life_source(life, r)}")
        for m in life.get("modules", []):
            print(f"- **{m.get('title')}**：{m.get('summary') or m.get('reason') or '尚未覆盖'}")
            statuses = {"link_only": "仅官方资料入口", "missing": "尚未覆盖", "pending_review": "待复核", "expired": "已过期"}
            status = m.get('status')
            if status != 'missing' and m.get('next_review_at') and m['next_review_at'] < dt.date.today().isoformat():
                status = 'pending_review'
            print(f"  - 状态：{statuses.get(status, status or '待核实')}；{m.get('reason') or '不提供个人账单或待遇结论'}")
            print(f"  - 适用范围：{m.get('coverage') or '未说明'}；资料核验：{m.get('verified_at') or '未核验'}；下次复核：{m.get('next_review_at') or '未说明'}")
            for link in m.get("links", []):
                print(f"  - [{link.get('label') or '官方入口'}]({link.get('url')})")
        print(f"\n已有落户/补贴以原适用人群为准，未收录不表示没有。城市页：{REPO.replace('https://github.com/baichen99/', 'https://baichen99.github.io/')}/#resident&city={c['id']}\n")
    print(DISCLAIMER)


def cmd_history(data, a):
    c = find(data, a.name)
    life = c.get("life") or {}
    series = [s for s in life.get("series", []) if not a.metric or
              s.get("metric") == a.metric or any(p.get("metric") == a.metric for p in s.get("points", []))]
    print(f"### {c['city']} · 历史观测\n")
    print("缺失不补零、不插值；不同人群、方法或指数基期不拼接。这里只展示已收录资料，不保证为最新发布。\n")
    if not series:
        print("未找到这个指标的合格历史序列。")
    for s in series:
        print(f"#### {s.get('label') or s.get('id')}（{s.get('unit', '')}）\n")
        for record in s.get("points", []):
            r = life_current_record(life, record)
            print(f"- {r.get('period')}：{life_value(r)}；{r.get('population_scope') or '口径未说明'}；{life_source(life, r)}")
        print()
    print(DISCLAIMER)


def main(argv=None):
    p = argparse.ArgumentParser(description="查询日子人城市指南（rizi-city）数据")
    p.add_argument("--data", help="cities.json 路径（默认自动查找，找不到就从网页版下载）")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    for name in ("city", "compare"):
        s = sub.add_parser(name)
        s.add_argument("names", nargs="+")
        s.add_argument("--degree", default="bachelor")
    s = sub.add_parser("rank")
    s.add_argument("--degree", default="bachelor")
    s.add_argument("--by", choices=["money", "hukou", "rent"], default="money")
    s.add_argument("--top", type=int, default=10)
    s = sub.add_parser("free")
    s.add_argument("names", nargs="*")
    sub.add_parser("freshgrad")
    s = sub.add_parser("index")
    s.add_argument("--w", default="1.1.1.1.1")
    s.add_argument("--city")
    s = sub.add_parser("overview")
    s.add_argument("names", nargs="+")
    s = sub.add_parser("history")
    s.add_argument("name")
    s.add_argument("--metric", help="指标 ID，例如 wage_nonprivate_mean")
    a = p.parse_args(argv)
    data, where = load(a.data)
    print(f"<!-- 数据：{where} -->")
    {"list": cmd_list, "city": cmd_city, "compare": cmd_compare, "rank": cmd_rank,
     "free": cmd_free, "freshgrad": cmd_freshgrad, "index": cmd_index,
     "overview": cmd_overview, "history": cmd_history}[a.cmd](data, a)


if __name__ == "__main__":
    main()
