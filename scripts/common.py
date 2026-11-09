"""validate.py 与 build.py 共用的读取与判定逻辑。"""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from urllib.parse import urlparse

import yaml

ROOT = Path(__file__).resolve().parent.parent
CITIES_DIR = ROOT / "data" / "cities"
DEGREES = ("associate", "bachelor", "master", "phd")
DEGREE_LABEL = {"associate": "专科", "bachelor": "本科", "master": "硕士", "phd": "博士"}

# 六个维度：落户、人才（生活）补贴、租房补贴、房租、社保、生活成本
DIMENSIONS = ("hukou", "living_subsidy", "rent_subsidy", "rent", "social_security", "cost")
DIMENSION_LABEL = {
    "hukou": "落户",
    "living_subsidy": "生活补贴",
    "rent_subsidy": "租房补贴",
    "rent": "房租",
    "social_security": "社保",
    "cost": "生活成本",
}
STATUS_ICON = {"verified": "✅", "lead": "⚠️", "missing": "❌", "blocked": "🔒"}


class _DateAsStrLoader(yaml.SafeLoader):
    """不让 YAML 把日期自动转成 date 对象，统一按字符串校验。"""


_DateAsStrLoader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:timestamp"]
    for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def load_yaml(path: Path):
    with path.open(encoding="utf-8") as f:
        return yaml.load(f, Loader=_DateAsStrLoader)


def city_files(include_template: bool = False) -> list[Path]:
    files = sorted(CITIES_DIR.glob("*.yaml"))
    if not include_template:
        files = [p for p in files if not p.name.startswith("_")]
    return files


def today() -> dt.date:
    return dt.date.today()


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def parse_date(s) -> dt.date | None:
    if s is None:
        return None
    s = str(s)
    if DATE_RE.match(s):
        return dt.date.fromisoformat(s)
    return None


def is_gov_url(url: str | None) -> bool:
    if not url:
        return False
    host = (urlparse(str(url)).hostname or "").lower()
    return host.endswith(".gov.cn") or host == "gov.cn"


def is_empty(v) -> bool:
    if v is None:
        return True
    if isinstance(v, (str, list, dict)) and len(v) == 0:
        return True
    if isinstance(v, dict):
        return all(is_empty(x) for x in v.values())
    return False


def expired(section: dict, on: dt.date | None = None) -> bool:
    d = parse_date(section.get("valid_until"))
    return bool(d and d < (on or today()))


def usable(section: dict) -> bool:
    """可计入合计 / 可展示为 ✅：有官方来源、已核验、无需人工、未过期。"""
    return (
        bool(section.get("source_url"))
        and bool(section.get("verified_at"))
        and not section.get("needs_human")
        and not section.get("access_blocked")
        and not expired(section)
    )


HUKOU_FACTS = ("summary", "education_min", "age_limit", "requires_job_or_social_security",
               "eligible_by_degree", "tier_by_degree", "age_max_by_degree", "conditions", "apply_window")
SUBSIDY_FACTS = ("amount", "amount_by_degree", "period", "periods_max", "payout", "target",
                 "conditions", "deadline_rule")


def _status(section: dict | None, facts) -> str:
    if not section:
        return "missing"
    if section.get("access_blocked"):
        return "blocked"
    has_facts = any(not is_empty(section.get(k)) for k in facts)
    if has_facts and usable(section):
        return "verified"
    if has_facts or section.get("lead"):
        return "lead"
    return "missing"


def _best(statuses: list[str]) -> str:
    for s in ("verified", "lead", "blocked", "missing"):
        if s in statuses:
            return s
    return "missing"


def dimension_status(city: dict) -> dict[str, str]:
    subs = [s for s in (city.get("subsidies") or []) if s and s.get("name")]
    living = city.get("living") or {}
    ss = city.get("social_security") or {}

    def subs_status(kind):
        group = [s for s in subs if s.get("type") == kind]
        return _best([_status(s, SUBSIDY_FACTS) for s in group]) if group else "missing"

    def living_part(value_keys, url_key):
        if living.get("access_blocked") and all(living.get(k) is None for k in value_keys):
            return "blocked"
        if all(living.get(k) is not None for k in value_keys) and living.get(url_key) \
                and living.get("verified_at") and not living.get("needs_human"):
            return "verified"
        if any(living.get(k) is not None for k in value_keys):
            return "lead"
        return "missing"

    if ss.get("access_blocked") and ss.get("base_min") is None:
        ss_status = "blocked"
    elif ss.get("base_min") is not None and ss.get("source_type") in ("gov", "gov_account") \
            and ss.get("source_url") and ss.get("verified_at") and not ss.get("needs_human"):
        ss_status = "verified"
    elif ss.get("base_min") is not None:
        ss_status = "lead"
    else:
        ss_status = "missing"

    return {
        "hukou": _status(city.get("hukou"), HUKOU_FACTS),
        "living_subsidy": subs_status("living"),
        "rent_subsidy": subs_status("rent"),
        "rent": living_part(("rent_avg_per_sqm",), "rent_source_url"),
        "social_security": ss_status,
        "cost": living_part(("consumption_per_capita", "income_per_capita"), "stats_source_url"),
    }
