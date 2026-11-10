"""Verified semantics for existing resident income/consumption values.

This optional layer never guesses scope or changes legacy index inputs.
"""
from datetime import date
import math
import re
from urllib.parse import urlparse

FIELDS = {'income_per_capita', 'consumption_per_capita'}
POPULATIONS = {'all_residents', 'urban_residents', 'rural_residents'}
REQUIRED = {'source_value', 'period', 'unit', 'statistic', 'price_basis',
            'population_scope', 'population_scope_type', 'geographic_scope',
            'geographic_scope_type', 'methodology_key', 'methodology_source_url',
            'methodology_note', 'cross_city_comparability_key', 'source_url',
            'source_date', 'publisher', 'verified_at', 'review_due', 'review_status',
            'evidence_locator', 'data_status'}


def comparison_key(field, population):
    return (f'resident-statistics|{field}|{population}|city_administrative_area|'
            'CNY-person-year|household-survey')


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _official_url(value):
    try:
        p = urlparse(value)
        return (isinstance(value, str) and p.scheme in ('http', 'https')
                and (p.hostname or '').endswith('.gov.cn') and not p.username
                and not p.password and p.port in ((None, 443) if p.scheme == 'https' else (None, 80)))
    except (ValueError, TypeError, AttributeError):
        return False


def validate_metadata(living, *, on=None):
    """Return errors; absence remains unknown, expiry is a runtime downgrade."""
    if not isinstance(living, dict):
        return ['living must be a mapping']
    metadata = living.get('statistical_metadata')
    if metadata is None:
        return []
    if not isinstance(metadata, dict):
        return ['statistical_metadata must be a mapping']
    errors = []
    raw_flags = living.get('needs_human_fields')
    flags = [] if raw_flags is None else raw_flags
    if not isinstance(flags, list) or any(not isinstance(f, str) or f not in FIELDS | {'rent_avg_per_sqm'} for f in flags):
        errors.append('needs_human_fields must be a list of known living fields')
        flags = []
    if flags and living.get('needs_human') is not True:
        errors.append('needs_human_fields requires needs_human=true')
    today = on or date.today()
    for field, m in metadata.items():
        def check(condition, message):
            if not condition:
                errors.append(f'{field}: {message}')
        if field not in FIELDS or not isinstance(m, dict):
            errors.append(f'{field}: unknown field or non-mapping metadata')
            continue
        check(REQUIRED == m.keys(), 'incomplete or unknown metadata fields')
        v = m.get('source_value')
        # Bound conversion before isfinite: arbitrarily large Python ints overflow.
        check(type(v) in (int, float) and 0 <= v <= 9007199254740991 and math.isfinite(v),
              'source_value must be a finite nonnegative number')
        check(type(living.get(field)) in (int, float) and v == living.get(field),
              'source_value must equal the unchanged living value')
        check(isinstance(m.get('period'), str) and bool(re.fullmatch(r'\d{4}', m['period']))
              and m['period'] == str(living.get('stats_year'))
              and 1900 <= int(m['period']) <= today.year, 'period must match stats_year')
        for key, expected in {'unit': '元/年', 'statistic': 'mean', 'price_basis': 'nominal',
                              'geographic_scope_type': 'city_administrative_area',
                              'methodology_key': 'household_income_expenditure_survey'}.items():
            check(m.get(key) == expected, f'unsupported {key}')
        population = m.get('population_scope_type')
        check(isinstance(population, str) and population in POPULATIONS, 'unsupported population_scope_type')
        check(m.get('cross_city_comparability_key') == comparison_key(field, population),
              'comparison key does not match the verified indicator and population')
        for key in ('population_scope', 'geographic_scope', 'methodology_note',
                    'publisher', 'evidence_locator'):
            check(isinstance(m.get(key), str) and bool(m[key].strip()), f'missing {key}')
        for key in ('source_url', 'methodology_source_url'):
            check(_official_url(m.get(key)), f'{key} must be an official HTTP(S) URL')
        check(isinstance(m.get('review_status'), str) and m['review_status'] in {'verified', 'needs_review', 'stale'},
              'invalid review_status')
        check(isinstance(m.get('data_status'), str) and m['data_status'] in {'preliminary', 'final', 'not_specified'},
              'invalid data_status')
        dates = {k: _date(m.get(k)) for k in ('source_date', 'verified_at', 'review_due')}
        check(all(dates.values()), 'invalid metadata dates')
        if all(dates.values()):
            check(dates['source_date'] <= dates['verified_at'] <= today,
                  'publication/verification dates are out of order or future')
            check(dates['review_due'] >= dates['verified_at'], 'review_due precedes verification')
        if m.get('review_status') == 'verified':
            flagged = living.get('needs_human') and (not flags or field in flags)
            check(not living.get('access_blocked') and not flagged,
                  'verified metadata cannot override a blocked/unverified legacy value')
    return errors
