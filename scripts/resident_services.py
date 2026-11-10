"""National official navigation only, never a local policy or eligibility claim."""
import datetime as dt
import json
from pathlib import Path
from urllib.parse import urlsplit

DATA_FILE = Path(__file__).resolve().parents[1] / 'data/resident-services.json'
NEEDS = {'benefits', 'housing', 'work', 'utilities', 'family', 'elder', 'health'}


def build_resident_services(path=DATA_FILE):
    rows = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(rows, list):
        raise ValueError('resident services must be a list')
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('resident service must be an object')
        for field in ('id', 'title', 'publisher', 'summary', 'audience', 'coverage',
                      'reference_period', 'verification_scope', 'evidence_locator'):
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise ValueError(f'resident service requires {field}')
        if row['id'] in seen:
            raise ValueError('duplicate resident service id')
        seen.add(row['id'])
        if row.get('kind') != 'national_navigation' or row.get('status') != 'link_only' or row.get('redistribution_status') != 'link_only':
            raise ValueError('resident services support link-only national navigation')
        if not isinstance(row.get('needs'), list) or not row['needs'] or not set(row['needs']) <= NEEDS:
            raise ValueError('unknown resident service need')
        u = urlsplit(row.get('url', ''))
        if u.scheme != 'https' or not (u.hostname == 'gov.cn' or (u.hostname or '').endswith('.gov.cn')) or u.username or u.password or u.port:
            raise ValueError('resident service must link to an HTTPS official government source')
        for field in ('verified_at', 'next_review_at'):
            value = row.get(field)
            if not isinstance(value, str) or dt.date.fromisoformat(value).isoformat() != value:
                raise ValueError(f'invalid {field}')
        if row['next_review_at'] < row['verified_at']:
            raise ValueError('review date precedes verification')
        if row.get('source_date') is not None:
            if dt.date.fromisoformat(row['source_date']).isoformat() != row['source_date'] or row['source_date'] > row['verified_at']:
                raise ValueError('invalid publication date')
        if any(key in row for key in ('amount', 'eligible', 'calculator_enabled', 'effective_from', 'effective_to')):
            raise ValueError('navigation cannot invent policy amounts, eligibility or validity')
    return rows


def validate_resident_services():
    try:
        build_resident_services()
    except (ValueError, TypeError, KeyError, OSError) as error:
        return [f'resident services: {error}']
    return []
