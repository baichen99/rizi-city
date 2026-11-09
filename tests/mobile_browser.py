"""Real Chromium responsive regression checks; screenshots are CI artifacts.

Run: pip install playwright && playwright install chromium
     python3 tests/mobile_browser.py [--base-url https://baichen99.github.io/rizi-city/]
"""
import argparse
import functools
import http.server
import json
from pathlib import Path
import threading
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def check_page(page, label):
    dimensions = page.evaluate("""() => ({viewport: innerWidth,
      page: document.documentElement.scrollWidth})""")
    assert dimensions['page'] <= dimensions['viewport'], (label, dimensions)
    assert page.locator('.panel:visible').count() == 1, label
    for element in page.locator('.panel:visible button:visible, .tabs button:visible').all():
        box = element.bounding_box()
        assert box['height'] >= 44, (label, element.inner_text(), box)
    if dimensions['viewport'] <= 600:
        for button in page.locator('.tabs button').all():
            box = button.bounding_box()
            assert box['x'] >= 0 and box['x'] + box['width'] <= dimensions['viewport'], (label, box)
    return dimensions


def run(base_url, out):
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for width in (320, 360, 390, 430, 768, 1280):
            context = browser.new_context(viewport={'width': width, 'height': 800},
                                          is_mobile=width <= 430, has_touch=width <= 430,
                                          device_scale_factor=1)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            for name, route in {
                'resident': 'resident&city=beijing',
                'compare': 'compare&a=beijing&b=shanghai',
                'civil': 'civil', 'grad': 'grad', 'free': 'free', 'index': 'index',
            }.items():
                page.goto(base_url + '#' + route)
                page.locator('#meta').filter(has_text='座城市').wait_for()
                page.locator(f'#tab-{name}').wait_for(state='visible')
                page.evaluate('window.scrollTo(0, 0)')
                report.append({'width': width, 'page': name, **check_page(page, name)})
                page.screenshot(path=str(out / f'{name}-{width}.png'))
                if name == 'resident':
                    page.locator('[data-jump="overview"]').click()
                    assert page.locator('#life-overview').bounding_box()['y'] >= page.locator('.tabs').bounding_box()['height']
                    page.locator('#life-overview details:not(.metric-explainer) summary').first.click()
                    house = page.locator('#life-overview [data-metric="housing_new_yoy_index"]')
                    assert '低 2.7%' in house.locator('.metric-reading').inner_text()
                    assert '97.3' in house.locator('.metric-original').inner_text()
                    house.locator('.metric-explainer summary').click()
                    assert '102表示同比涨2%' in house.inner_text()
                    house.screenshot(path=str(out / f'house-explained-{width}.png'))
                    check_page(page, 'resident-source')
                    page.screenshot(path=str(out / f'resident-source-{width}.png'))
                    page.locator('[data-jump="history"]').click()
                    chart = page.locator('.history-chart:visible').first
                    chart.wait_for()
                    if width <= 600:
                        label_size = chart.evaluate("""el => parseFloat(getComputedStyle(el.querySelector('text')).fontSize)
                          * el.getBoundingClientRect().width / el.viewBox.baseVal.width""")
                        assert label_size >= 12, (width, label_size)
                    chart.locator('..').screenshot(path=str(out / f'resident-history-{width}.png'))
                    check_page(page, 'resident-history')
                    lifespan = page.locator('#life-history article').filter(has=page.get_by_role('heading', name='出生时预期寿命', exact=True))
                    life_chart = lifespan.locator('.history-chart:visible')
                    assert life_chart.locator('circle').count() == 2
                    assert life_chart.locator('polyline').count() == 1
                    assert life_chart.locator('text').all_text_contents()[-2:] == ['2020', '2025']
                    lifespan.locator('summary').click()
                    for year in range(2022, 2026):
                        row = lifespan.locator('tbody tr').filter(has=page.get_by_role('rowheader', name=str(year), exact=True))
                        assert row.locator('td').first.inner_text().strip().startswith('—')
                    if width <= 600:
                        for cell in lifespan.locator('tbody th, tbody td:nth-child(2)').all():
                            assert cell.evaluate("el => el.scrollWidth <= el.clientWidth")
                    lifespan.screenshot(path=str(out / f'beijing-life-history-{width}.png'))
                    check_page(page, 'beijing-life-gaps')
                    page.locator('[data-jump="policies"]').click()
                    page.select_option('#policy-topic', 'social')
                    assert page.locator('#policy-topic').input_value() == 'social'
                    check_page(page, 'resident-policy')
                if name == 'compare':
                    assert page.locator('.comparison-card').count() == 8
                    assert page.locator('.comparison-card[data-comparable="true"]').count() >= 2
                    cells = page.locator('.comparison-card').first.locator('.comparison-city')
                    assert cells.nth(0).bounding_box()['y'] == cells.nth(1).bounding_box()['y']
                    assert cells.nth(0).bounding_box()['x'] < cells.nth(1).bounding_box()['x']
                    page.locator('.comparison-card[data-metric="housing_new_yoy_index"]').screenshot(path=str(out / f'compare-housing-{width}.png'))
                    sources = page.locator('#tab-compare details summary')
                    if sources.count():
                        sources.first.click()
                        check_page(page, 'compare-source')
                        if width <= 600:
                            assert page.locator('.comparison-evidence').first.bounding_box()['width'] >= 220
                            assert page.locator('.comparison-city h4').first.is_visible()
                        page.screenshot(path=str(out / f'compare-source-{width}.png'))
                    page.select_option('#compare-b', 'beijing')
                    assert page.get_by_text('请选择两座不同的城市。', exact=True).is_visible()
                    page.select_option('#compare-b', 'shanghai')
                    assert not page.get_by_text('请选择两座不同的城市。', exact=True).is_visible()
                if name == 'civil':
                    page.locator('[data-civil="year"]').nth(1).click()
                    page.locator('[data-civil="contract"][data-val="no"]').click()
                    page.locator('[data-civil="social"][data-val="no"]').click()
                    page.locator('[data-civil="files"][data-val="school"]').click()
                    check_page(page, 'civil-self-check')
                    page.screenshot(path=str(out / f'civil-selected-{width}.png'))
                    page.locator('#tab-civil details.city summary').first.click()
                    check_page(page, 'civil-expanded')
                if name == 'index':
                    page.locator('.index-guide summary').click()
                    assert '不是房租便宜75%' in page.locator('.index-guide').inner_text()
                    page.locator('.rank-explanation summary').first.click()
                    check_page(page, 'index-explanation')
                    page.locator('.index-guide').screenshot(path=str(out / f'index-explanation-{width}.png'))
                    for action in ('button', 'escape', 'button'):
                        page.locator('[data-share="top5"]').click()
                        assert page.locator('#sheet').is_visible()
                        check_page(page, 'share')
                        if action == 'escape':
                            page.screenshot(path=str(out / f'share-{width}.png'))
                        if action == 'button':
                            page.locator('[data-close]').click()
                        else:
                            page.keyboard.press('Escape')
                        assert not page.locator('#sheet').is_visible()
                    # A tab change from deep in a long page must expose the new heading.
                    page.locator('.foot').scroll_into_view_if_needed()
                    page.locator('[data-tab="civil"]').click()
                    assert page.locator('#tab-civil h2').first.bounding_box()['y'] < 200
                    assert page.locator('#tab-civil').is_visible()
                    page.go_back()
                    assert page.locator('#tab-index').is_visible()
                    page.go_forward()
                    assert page.locator('#tab-civil').is_visible()
            page.goto(base_url + '#compare&a=guangzhou&b=shanghai')
            page.locator('.comparison-card[data-metric="income"]').wait_for()
            snapshot = json.loads((ROOT / 'site/data/cities.json').read_text())
            by_id = {c['id']: c for c in snapshot['cities']}
            for metric, field in (('income','income_per_capita'), ('consumption','consumption_per_capita')):
                pair = [by_id[c]['living'].get('statistical_metadata', {}).get(field, {}) for c in ('guangzhou','shanghai')]
                if all(m.get('review_status') == 'verified' for m in pair):
                    same = pair[0].get('cross_city_comparability_key') == pair[1].get('cross_city_comparability_key') and pair[0].get('period') == pair[1].get('period')
                    assert page.locator(f'.comparison-card[data-metric="{metric}"]').get_attribute('data-comparable') == str(same).lower()
            page.locator('.comparison-card[data-metric="income"]').screenshot(path=str(out / f'compare-income-{width}.png'))
            check_page(page, 'guangzhou-shanghai-metadata')
            page.goto(base_url + '#resident&city=guangzhou')
            page.locator('#resident-city').wait_for()
            page.locator('[data-jump="daily"]').click()
            for title in ('水费', '燃气'):
                card = page.locator('#life-daily article').filter(has=page.get_by_role('heading', name=title, exact=False))
                assert card.count() == 1, title
                card.screenshot(path=str(out / f'guangzhou-{title}-{width}.png'))
            check_page(page, 'guangzhou-utility-links')
            assert not errors, (width, errors)
            context.close()
        dark = browser.new_page(viewport={'width':390,'height':800},color_scheme='dark')
        dark.goto(base_url + '#compare&a=beijing&b=shanghai')
        dark.locator('.comparison-card').first.wait_for()
        check_page(dark, 'dark-compare')
        dark.screenshot(path=str(out / 'compare-390-dark.png'))
        browser.close()
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f'PASS: {len(report)} page/viewport combinations, expanded evidence, self-check, navigation, repeated share open/close, dark mode')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url')
    parser.add_argument('--output', default='artifacts/mobile')
    args = parser.parse_args()
    out = ROOT / args.output
    out.mkdir(parents=True, exist_ok=True)
    server = None
    if not args.base_url:
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / 'site'))
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        if args.base_url:
            # Pages may be briefly cached after deploy. Verify the exact tested assets first.
            for attempt in range(12):
                try:
                    for name in ('app.js', 'style.css', 'index.html', 'data/cities.json'):
                        with urlopen(args.base_url + name + '?mobile-check=' + str(time.time()), timeout=20) as response:
                            assert response.read() == (ROOT / 'site' / name).read_bytes(), name
                    break
                except (AssertionError, OSError):
                    if attempt == 11:
                        raise
                    time.sleep(10)
        run(args.base_url or f'http://127.0.0.1:{server.server_port}/', out)
    finally:
        if server:
            server.shutdown()
