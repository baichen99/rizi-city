"""Small, attributed official fact extracts. Never fetch sources during a build.

validate_life() validates checked-in inputs; build_life(ids) validates, gates and
returns independent public payloads. No values from link-only sources are stored.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date
import json
import math
from pathlib import Path
import re
from urllib.parse import urlparse

LIFE_DIR = Path(__file__).resolve().parents[1] / 'data' / 'life'
METRICS = {'housing_new_yoy_index', 'wage_nonprivate_mean', 'wage_private_mean',
           'wage_median', 'life_expectancy'}
STATUSES = {'verified', 'missing', 'restricted', 'needs_review', 'stale'}
RECORD_KEYS = {'id', 'metric', 'label', 'value', 'unit', 'period', 'population_scope',
               'geographic_scope', 'source_id', 'review_status', 'missing_reason',
               'verified_at', 'comparability_key', 'statistic', 'price_basis',
               'market_segment', 'base_period', 'comparison', 'unit_ownership',
               'gross_or_net', 'annual_or_monthly', 'includes_bonus', 'sex', 'age',
               'cross_city_comparability_key', 'geographic_scope_type', 'break_reason', 'evidence_locator'}
REQUIRED = {'id', 'metric', 'label', 'value', 'unit', 'period', 'population_scope',
            'geographic_scope', 'source_id', 'review_status', 'missing_reason',
            'verified_at', 'comparability_key', 'statistic'}


def gov_url(value):
    if not isinstance(value, str):
        return False
    try:
        p = urlparse(value)
        host = p.hostname or ''
        return (p.scheme == 'https' and host.endswith('.gov.cn')
                and not p.username and not p.password and p.port in (None, 443))
    except ValueError:
        return False


def valid_date(value):
    try:
        return isinstance(value, str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', value)) and date.fromisoformat(value) <= date.today()
    except ValueError:
        return False


def period_number(period, frequency):
    """Strict period validation and ordinal for gap detection (not interpolation)."""
    if not isinstance(period, str):
        raise ValueError('period must be text')
    if frequency == 'annual' and re.fullmatch(r'\d{4}', period):
        year = int(period)
        if 1900 <= year <= date.today().year:
            return year
    elif frequency == 'monthly' and re.fullmatch(r'\d{4}-\d{2}', period):
        year, month = map(int, period.split('-'))
        d = date(year, month, 1)
        if year >= 1900 and d <= date.today():
            return year * 12 + month
    raise ValueError('invalid or future period')


def load_life(data_dir=None):
    base = Path(data_dir or LIFE_DIR)
    registry = json.loads((base / 'sources.json').read_text())
    cities = [json.loads(p.read_text()) for p in sorted((base / 'series').glob('*.json'))]
    return registry, cities


def validate_records(registry, cities):
    errors = []
    def check(condition, message):
        if not condition:
            errors.append(message)
    if not isinstance(registry, dict) or not isinstance(registry.get('sources'), list):
        return ['life sources: expected registry object and sources list']
    check(registry.get('schema_version') == 1, 'life sources: unsupported schema_version')
    sources = {}
    for s in registry['sources']:
        if not isinstance(s, dict):
            errors.append('life source: expected object'); continue
        sid = s.get('id')
        if not isinstance(sid, str) or not sid:
            errors.append('life source: missing id'); continue
        check(sid not in sources, f'{sid}: duplicate source')
        sources[sid] = s
        for k in ('title', 'publisher', 'attribution', 'publication_basis', 'access_method'):
            check(isinstance(s.get(k), str) and bool(s[k].strip()), f'{sid}: missing {k}')
        check(gov_url(s.get('url')), f'{sid}: source URL not approved gov.cn HTTPS')
        check(s.get('license_url') is None or gov_url(s['license_url']), f'{sid}: invalid license URL')
        check(s.get('redistribution') in {'fact_extract', 'link_only'}, f'{sid}: invalid redistribution')
        check(s.get('bulk_redistribution') is False, f'{sid}: bulk redistribution not supported')
        check(s.get('review_status') in STATUSES, f'{sid}: invalid review status')
        for k in ('retrieved_at', 'verified_at'):
            check(valid_date(s.get(k)), f'{sid}: invalid {k}')
        check(s.get('published_at') is None or valid_date(s['published_at']), f'{sid}: invalid published_at')
        try:
            due = date.fromisoformat(s.get('review_due', ''))
            check(due >= date.fromisoformat(s['verified_at']), f'{sid}: review due precedes verification')
        except (ValueError, TypeError, KeyError):
            errors.append(f'{sid}: invalid review_due')
        if s.get('redistribution') == 'fact_extract':
            check(bool(s.get('license_url')), f'{sid}: fact extract needs reviewed terms URL')
    if not isinstance(cities, list):
        return errors + ['life cities: expected list']
    city_ids = set()
    for city in cities:
        if not isinstance(city, dict):
            errors.append('life city: expected object'); continue
        cid = city.get('city_id')
        if not isinstance(cid, str) or not cid:
            errors.append('life city: missing city_id'); continue
        check(cid not in city_ids, f'{cid}: duplicate city'); city_ids.add(cid)
        check(city.get('schema_version') == 1, f'{cid}: unsupported schema_version')
        check(city.get('coverage') == 'pilot', f'{cid}: invalid coverage')
        series_list = city.get('series')
        if not isinstance(series_list, list):
            errors.append(f'{cid}: series must be list'); continue
        mids = set()
        for series in series_list:
            if not isinstance(series, dict):
                errors.append(f'{cid}: series must be object'); continue
            mid = series.get('id')
            if not isinstance(mid, str):
                errors.append(f'{cid}: series missing id'); continue
            label = f'{cid}/{mid}'
            check(mid in METRICS and mid not in mids, f'{label}: unknown or duplicate metric'); mids.add(mid)
            freq = series.get('frequency')
            check(freq in {'annual', 'monthly'}, f'{label}: invalid frequency')
            check(bool(series.get('notes')), f'{label}: missing notes')
            points = series.get('points')
            if not isinstance(points, list) or not points:
                errors.append(f'{label}: nonempty points required'); continue
            previous = None
            semantics = None
            ids = set()
            for p in points:
                if not isinstance(p, dict):
                    errors.append(f'{label}: point must be object'); continue
                check(REQUIRED <= p.keys(), f'{label}: missing required record fields')
                check(p.keys() <= RECORD_KEYS, f'{label}: unsupported record fields (possible hidden values)')
                check(isinstance(p.get('id'), str) and p['id'] not in ids, f'{label}: invalid/duplicate point id')
                if isinstance(p.get('id'), str): ids.add(p['id'])
                for k in ('label', 'population_scope', 'geographic_scope', 'comparability_key', 'unit'):
                    check(isinstance(p.get(k), str) and bool(p[k].strip()), f'{label}: missing {k}')
                check(p.get('metric') == mid, f'{label}: metric mismatch')
                check(p.get('unit') == series.get('unit'), f'{label}: mixed units')
                check(p.get('comparability_key') == series.get('comparability_key') or bool(p.get('break_reason')), f'{label}: comparability mismatch requires break_reason')
                check(valid_date(p.get('verified_at')), f'{label}: invalid verified_at')
                check(p.get('review_status') in STATUSES, f'{label}: invalid review status')
                try:
                    ordinal = period_number(p.get('period'), freq)
                    check(previous is None or ordinal == previous + 1, f'{label}: periods must increase without unmarked gaps; add null points')
                    previous = ordinal
                except (ValueError, TypeError): errors.append(f'{label}: invalid period')
                # Actual semantics, not just an author-supplied opaque key, must match.
                signature = {k: p.get(k) for k in (RECORD_KEYS - REQUIRED | {'unit', 'population_scope', 'geographic_scope', 'statistic'}) - {'break_reason', 'evidence_locator'}}
                if semantics is not None:
                    check(signature == semantics or bool(p.get('break_reason')), f'{label}: incompatible statistical definitions need explicit break')
                semantics = signature
                val = p.get('value'); sid = p.get('source_id')
                check(sid is None or isinstance(sid, str) and sid in sources, f'{label}: unknown source')
                src = sources.get(sid, {}) if isinstance(sid, str) else {}
                if val is None:
                    check(isinstance(p.get('missing_reason'), str) and bool(p['missing_reason'].strip()), f'{label}: null needs reason')
                    check(p.get('review_status') != 'verified', f'{label}: null cannot be verified observation')
                else:
                    check(type(val) in (int, float) and math.isfinite(val) and val >= 0, f'{label}: invalid numeric value')
                    check(p.get('missing_reason') is None, f'{label}: number cannot have missing reason')
                    check(bool(p.get('evidence_locator')), f'{label}: numeric fact needs evidence locator')
                    check(p.get('review_status') == 'verified', f'{label}: nonverified value must be null')
                    check(src.get('redistribution') == 'fact_extract', f'{label}: restricted source value must be null even in repository')
                    check(src.get('review_status') == 'verified', f'{label}: source must be verified')
                if mid.startswith('housing_'):
                    check(p.get('statistic') == 'index' and p.get('price_basis') == 'index' and p.get('comparison') == 'year_on_year' and p.get('unit') == '上年同月=100' and p.get('market_segment') == 'new' and p.get('base_period') == '2025' and freq == 'monthly', f'{label}: invalid housing index definition')
                elif mid.endswith('_mean'):
                    check(p.get('statistic') == 'mean' and p.get('gross_or_net') == 'gross' and p.get('annual_or_monthly') == 'annual' and p.get('unit') == '元/年' and freq == 'annual', f'{label}: wage must be annual gross mean')
                    check(p.get('unit_ownership') == ('nonprivate' if 'nonprivate' in mid else 'private'), f'{label}: wrong wage population')
                elif mid == 'wage_median':
                    check(p.get('statistic') == 'median', f'{label}: median cannot be mean')
                elif mid == 'life_expectancy':
                    check(p.get('statistic') == 'life_expectancy_at_birth' and p.get('age') == 0 and p.get('sex') == 'all' and p.get('unit') == '岁', f'{label}: invalid life expectancy definition')
        check(mids == METRICS, f'{cid}: all five availability cards required')
    return errors


def validate_life(data_dir=None):
    try:
        return validate_records(*load_life(data_dir))
    except (OSError, ValueError, TypeError) as exc:
        return [f'life: cannot read inputs: {exc}']


def publish_point(point, sources, as_of=None):
    """Defense in depth: never leak unapproved/stale values into a build."""
    p = deepcopy(point)
    source = sources.get(p.get('source_id'), {})
    if p.get('value') is not None:
        if source.get('redistribution') != 'fact_extract' or source.get('review_status') != 'verified' or p.get('review_status') != 'verified':
            p.update(value=None, review_status='restricted', missing_reason='来源或记录未获公开数值资格，暂仅提供官方入口。')
        elif date.fromisoformat(source['review_due']) < (as_of or date.today()):
            p.update(value=None, review_status='stale', missing_reason='已超过复核期限，复核前暂不展示数值。')
    p['source_url'] = source.get('url')
    p['source_title'] = source.get('title')
    p['attribution'] = source.get('attribution')
    return p


def build_life(city_ids, data_dir=None):
    registry, cities = load_life(data_dir)
    errors = validate_records(registry, cities)
    if errors:
        raise ValueError('\n'.join(errors))
    sources = {s['id']: s for s in registry['sources']}
    available = {c['city_id']: c for c in cities}
    result = {}
    for cid in city_ids:
        if cid not in available:
            result[cid] = {'schema_version': 1, 'coverage': 'not_covered', 'overview': [], 'series': [], 'sources': [], 'missing_reason': '尚未纳入生活数据试点，缺失不代表0。'}
            continue
        c = deepcopy(available[cid]); c['overview'] = []; used = set()
        for s in c['series']:
            s['points'] = [publish_point(p, sources) for p in s['points']]
            c['overview'].append(deepcopy(s['points'][-1]))
            used.update(p['source_id'] for p in s['points'] if p['source_id'])
            s['coverage_start'] = s['points'][0]['period']
            s['coverage_end'] = s['points'][-1]['period']
            s['verified_points'] = sum(p['value'] is not None for p in s['points'])
        c['sources'] = [deepcopy(sources[sid]) for sid in sorted(used)]
        result[cid] = c
    return result
