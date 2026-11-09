"""Synthetic metadata tests. Fixture values are not published observations."""
from copy import deepcopy
from datetime import date
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from resident_statistics import comparison_key, validate_metadata
from common import city_files, load_yaml, dimension_status
import build


class ResidentStatisticsTests(unittest.TestCase):
    def setUp(self):
        self.living = {'income_per_capita': 123, 'stats_year': 2025,
                       'statistical_metadata': {'income_per_capita': {
            'source_value': 123, 'period': '2025', 'unit': '元/年', 'statistic': 'mean',
            'price_basis': 'nominal', 'population_scope': '虚构城镇常住居民',
            'population_scope_type': 'urban_residents', 'geographic_scope': '虚构测试市',
            'geographic_scope_type': 'city_administrative_area',
            'methodology_key': 'household_income_expenditure_survey',
            'methodology_source_url': 'https://example.gov.cn/method',
            'methodology_note': '虚构测试定义，不是城市事实',
            'cross_city_comparability_key': comparison_key('income_per_capita', 'urban_residents'),
            'source_url': 'https://example.gov.cn/statistics', 'source_date': '2026-03-01',
            'publisher': '虚构测试机构', 'verified_at': '2026-11-09',
            'review_due': '2027-02-09', 'review_status': 'verified',
            'evidence_locator': '虚构测试位置', 'data_status': 'preliminary'}}}

    def errors(self):
        return validate_metadata(self.living, on=date(2026, 11, 9))

    def test_absent_metadata_is_unknown_not_an_inferred_scope(self):
        self.assertEqual(validate_metadata({'income_per_capita': 123}), [])
        self.assertEqual(self.errors(), [])

    def test_all_real_metadata_is_valid(self):
        for path in city_files():
            self.assertEqual(validate_metadata(load_yaml(path)['living']), [], path.stem)

    def test_original_value_binding_and_zero(self):
        self.living['income_per_capita'] = 999
        self.assertTrue(self.errors())
        self.living['income_per_capita'] = 0
        self.living['statistical_metadata']['income_per_capita']['source_value'] = 0
        self.assertEqual(self.errors(), [])
        for v in (True, '0', float('nan'), float('inf'), -1, 10**400):
            self.living['statistical_metadata']['income_per_capita']['source_value'] = v
            self.assertTrue(self.errors())

    def test_required_fields_and_exact_semantics(self):
        original = deepcopy(self.living)
        for field, value in [('period', '2024'), ('period', 2025), ('unit', '元/月'),
                             ('statistic', 'median'), ('price_basis', 'real'),
                             ('population_scope_type', 'hukou'), ('population_scope_type', []),
                             ('geographic_scope_type', 'urban_core'),
                             ('methodology_key', 'recruitment_quote'),
                             ('cross_city_comparability_key', 'everything')]:
            self.living = deepcopy(original)
            self.living['statistical_metadata']['income_per_capita'][field] = value
            self.assertTrue(self.errors(), field)
        self.living = deepcopy(original)
        del self.living['statistical_metadata']['income_per_capita']['publisher']
        self.assertTrue(self.errors())

    def test_every_required_field_and_unknown_fields(self):
        original = deepcopy(self.living)
        for field in original['statistical_metadata']['income_per_capita']:
            self.living = deepcopy(original)
            del self.living['statistical_metadata']['income_per_capita'][field]
            self.assertTrue(self.errors(), field)
        self.living = deepcopy(original)
        self.living['statistical_metadata']['income_per_capita']['can_compare'] = True
        self.assertTrue(self.errors())

    def test_status_types_and_date_order(self):
        original = deepcopy(self.living)
        for key, value in [('review_status', []), ('review_status', 'approved'),
                           ('data_status', {}), ('data_status', 'official'),
                           ('source_date', '2026-11-10'), ('review_due', '2026-11-08')]:
            self.living = deepcopy(original)
            self.living['statistical_metadata']['income_per_capita'][key] = value
            self.assertTrue(self.errors(), key)

    def test_population_and_indicator_cannot_share_a_false_key(self):
        m = self.living['statistical_metadata']['income_per_capita']
        m['population_scope_type'] = 'all_residents'
        self.assertTrue(self.errors())
        m['cross_city_comparability_key'] = comparison_key('income_per_capita', 'all_residents')
        self.assertEqual(self.errors(), [])
        self.assertNotEqual(comparison_key('income_per_capita', 'all_residents'),
                            comparison_key('consumption_per_capita', 'all_residents'))

    def test_dates_and_official_sources(self):
        m = self.living['statistical_metadata']['income_per_capita']
        for value in ('https://gov.cn.evil.test/', 'https://example.gov.cn:999/',
                      'https://x@example.gov.cn/', 'javascript:alert(1)', None):
            m['source_url'] = value
            self.assertTrue(self.errors())
        m['source_url'] = 'http://example.gov.cn/statistics'
        self.assertEqual(self.errors(), [])
        for value in ('2026-02-30', '2026-11-10', 'bad'):
            m['verified_at'] = value
            self.assertTrue(self.errors())
        m['verified_at'] = '2026-11-09'
        # Expiry is not an invalid historical record; frontend must gate at runtime.
        self.assertEqual(validate_metadata(self.living, on=date(2027, 2, 10)), [])

    def test_metadata_does_not_override_legacy_quality_flags(self):
        self.living.update(needs_human=True, needs_human_fields=['income_per_capita'])
        self.assertTrue(self.errors())
        self.living['needs_human_fields'] = ['consumption_per_capita']
        self.assertEqual(self.errors(), [])
        self.living['access_blocked'] = True
        self.assertTrue(self.errors())

    def test_malformed_legacy_flags_fail_without_crashing(self):
        for flags in (True, 'income_per_capita', [True], [[]]):
            self.living.update(needs_human=True, needs_human_fields=flags)
            self.assertTrue(self.errors())
        self.living.update(needs_human=False, needs_human_fields=['income_per_capita'])
        self.assertTrue(self.errors())

    def test_metadata_does_not_change_index_or_floor(self):
        for path in city_files():
            city = load_yaml(path)
            city['status'] = dimension_status(city)
            city['by_degree'] = build.summarize(city)
            before = (build.index_inputs(city), build.freelance_floor(city))
            city['living'].pop('statistical_metadata', None)
            self.assertEqual(before, (build.index_inputs(city), build.freelance_floor(city)))


if __name__ == '__main__':
    unittest.main()
