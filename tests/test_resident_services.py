"""New navigation is link-only and cannot silently become a local policy dataset."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from resident_services import build_resident_services, DATA_FILE, validate_resident_services


class ResidentServiceTests(unittest.TestCase):
    def check_invalid(self, patch):
        rows = copy.deepcopy(build_resident_services())
        rows[0].update(patch)
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'services.json'
            p.write_text(json.dumps(rows))
            with self.assertRaises((ValueError, TypeError)):
                build_resident_services(p)

    def test_real_entries_have_explicit_scope_and_source(self):
        self.assertEqual(validate_resident_services(), [])
        rows = build_resident_services()
        self.assertEqual(len(rows), 4)
        self.assertEqual({r['kind'] for r in rows}, {'national_navigation'})
        self.assertTrue(all(r['status'] == 'link_only' and r['source_date'] is None for r in rows))
        self.assertIn('2025', next(r for r in rows if r['id'] == 'national-health')['reference_period'])

    def test_rejects_non_government_and_unsafe_links(self):
        for url in ('https://gov.cn.evil.test/', 'javascript:alert(1)', 'http://www.gov.cn/', 'https://user:pass@www.gov.cn/', 'https://www.gov.cn:8080/'):
            self.check_invalid({'url': url})

    def test_rejects_invented_policy_and_invalid_review_dates(self):
        for patch in ({'amount': 1000}, {'effective_to': '2030-01-01'}, {'eligible': True}, {'status': 'verified'}, {'kind': 'local_policy'}, {'needs': ['unknown']}, {'verified_at': '2026-02-30'}, {'next_review_at': '2025-01-01'}, {'source_date': '2027-01-01'}, {'coverage': ''}):
            self.check_invalid(patch)

    def test_generated_payload_retains_navigation_evidence(self):
        data = json.loads((DATA_FILE.parents[1] / 'site/data/cities.json').read_text())
        self.assertEqual(data['resident_services'], build_resident_services())


if __name__ == '__main__':
    unittest.main()
