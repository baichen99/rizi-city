"""Keep Chengdu's differently scoped entrepreneurship policies separate."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from common import load_yaml


class ChengduEntrepreneurshipTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policies = {s['name']: s for s in load_yaml(ROOT / 'data/cities/chengdu.yaml')['subsidies']}

    def test_distinct_expiry_rules(self):
        staged = self.policies['一次性创业补贴（分段补贴）']
        additional = self.policies['一次性创业补贴（新政补贴）']
        self.assertEqual(str(staged['valid_until']), '2027-12-31')
        self.assertIsNone(additional['valid_until'])
        self.assertIn('相关新文件出台', additional['deadline_rule'])
        self.assertIn('36 个月', ' '.join(additional['conditions']))

    def test_employment_conditions_are_preserved(self):
        for name in ('一次性创业补贴（分段补贴）', '一次性创业补贴（新政补贴）'):
            with self.subTest(name=name):
                conditions = ' '.join(self.policies[name]['conditions'])
                self.assertIn('1 年以上劳动合同', conditions)
                self.assertIn('连续实缴社会保险 3 个月及以上', conditions)

    def test_discretionary_award_is_not_verified_chengdu_entitlement(self):
        contest = self.policies['国家级创新创业大赛落地补贴']
        self.assertTrue(contest['needs_human'])
        self.assertIn('有条件的地方可给予', contest['amount'])
        self.assertIn('尚未核实成都市', contest['needs_human_reason'])
        self.assertNotIn('成都市执行', contest['policy_name'])

    def test_entrepreneurship_does_not_add_graduate_cash_totals(self):
        for policy in self.policies.values():
            if policy['type'] == 'entrepreneurship':
                self.assertTrue(all(value is None for value in policy['amount_by_degree'].values()))
