"""Tests use synthetic edits only; do not write fabricated data to publication inputs."""
from copy import deepcopy
from datetime import date
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from life_data import build_life, load_life, publish_point, validate_life, validate_records


class LifeDataTests(unittest.TestCase):
    def setUp(self):
        self.registry, self.cities = load_life()
        self.point = self.cities[0]['series'][0]['points'][0]

    def errors(self):
        return validate_records(self.registry, self.cities)

    def test_repository_valid(self):
        self.assertEqual(validate_life(), [])

    def test_beijing_life_history_keeps_recent_gaps_and_no_cross_city_key(self):
        city = build_life(['beijing'])['beijing']
        series = next(s for s in city['series'] if s['id'] == 'life_expectancy')
        self.assertEqual([p['period'] for p in series['points']], [str(y) for y in range(2020, 2026)])
        self.assertEqual([p['value'] for p in series['points']], [82.43, 82.47, None, None, None, None])
        self.assertTrue(all('户籍' in p['population_scope'] and p['age'] == 0 and p['sex'] == 'all' for p in series['points']))
        self.assertTrue(all(not p.get('cross_city_comparability_key') for p in series['points']))
        latest = next(p for p in city['overview'] if p['metric'] == 'life_expectancy')
        self.assertEqual(latest['period'], '2025')
        self.assertIsNone(latest['value'])

    def test_zero_is_not_null(self):
        self.point['value'] = 0  # Synthetic boundary observation only.
        self.assertEqual(self.errors(), [])
        src = {s['id']: s for s in self.registry['sources']}
        self.assertEqual(publish_point(self.point, src, date(2026, 11, 9))['value'], 0)
        self.point['value'] = None
        self.assertTrue(self.errors())

    def test_nan_infinity_bool_string_negative_rejected(self):
        for value in [float('nan'), float('inf'), True, '1', -1]:
            with self.subTest(value=value):
                self.point['value'] = value
                self.assertTrue(self.errors())

    def test_dates_and_periods(self):
        for value in ['2026-13', '2026-2', '2100-01', 'garbage', None]:
            self.point['period'] = value
            self.assertTrue(self.errors())
        self.point['period'] = '2026-06'
        for value in ['2026-02-30', '2099-01-01', None]:
            self.point['verified_at'] = value
            self.assertTrue(self.errors())

    def test_invalid_sources(self):
        for url in ['https://evil.gov.cn.example.org/a', 'https://gov.cn@evil.com/', 'javascript:alert(1)', 'http://www.stats.gov.cn/a', 'https://www.stats.gov.cn:999/a']:
            self.registry['sources'][0]['url'] = url
            self.assertTrue(self.errors())

    def test_missing_source(self):
        self.point['source_id'] = 'unknown'
        self.assertTrue(self.errors())

    def test_restricted_raw_numbers_rejected_and_publication_suppressed(self):
        source = next(s for s in self.registry['sources'] if s['id'] == self.point['source_id'])
        source['redistribution'] = 'link_only'
        self.assertTrue(self.errors())
        result = publish_point(self.point, {source['id']: source})
        self.assertIsNone(result['value'])
        self.assertEqual(result['review_status'], 'restricted')
        self.point['raw_value'] = 999  # No hidden field loophole.
        self.assertTrue(any('unsupported record' in e for e in self.errors()))

    def test_stale_source_is_suppressed(self):
        sources = {s['id']: s for s in self.registry['sources']}
        result = publish_point(self.point, sources, date(2030, 1, 1))
        self.assertIsNone(result['value'])
        self.assertEqual(result['review_status'], 'stale')

    def test_missing_period_requires_explicit_gap(self):
        points = self.cities[0]['series'][0]['points']
        # Keep this a missing-data fixture even after real observations are filled.
        points[2].update(value=None, source_id=None, review_status='missing',
                         missing_reason='虚构测试缺口', evidence_locator=None)
        self.assertIsNone(points[2]['value'])
        points.pop(2)
        self.assertTrue(any('unmarked gaps' in e for e in self.errors()))

    def test_units_and_populations_do_not_silently_mix(self):
        p = self.cities[0]['series'][0]['points'][1]
        p['population_scope'] = 'synthetic different population'
        self.assertTrue(any('incompatible' in e for e in self.errors()))
        p['unit'] = '元/㎡'
        self.assertTrue(any('mixed units' in e for e in self.errors()))

    def test_declared_wage_break(self):
        gz = next(c for c in self.cities if c['city_id'] == 'guangzhou')
        p = gz['series'][1]['points'][1]
        self.assertIn('5人及以上', p['population_scope'])
        self.assertNotEqual(p['comparability_key'], gz['series'][1]['comparability_key'])
        del p['break_reason']
        self.assertTrue(self.errors())

    def test_overview_is_exact_latest_and_unknown_city_empty(self):
        result = build_life(['guangzhou', 'uncovered'])
        for series, latest in zip(result['guangzhou']['series'], result['guangzhou']['overview']):
            self.assertEqual(series['points'][-1], latest)
            self.assertIsNot(series['points'][-1], latest)
        self.assertEqual(result['uncovered']['coverage'], 'not_covered')
        self.assertEqual(result['uncovered']['overview'], [])

    def test_same_method_housing_comparable_not_same_actual_geography(self):
        data = build_life(['beijing', 'shanghai'])
        a,b = (data[x]['overview'][0] for x in ['beijing', 'shanghai'])
        self.assertNotEqual(a['geographic_scope'], b['geographic_scope'])
        self.assertEqual(a['cross_city_comparability_key'], b['cross_city_comparability_key'])
        self.assertEqual(a['geographic_scope_type'], b['geographic_scope_type'])

    def test_no_restricted_values_in_checked_in_inputs(self):
        sources={s['id']:s for s in self.registry['sources']}
        for c in self.cities:
            for series in c['series']:
                for p in series['points']:
                    if sources.get(p['source_id'], {}).get('redistribution') != 'fact_extract':
                        self.assertIsNone(p['value'])


if __name__ == '__main__':
    unittest.main()
