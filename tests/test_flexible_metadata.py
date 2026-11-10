"""Optional pension scope/evidence metadata remains backwards compatible."""
import copy
import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from common import load_yaml
from validate import Report, check_flexible

class FlexibleMetadataTests(unittest.TestCase):
    def setUp(self):
        self.fe = copy.deepcopy(load_yaml(ROOT / 'data/cities/shenzhen.yaml')['flexible_employment'])

    def errors(self):
        report = Report('fixture')
        check_flexible(report, self.fe)
        return report.errors

    def test_valid_and_optional(self):
        self.assertEqual(self.errors(), [])
        self.fe.pop('pension_note', None)
        self.fe.pop('pension_base_source_url', None)
        self.assertEqual(self.errors(), [])

    def test_note_is_plain_text(self):
        self.fe['pension_note'] = {'unexpected': 'mapping'}
        self.assertTrue(any('pension_note' in e for e in self.errors()))

    def test_base_source_is_official(self):
        for source in ('https://example.com/gov.cn', 'javascript://example.gov.cn/alert(1)', 123):
            with self.subTest(source=source):
                self.fe['pension_base_source_url'] = source
                self.assertTrue(any('pension_base_source_url' in e for e in self.errors()))
