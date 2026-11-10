import copy
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from life_modules import DATA_DIR, build_modules, fictional_annual_tier_charge, validate_modules


class NavigationTests(unittest.TestCase):
    def test_real_cards_never_enable_bill_calculators(self):
        self.assertEqual(validate_modules(), [])
        cards = build_modules(['beijing', 'shanghai', 'guangzhou', 'unknown'], on=dt.date(2026, 11, 9))
        self.assertEqual(cards['unknown'], [])
        for city in ('beijing', 'shanghai', 'guangzhou'):
            self.assertEqual({x['id'] for x in cards[city]}, {'water','power','gas','heating','climate','healthcare'})
            self.assertTrue(all(not x['calculator_enabled'] and not x['usable'] for x in cards[city]))

    def test_guangzhou_navigation_preserves_scope_and_effective_date(self):
        cards = {r['id']: r for r in build_modules(['guangzhou'], on=dt.date(2026, 11, 10))['guangzhou']}
        self.assertEqual(cards['water']['effective_from'], '2025-06-01')
        self.assertIsNone(cards['water']['effective_to'])
        self.assertIn('五年', cards['water']['reference_period'])
        self.assertIn('次月', cards['water']['summary'])
        self.assertEqual(len(cards['water']['links']), 2)
        self.assertIn('广州东部发展燃气', cards['gas']['coverage'])
        self.assertEqual(len(cards['gas']['links']), 3)
        for card in (cards['water'], cards['gas']):
            self.assertFalse(card['usable'])
            self.assertFalse(card['calculator_enabled'])
            self.assertEqual(card['status'], 'reference_values')

    def test_review_window_and_future_verification(self):
        rows = build_modules(['beijing'], on=dt.date(2027, 2, 10))['beijing']
        self.assertEqual(next(x for x in rows if x['id']=='water')['status'], 'pending_review')
        self.assertEqual(build_modules(['beijing'], on=dt.date(2026, 1, 1))['beijing'][0]['status'], 'pending_review')

    def fixture(self, patch):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        dest = Path(directory.name) / 'utilities'
        dest.mkdir()
        row = copy.deepcopy(json.loads((DATA_DIR/'utilities/beijing.json').read_text())[0])
        row.update(patch)
        (dest/'beijing.json').write_text(json.dumps([row]))
        return Path(directory.name)

    def test_expired_source_cannot_be_current(self):
        directory = self.fixture({'effective_to':'2026-11-08'})
        row = build_modules(['beijing'], data_dir=directory, on=dt.date(2026,11,9))['beijing'][0]
        self.assertEqual(row['status'], 'expired')
        self.assertFalse(row['usable'])

    def test_future_effective_rule_is_not_current(self):
        directory = self.fixture({'effective_from':'2026-12-01'})
        row = build_modules(['beijing'], data_dir=directory, on=dt.date(2026,11,9))['beijing'][0]
        self.assertEqual(row['status'], 'pending_review')
        self.assertFalse(row['usable'])

    def test_reject_unlicensed_numeric_payload_and_non_gov(self):
        for patch in ({'tariff':{'price':1}}, {'calculator_enabled':True},
                      {'redistribution_status':'pending'}, {'verified_at':'not-a-date'},
                      {'links':[{'label':'bad','url':'https://gov.cn.evil.test'}]}):
            directory = self.fixture(patch)
            self.assertTrue(validate_modules(directory))
            with self.assertRaises(ValueError):
                build_modules(['beijing'], data_dir=directory)


    def rate_fixture(self, patch=None):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        dest = Path(directory.name) / 'utilities'
        dest.mkdir()
        row = copy.deepcopy(json.loads((DATA_DIR/'utilities/guangzhou.json').read_text())[0])
        if patch:
            patch(row)
        (dest/'guangzhou.json').write_text(json.dumps([row]))
        return Path(directory.name)

    def test_rate_facts_keep_units_thresholds_and_rounding(self):
        cards = {r['id']: r for r in build_modules(['guangzhou'], on=dt.date(2026,11,10))['guangzhou']}
        self.assertEqual([i['value'] for i in cards['water']['rate_reference']['items']], [2.55,3.82,7.65])
        self.assertEqual([i['value'] for i in cards['power']['rate_reference']['items']], [0.589,0.639,0.889])
        self.assertTrue(all(i['approximate'] for i in cards['power']['rate_reference']['items']))
        self.assertIn('每年', cards['gas']['rate_reference']['period'])
        self.assertIn('污水', cards['water']['rate_reference']['note'])
        self.assertEqual(cards['heating']['status'], 'missing')
        self.assertNotIn('rate_reference', cards['heating'])

    def test_rate_facts_are_suppressed_outside_review_window(self):
        for on in (dt.date(2026,11,9), dt.date(2027,2,10)):
            cards = build_modules(['guangzhou'], on=on)['guangzhou']
            for card in cards:
                self.assertNotIn('rate_reference', card)
        directory = self.rate_fixture(lambda row: row.update(effective_to='2026-11-09'))
        self.assertNotIn('rate_reference', build_modules(['guangzhou'], data_dir=directory, on=dt.date(2026,11,10))['guangzhou'][0])

    def test_rate_facts_require_source_review_scope_and_safe_values(self):
        patches = [lambda r:r.update(review_status='pending_independent_review'),
                   lambda r:r.update(redistribution_status='link_only'),
                   lambda r:r.update(schema_version=1),
                   lambda r:r['rate_reference'].update(source_url='https://example.com'),
                   lambda r:r['rate_reference'].update(source_url='https://example.gov.cn/unlinked'),
                   lambda r:r['rate_reference'].update(scope=''),
                   lambda r:r['rate_reference'].update(bulk_redistribution=True),
                   lambda r:r['rate_reference']['items'][0].update(unit='元/月'),
                   lambda r:r['rate_reference']['items'][0].update(approximate=None)]
        for value in (None, True, '2.55', -1, float('nan'), float('inf')):
            patches.append(lambda r, value=value:r['rate_reference']['items'][0].update(value=value))
        for patch in patches:
            directory = self.rate_fixture(patch)
            self.assertTrue(validate_modules(directory))
            with self.assertRaises(ValueError): build_modules(['guangzhou'], data_dir=directory)


class FictionalTierTests(unittest.TestCase):
    def charge(self, **kw):
        args=dict(prior_usage=0, usage=0, tiers=[(100,'1'),(200,'2'),(None,'3')],
                  year=2026, prior_year=2026, fictional=True)
        args.update(kw)
        return fictional_annual_tier_charge(**args)

    def test_boundaries_and_cumulative_logic(self):
        for usage, expected in [(0,'0.00'),(99,'99.00'),(100,'100.00'),(101,'102.00'),(200,'300.00'),(201,'303.00')]:
            self.assertEqual(self.charge(usage=usage)['amount'], expected)
        self.assertEqual(self.charge(prior_usage=99,usage=3)['amount'], '5.00')
        self.assertEqual(self.charge(prior_usage=199,usage=2)['amount'], '5.00')
        self.assertEqual(self.charge(prior_usage=100,usage=10)['amount'], '20.00')

    def test_round_once(self):
        result=self.charge(usage='1',tiers=[('0.5','0.005'),(None,'0.005')])
        self.assertEqual(result['amount'],'0.01')

    def test_cross_year_requires_explicit_split(self):
        with self.assertRaises(ValueError):self.charge(year=2027)
        self.assertEqual(self.charge(year=2027,prior_year=2027,usage=1)['amount'],'1.00')

    def test_fail_closed_for_unsupported_scope(self):
        for kw in ({'fictional':False},{'currency':'USD'},{'meter':'shared'},{'time_of_use':True},
                   {'multi_person':True},{'rent_included':True},{'partial_year':True}):
            with self.assertRaises(ValueError):self.charge(**kw)

    def test_invalid_inputs(self):
        for value in (-1, 'NaN', 'Infinity', float('inf'), True, 'no', 1000001):
            with self.assertRaises(ValueError):self.charge(usage=value)
        for tiers in ([],[(100,1)],[(None,1),(None,2)],[(100,1),(99,2),(None,3)],[(None,-1)]):
            with self.assertRaises(ValueError):self.charge(tiers=tiers)


if __name__ == '__main__':
    unittest.main()
