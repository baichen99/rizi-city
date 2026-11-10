"""Native select DOM-lifecycle regression in Chromium and mobile-emulated WebKit.

Playwright select_option commits input/change, not the iOS system picker UI.
A physical iPhone check is still needed to verify that system UI end to end.
Run: playwright install chromium webkit && python3 tests/city_select_browser.py
"""
import argparse
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def commit_city(page, selector, value, fragment):
    control = page.locator(selector)
    control.focus()
    page.evaluate("""selector => {
      window.citySelect = document.querySelector(selector);
      window.selectFocusCalls = 0;
      window.selectChanges = 0;
      window.selectWasRemoved = false;
      window.selectObserver = new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) {
          if (node === window.citySelect || node.contains?.(window.citySelect))
            window.selectWasRemoved = true;
        }
      });
      window.selectObserver.observe(document.body, {childList: true, subtree: true});
      window.citySelect.addEventListener('change', () => window.selectChanges++, {once: true});
    }""", selector)
    control.select_option(value)
    assert page.locator(selector).input_value() == value
    assert page.evaluate('location.hash') == fragment
    lifecycle = page.evaluate("""selector => ({
      sameNode: window.citySelect === document.querySelector(selector),
      connected: window.citySelect.isConnected,
      removed: window.selectWasRemoved,
      focused: document.activeElement === window.citySelect,
      focusCalls: window.selectFocusCalls,
      changes: window.selectChanges,
    })""", selector)
    page.evaluate('window.selectObserver.disconnect()')
    assert lifecycle == {'sameNode': True, 'connected': True, 'removed': False,
                         'focused': True, 'focusCalls': 0, 'changes': 1}, (selector, value, lifecycle)


def exercise(browser, base_url, mobile):
    context = browser.new_context(viewport={'width': 390 if mobile else 1280, 'height': 844},
                                  is_mobile=mobile, has_touch=mobile)
    context.add_init_script("""(() => {
      const focus = HTMLSelectElement.prototype.focus;
      HTMLSelectElement.prototype.focus = function (...args) {
        window.selectFocusCalls = (window.selectFocusCalls || 0) + 1;
        return focus.apply(this, args);
      };
    })();""")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base_url + '#resident')
    page.locator('#resident-city').wait_for()
    for city, label in [('beijing', '北京'), ('shanghai', '上海'), ('guangzhou', '广州')]:
        commit_city(page, '#resident-city', city, '#resident&city=' + city)
        assert label in page.locator('.resident-intro h2').inner_text()
        assert page.locator('[data-remember]').is_enabled()
        assert page.locator('#life-overview').is_visible()
    page.go_back()
    assert page.locator('#resident-city').input_value() == 'shanghai'
    page.go_forward()
    assert page.locator('#resident-city').input_value() == 'guangzhou'
    page.locator('[data-remember]').click()
    page.reload()
    assert page.locator('#resident-city').input_value() == 'guangzhou'
    commit_city(page, '#resident-city', '', '#resident')
    assert page.locator('.resident-empty').is_visible()
    assert page.locator('[data-remember]').is_disabled()
    page.locator('[data-forget]').click()

    page.locator('[data-tab="compare"]').click()
    commit_city(page, '#compare-a', 'beijing', '#compare&a=beijing')
    commit_city(page, '#compare-b', 'shanghai', '#compare&a=beijing&b=shanghai')
    assert page.locator('.comparison-card').count() > 0
    commit_city(page, '#compare-a', 'guangzhou', '#compare&a=guangzhou&b=shanghai')
    assert page.locator('#compare-b').input_value() == 'shanghai'
    commit_city(page, '#compare-b', 'guangzhou', '#compare&a=guangzhou&b=guangzhou')
    assert '请选择两座不同的城市' in page.locator('#tab-compare').inner_text()
    commit_city(page, '#compare-b', '', '#compare&a=guangzhou')
    assert page.locator('.comparison-card').count() == 0
    page.go_back()
    assert page.locator('#compare-b').input_value() == 'guangzhou'
    page.go_back()
    assert page.locator('#compare-b').input_value() == 'shanghai'
    page.go_forward()
    assert page.locator('#compare-b').input_value() == 'guangzhou'

    # Returning to a panel must update the stable controls from route state.
    page.locator('[data-tab="resident"]').click()
    commit_city(page, '#resident-city', 'beijing', '#resident&city=beijing')
    page.locator('[data-tab="compare"]').click()
    assert page.locator('#compare-a').input_value() == 'guangzhou'
    page.locator('[data-tab="index"]').click()
    commit_city(page, '#my-city', 'beijing', '#index&w=1.1.1.1.1&city=beijing')
    commit_city(page, '#my-city', 'shanghai', '#index&w=1.1.1.1.1&city=shanghai')
    assert not errors, errors
    context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url')
    parser.add_argument('--engine', choices=['chromium', 'webkit', 'all'], default='all')
    parser.add_argument('--chromium-executable')
    args = parser.parse_args()
    server = None
    base_url = args.base_url
    if not base_url:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
            functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / 'site')))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base_url = f'http://127.0.0.1:{server.server_port}/'
    try:
        with sync_playwright() as playwright:
            for engine in ['chromium', 'webkit'] if args.engine == 'all' else [args.engine]:
                launch = {'executable_path': args.chromium_executable} if engine == 'chromium' and args.chromium_executable else {}
                browser = getattr(playwright, engine).launch(**launch)
                for mobile in [True, False]:
                    exercise(browser, base_url, mobile)
                    print(json.dumps({'engine': engine, 'mobile': mobile, 'city_select': 'passed'}))
                browser.close()
    finally:
        if server:
            server.shutdown()


if __name__ == '__main__':
    main()
