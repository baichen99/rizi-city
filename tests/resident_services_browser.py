"""Real browser checks for resident task navigation, not live application submission."""
import argparse
import datetime as dt
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def dimensions(page):
    size = page.evaluate('({viewport: innerWidth, page: document.documentElement.scrollWidth})')
    assert size['page'] <= size['viewport'], size
    for button in page.locator('.service-needs button').all():
        box = button.bounding_box()
        assert box['height'] >= 44 and box['width'] >= 44, box
    return size


def run(base_url, out, offline=False):
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for width in (320, 390, 768, 1280):
            context = browser.new_context(viewport={'width': width, 'height': 850},
                                          is_mobile=width <= 430, has_touch=width <= 430)
            page = context.new_page()
            errors, requests = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url))
            page.goto(base_url + '#resident&city=guangzhou')
            page.locator('#resident-services-title').filter(has_text='广州').wait_for()
            assert page.locator('.service-needs button').count() == 8
            report.append({'width': width, **dimensions(page)})
            baseline = len(requests)
            for need in ('benefits', 'housing', 'health', 'work', 'utilities', 'family', 'elder', 'all', 'family'):
                page.locator(f'[data-resident-need="{need}"]').click()
                assert page.locator(f'[data-resident-need="{need}"]').get_attribute('aria-pressed') == 'true'
                assert '收录数量不是可申请数量' in page.locator('#resident-service-results').inner_text()
                dimensions(page)
            assert page.locator('[data-service-kind="local_policy"]').count() == 0
            assert page.locator('[data-service-kind="national_navigation"]').count() == 2
            field = page.locator('#resident-service-search')
            handle = field.element_handle()
            field.fill('火星补贴')
            assert page.locator('.service-empty').is_visible()
            assert handle.evaluate('el => el === document.activeElement')
            assert '火星补贴' not in page.url
            assert '火星补贴' not in page.evaluate('JSON.stringify({...localStorage})')
            page.locator('[data-clear-service-search]').click()
            assert field.input_value() == ''
            assert handle.evaluate('el => el === document.activeElement')
            assert len(requests) == baseline, requests[baseline:]
            page.locator('[data-resident-need="elder"]').focus()
            page.keyboard.press('Enter')
            assert page.locator('[data-resident-need="elder"]').get_attribute('aria-pressed') == 'true'
            page.locator('.service-card details summary').first.click()
            card = page.locator('.service-card').first
            assert '不是申请截止日' in card.inner_text()
            assert '不是政策生效日' in card.inner_text()
            assert '材料尚未逐项核实' in card.inner_text()
            page.locator('#resident-services').screenshot(path=str(out / f'services-guangzhou-{width}.png'))
            for link in page.locator('.service-links a').all():
                assert '.gov.cn/' in link.get_attribute('href')
                assert link.get_attribute('rel') == 'noopener'
            page.select_option('#resident-city', 'shanghai')
            page.locator('#resident-services-title').filter(has_text='上海').wait_for()
            assert field.input_value() == ''
            assert page.locator('[data-resident-need="benefits"]').get_attribute('aria-pressed') == 'true'
            page.locator('[data-resident-need="housing"]').click()
            field.fill('保租房')
            assert page.locator('[data-service-kind="local_policy"]').count() == 1
            assert '安居服务' in page.locator('[data-service-kind="local_policy"]').inner_text()
            page.go_back()
            page.locator('#resident-services-title').filter(has_text='广州').wait_for()
            assert field.input_value() == ''
            page.go_forward()
            page.locator('#resident-services-title').filter(has_text='上海').wait_for()
            assert field.input_value() == ''
            page.reload()
            page.locator('#resident-services-title').filter(has_text='上海').wait_for()
            page.emulate_media(color_scheme='dark')
            page.locator('[data-resident-need="all"]').click()
            assert page.locator('[data-service-kind="national_navigation"]').count() == 4
            dimensions(page)
            page.locator('#resident-services').screenshot(path=str(out / f'services-dark-{width}.png'))
            page.goto(base_url + '#resident&city=not-a-city')
            page.locator('.resident-empty').wait_for()
            assert page.locator('#resident-services').count() == 0
            assert not errors, errors
            context.close()
        if offline:
            context = browser.new_context()
            page = context.new_page()
            page.clock.install(time=dt.datetime(2026, 12, 11, tzinfo=dt.timezone.utc))
            page.goto((ROOT / 'dist/rizi-city-offline.html').as_uri() + '#resident&city=guangzhou')
            page.locator('#resident-services-title').wait_for()
            page.locator('[data-resident-need="all"]').click()
            for badge in page.locator('[data-service-kind="national_navigation"] .life-status').all():
                assert badge.inner_text() == '全国导航 · 待复核'
            context.close()
        browser.close()
    (out / 'resident-services-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f'PASS: resident services at {len(report)} widths, repeated filters, search privacy, navigation, sources, dark mode; offline={offline}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url')
    args = parser.parse_args()
    out = ROOT / 'artifacts/mobile'
    out.mkdir(parents=True, exist_ok=True)
    server = None
    if not args.base_url:
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT / 'site')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        run(args.base_url or f'http://127.0.0.1:{server.server_port}/', out, offline=not args.base_url)
    finally:
        if server:
            server.shutdown()
