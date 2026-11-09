"""Link-only resident navigation and an isolated, fictional-only tier model.

No live prices are authorized in v1. Never use this model for actual billing.
"""
from __future__ import annotations

import copy
import datetime as dt
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / 'data' / 'life'
KINDS = ('utilities', 'climate', 'healthcare')
PILOT_IDS = ('beijing', 'shanghai', 'guangzhou')
REQUIRED = ('city_id', 'id', 'title', 'status', 'summary', 'coverage', 'verified_at',
            'next_review_at', 'verified_by', 'evidence_locator', 'reference_period',
            'verification_scope', 'redistribution_status', 'license_note',
            'review_status', 'reason')


def _date(value):
    try:
        return dt.date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def _official(url):
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    return parsed.scheme == 'https' and host.endswith('.gov.cn') and not parsed.username


def _records(data_dir=DATA_DIR):
    for kind in KINDS:
        for path in sorted((Path(data_dir) / kind).glob('*.json')):
            for item in json.loads(path.read_text(encoding='utf-8')):
                yield path, item


def validate_modules(data_dir=DATA_DIR) -> list[str]:
    """Structural safety checks; an elapsed review date is rendered, not hidden."""
    errors, seen = [], set()
    try:
        records = list(_records(data_dir))
    except (ValueError, TypeError, OSError) as exc:
        return [f'life modules: cannot read JSON: {exc}']
    for path, row in records:
        label = f'{path.name}:{row.get("id", "?")}' if isinstance(row, dict) else str(path)
        if not isinstance(row, dict):
            errors.append(f'{label}: record must be an object')
            continue
        for field in REQUIRED:
            if not isinstance(row.get(field), str) or not row[field].strip():
                errors.append(f'{label}: missing or invalid {field}')
        city = row.get('city_id')
        if city not in PILOT_IDS or city != path.stem:
            errors.append(f'{label}: unknown/mismatched pilot city')
        key = (str(city), str(row.get('id')))
        if key in seen:
            errors.append(f'{label}: duplicate module')
        seen.add(key)
        if row.get('schema_version') != 1:
            errors.append(f'{label}: unsupported schema')
        if row.get('status') not in ('link_only', 'missing', 'blocked', 'expired'):
            errors.append(f'{label}: v1 permits navigation only')
        if row.get('calculator_enabled') is not False:
            errors.append(f'{label}: production calculator is disabled in v1')
        if row.get('redistribution_status') != 'link_only':
            errors.append(f'{label}: v1 source redistribution must remain link-only')
        if row.get('review_status') not in ('pending_independent_review', 'reviewed'):
            errors.append(f'{label}: invalid review status')
        for field in ('tariff', 'tiers', 'price', 'value', 'rates'):
            if row.get(field) is not None:
                errors.append(f'{label}: numeric production payload {field} not authorized')
        if row.get('monthly_values') is not None:
            errors.append(f'{label}: climate series not authorized')
        dates = {f: _date(row.get(f)) for f in ('verified_at', 'next_review_at')}
        if not all(dates.values()) or (all(dates.values()) and dates['next_review_at'] < dates['verified_at']):
            errors.append(f'{label}: invalid verification/review dates')
        for field in ('source_date', 'effective_from', 'effective_to'):
            if row.get(field) is not None and not _date(row[field]):
                errors.append(f'{label}: invalid {field}')
        links = row.get('links')
        if not isinstance(links, list) or not links:
            errors.append(f'{label}: links required')
        else:
            for link in links:
                if not isinstance(link, dict) or not link.get('label') or not _official(link.get('url')):
                    errors.append(f'{label}: labelled HTTPS gov.cn link required')
    return errors


def build_modules(city_ids, *, on=None, data_dir=DATA_DIR) -> dict:
    """Return cards per requested city; fail closed on invalid source records."""
    errors = validate_modules(data_dir)
    if errors:
        raise ValueError('\n'.join(errors))
    on = on or dt.date.today()
    result = {city: [] for city in city_ids}
    for _, raw in _records(data_dir):
        if raw['city_id'] not in result:
            continue
        row = copy.deepcopy(raw)
        row['usable'] = False  # Never a qualified tariff, reimbursement or observation.
        if row.get('effective_to') and _date(row['effective_to']) < on:
            row['status'] = 'expired'
            row['reason'] = '来源记录已到期；仅留历史入口。' + row['reason']
        elif row.get('effective_from') and _date(row['effective_from']) > on:
            row['status'] = 'pending_review'
            row['reason'] = '来源记录尚未到生效日；不能视为现行规则。' + row['reason']
        elif _date(row['verified_at']) > on:
            row['status'] = 'pending_review'
            row['reason'] = '核验日期晚于构建日期，不能作为已核验记录。' + row['reason']
        elif _date(row['next_review_at']) < on:
            row['status'] = 'pending_review'
            row['reason'] = '已超过复核窗口；入口及规则均需重新打开核验。' + row['reason']
        result[row['city_id']].append(row)
    return result


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError('finite nonnegative decimal required')
    try:
        number = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError('invalid decimal') from exc
    if not number.is_finite() or number < 0 or number > Decimal('1000000'):
        raise ValueError('input outside fictional model range 0..1000000')
    return number


def fictional_annual_tier_charge(*, prior_usage, usage, tiers, year, prior_year,
                                 fictional=False, currency='CNY', meter='individual',
                                 time_of_use=False, multi_person=False,
                                 rent_included=False, partial_year=False):
    """Fictional full-calendar-year model only, never a city tariff.

    tiers is [(cumulative_upper_bound, price), ..., (None, price)].
    Charge = integral(prior + usage) - integral(prior), rounded once to fen.
    Cross-year bills must be split explicitly, never silently reset or prorated.
    """
    if fictional is not True:
        raise ValueError('production tariffs are not approved; fictional=True required')
    if (currency != 'CNY' or meter != 'individual' or time_of_use or multi_person
            or rent_included or partial_year):
        raise ValueError('unsupported billing scope; do not approximate')
    if type(year) is not int or type(prior_year) is not int or not 1900 <= year <= 9999 or year != prior_year:
        raise ValueError('split cross-year periods and explicitly reset annual usage')
    prior, amount = _number(prior_usage), _number(usage)
    end = _number(prior + amount)
    if not isinstance(tiers, (list, tuple)) or not tiers or len(tiers) > 10:
        raise ValueError('1..10 tiers required')
    lower, subtotal, breakdown = Decimal(0), Decimal(0), []
    for i, tier in enumerate(tiers):
        if not isinstance(tier, (list, tuple)) or len(tier) != 2:
            raise ValueError('tier must contain upper bound and price')
        upper_raw, price_raw = tier
        if (upper_raw is None) != (i == len(tiers) - 1):
            raise ValueError('only final tier must be unbounded')
        upper = _number(upper_raw) if upper_raw is not None else None
        if upper is not None and upper <= lower:
            raise ValueError('tier boundaries must strictly increase')
        price = _number(price_raw)
        quantity = max(Decimal(0), min(end, upper if upper is not None else end) - max(prior, lower))
        cost = quantity * price
        subtotal += cost
        breakdown.append({'quantity': str(quantity), 'unit_price': str(price), 'amount': str(cost)})
        if upper is not None:
            lower = upper
    return {'amount': str(subtotal.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)),
            'currency': 'CNY', 'breakdown': breakdown, 'value_kind': 'scenario',
            'warning': '虚构规则测试；仅当期已覆盖项目，不是实际账单、城市平均生活费或完整生活成本。'}
