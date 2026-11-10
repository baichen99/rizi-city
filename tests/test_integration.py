"""Cross-layer regressions; fictitious fixture values are not city observations."""
import argparse
import copy
import importlib.util
import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import build
from common import city_files, dimension_status, load_yaml

spec = importlib.util.spec_from_file_location('rizi_query', ROOT / 'skill/rizi-city/scripts/query.py')
query = importlib.util.module_from_spec(spec)
spec.loader.exec_module(query)


class LegacyRegressionTests(unittest.TestCase):
    def test_life_layer_does_not_change_old_calculations(self):
        for path in city_files():
            with self.subTest(city=path.stem):
                city = load_yaml(path)
                city['status'] = dimension_status(city)
                city['by_degree'] = build.summarize(city)
                before = (build.summarize(city), build.index_inputs(city), build.freelance_floor(city))
                augmented = copy.deepcopy(city)
                augmented['life'] = {'overview': [{'value': 999999}], 'modules': []}
                after = (build.summarize(augmented), build.index_inputs(augmented), build.freelance_floor(augmented))
                self.assertEqual(before, after)

    def test_built_payload_life_same_latest_and_history(self):
        from life_data import build_life
        result = build_life([p.stem for p in city_files()])
        self.assertEqual(len(result), 20)
        for life in result.values():
            self.assertEqual(life['schema_version'], 1)
            for r in life.get('overview', []):
                if r.get('value') is not None:
                    points = [p for s in life['series'] for p in s['points']]
                    self.assertTrue(any(p.get('id') == r.get('id') and
                                        p.get('value') == r['value'] for p in points))

    def test_pilot_ids_and_initial_fact_changelog(self):
        from life_data import load_life
        registry, pilots = load_life()
        known = {p.stem for p in city_files()}
        entries = json.loads((ROOT / 'data/life/changelog.json').read_text())
        for city in pilots:
            self.assertIn(city['city_id'], known)
            for series in city['series']:
                for record in series['points']:
                    if record['value'] is not None:
                        self.assertTrue(any(e['record_id'] == record['id'] and
                                            e['new'] == record['value'] and e['basis']
                                            for e in entries), record['id'])


class ResidentCliTests(unittest.TestCase):
    def setUp(self):
        self.record = {'id': 'fictional', 'metric': 'wage_median', 'label': '工资中位数',
                       'value': None, 'unit': '元/年', 'period': '2025',
                       'population_scope': '虚构测试人群', 'geographic_scope': '虚构测试区域',
                       'source_id': 'test', 'review_status': 'missing', 'missing_reason': '未公开'}
        self.data = {'cities': [{'id': 'fixture', 'city': '测试市', 'life': {
            'overview': [self.record], 'series': [{'id': 's', 'label': '工资中位数',
            'unit': '元/年', 'points': [self.record]}],
            'sources': [{'id': 'test', 'url': 'https://example.gov.cn/test',
                         'title': '虚构测试来源', 'verified_at': '2026-01-01'}]}}]}

    def capture(self, function, args):
        out = io.StringIO()
        with redirect_stdout(out):
            function(self.data, args)
        return out.getvalue()

    def test_overview_missing_is_not_zero(self):
        result = self.capture(query.cmd_overview, argparse.Namespace(names=['测试']))
        self.assertIn('未公开', result)
        self.assertNotIn('0 元/年', result)
        self.assertIn('https://example.gov.cn/test', result)
        self.assertIn('资料期：2025', result)
        self.assertIn('不是元/㎡房价', result)

    def test_history_filter_and_zero_preserved(self):
        self.record['value'] = 0
        result = self.capture(query.cmd_history, argparse.Namespace(name='测试', metric='wage_median'))
        self.assertIn('0 元/年', result)
        self.assertIn('缺失不补零', result)
        result = self.capture(query.cmd_history, argparse.Namespace(name='测试', metric='unknown'))
        self.assertIn('未找到', result)

    def test_module_expiry_is_not_hidden_by_summary(self):
        self.data['cities'][0]['life']['modules'] = [{
            'title': '测试导航', 'summary': '摘要仍存在', 'status': 'expired',
            'reason': '依据已失效，请先核对替代文件', 'links': []}]
        result = self.capture(query.cmd_overview, argparse.Namespace(names=['测试']))
        self.assertIn('已过期', result)
        self.assertIn('依据已失效', result)

    def test_downloaded_json_rechecks_source_deadline(self):
        self.record['value'] = 12345
        self.data['cities'][0]['life']['sources'][0]['review_due'] = '2000-01-01'
        result = self.capture(query.cmd_overview, argparse.Namespace(names=['测试']))
        self.assertIn('超过来源复核期限', result)
        self.assertNotIn('12,345', result)


if __name__ == '__main__':
    unittest.main()
