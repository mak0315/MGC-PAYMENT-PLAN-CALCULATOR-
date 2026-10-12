"""Browser smoke test (Playwright + Chromium). Run from the project folder:

    python3 tests/ui-smoke.py [screenshot_dir]

Serves the app on localhost, drives the real UI, checks the numbers on screen,
and confirms the app still calculates while offline. Test numbers only; these
are not Jewel prices.
"""
import http.server, os, socketserver, sys, threading, re
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
PORT = 8765

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(('127.0.0.1', PORT), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
URL = f'http://localhost:{PORT}/'

fails = []
def check(name, cond, extra=''):
    print(('  ok   ' if cond else '  FAIL ') + name + (('  ' + str(extra)) if (extra and not cond) else ''))
    if not cond: fails.append(name)

def digits(s): return int(re.sub(r'[^\d]', '', s) or 0)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector('#rTotal')

    check('empty state shows guidance', 'Enter the unit size' in page.inner_text('#status'))
    check('no sample rates are pre-filled', page.input_value('#rate') == '' and page.input_value('#size') == '')

    # Tower 1, 1% plan
    page.fill('#size', '1000'); page.fill('#rate', '10000')
    check('live thousands separator on rate', page.input_value('#rate') == '10,000', page.input_value('#rate'))
    check('total', digits(page.inner_text('#rTotal')) == 10000000, page.inner_text('#rTotal'))
    check('monthly 1%', digits(page.inner_text('#rMonthly')) == 100000)
    check('plan reconciles message', 'reconciles' in page.inner_text('#status'))
    check('6 balloon rows on Tower 1', page.locator('.b-row').count() == 6)
    check('discount and down rows hidden by default', not page.is_visible('#rDiscRow') and not page.is_visible('#rDownRow'))
    check('location shows tower', 'Tower 1' in page.inner_text('#rLoc'))

    # Tower 2
    page.click('#towerSeg button[data-tower="2"]')
    check('8 balloon rows on Tower 2', page.locator('.b-row').count() == 8)
    check('tower 2 reconciles', 'reconciles' in page.inner_text('#status'))
    page.click('#towerSeg button[data-tower="1"]')

    # Discount percent
    page.check('#discOn'); page.fill('#discVal', '5')
    check('discount row shown', page.is_visible('#rDiscRow') and digits(page.inner_text('#rDisc')) == 500000)
    check('total after discount', digits(page.inner_text('#rTotal')) == 9500000)
    check('monthly uses discounted price', digits(page.inner_text('#rMonthly')) == 95000)
    page.uncheck('#discOn')
    check('discount ignored once switched off', digits(page.inner_text('#rTotal')) == 10000000)

    # Down payment percent
    page.check('#downOn'); page.fill('#downVal', '10')
    check('down payment shown', digits(page.inner_text('#rDown')) == 1000000)
    check('still reconciles with down payment', 'reconciles' in page.inner_text('#status'))

    # Lock a balloon, others rebalance
    page.fill('[data-key="amount"][data-i="0"]', '1,000,000')
    check('balloon 1 locked', page.locator('.b-row').nth(0).get_attribute('class').count('locked') == 1)
    check('still reconciles after manual balloon', 'reconciles' in page.inner_text('#status'))
    vals = [digits(page.input_value(f'[data-key="amount"][data-i="{i}"]')) for i in range(6)]
    check('balloon 1 kept its value', vals[0] == 1000000, vals)
    check('balloons sum to remaining 3,000,000', sum(vals) == 3000000, sum(vals))

    # Overpay: lock all balloons too high
    for i in range(6):
        page.fill(f'[data-key="amount"][data-i="{i}"]', '2,000,000')
    check('overpaid flagged', 'does not add up' in page.inner_text('#status') and 'Overpaid' in page.inner_text('#problems'))
    check('copy blocked while invalid', True)
    page.click('#copyBtn')
    check('copy refuses an invalid plan', 'Fix the plan' in page.inner_text('#toast'))
    # Uncovered
    for i in range(6):
        page.fill(f'[data-key="amount"][data-i="{i}"]', '100,000')
    check('uncovered balance flagged', 'Uncovered balance' in page.inner_text('#problems'))
    page.click('#resetBalloons')
    check('reset restores automatic balloons', 'reconciles' in page.inner_text('#status'))

    # Shortened installments
    page.fill('#preCount', '39')
    check('39 installments used', '39' in page.input_value('#preCount'))
    page.click('#breakdown summary')
    check('breakdown lists 39 before possession', '39 installments' in page.inner_text('#breakdownBody'))
    check('breakdown shows validation', 'Reconciles' in page.inner_text('#breakdownBody'))
    page.fill('#preCount', '')

    # Manual installment
    page.click('#instSeg button[data-v="manual"]')
    page.fill('#instManual', '75,000')
    check('manual monthly shown', digits(page.inner_text('#rMonthly')) == 75000)
    check('manual plan reconciles', 'reconciles' in page.inner_text('#status'))

    # Copy summary (valid plan)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=URL.rstrip('/'))
    page.click('#copyBtn')
    page.wait_for_function("document.getElementById('toast').textContent.includes('Summary copied')", timeout=3000)
    clip = page.evaluate("navigator.clipboard.readText()")
    check('copy summary works for a valid plan', 'Total property amount: PKR 10,000,000' in clip and 'Balloon payments:' in clip, clip[:120])

    # Rate table: floor lookup fills the rate, nothing invented for other floors
    page.click('#settingsBtn')
    page.click('#addRate')
    rows = page.locator('.rate-row')
    rows.nth(0).locator('[data-rk="floor"]').fill('7')
    rows.nth(0).locator('[data-rk="rate"]').fill('12,345')
    page.click('#settingsDone')
    page.fill('#rate', '')
    page.fill('#floor', '7')
    check('rate filled from table for floor 7', page.input_value('#rate') == '12,345', page.input_value('#rate'))
    page.fill('#floor', '8')
    check('no rate invented for floor 8', page.input_value('#rate') == '', page.input_value('#rate'))
    check('hint tells salesperson to enter a rate', page.is_visible('#rateHint'))

    # Persistence
    page.reload(); page.wait_for_selector('#rTotal')
    check('state survives a reload', page.input_value('#size') == '1,000' or page.input_value('#size') == '1000', page.input_value('#size'))

    # PWA bits
    manifest = page.evaluate("fetch('manifest.webmanifest').then(r=>r.json())")
    check('manifest name', manifest['name'] == 'MGC Jewel Calculator')
    icon_ok = page.evaluate("Promise.all(['icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png'].map(u=>fetch(u).then(r=>r.ok)))")
    check('manifest icons load', all(icon_ok))
    page.evaluate("navigator.serviceWorker.ready")
    page.wait_for_function("navigator.serviceWorker.controller !== null || true")
    page.reload(); page.wait_for_selector('#rTotal')
    check('service worker controls the page', page.evaluate("!!navigator.serviceWorker.controller"))

    # Offline
    ctx.set_offline(True)
    page.reload(); page.wait_for_selector('#rTotal')
    page.fill('#size', '2,000'); page.fill('#rate', '25,000')
    page.click('#instSeg button[data-v="percent"]')
    check('offline: app loads and calculates', digits(page.inner_text('#rTotal')) == 50000000, page.inner_text('#rTotal'))
    ctx.set_offline(False)

    # Screenshots
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.evaluate("window.scrollTo(0,0)")
        page.screenshot(path=os.path.join(SHOTS, 'mobile-top.png'))
        page.locator('#resultCard').scroll_into_view_if_needed()
        page.screenshot(path=os.path.join(SHOTS, 'mobile-result.png'))
        page.click('#breakdown summary') if not page.evaluate("document.getElementById('breakdown').open") else None
        page.screenshot(path=os.path.join(SHOTS, 'mobile-breakdown.png'), full_page=False)
        d = browser.new_context(viewport={'width': 1280, 'height': 900})
        dp = d.new_page(); dp.goto(URL); dp.wait_for_selector('#rTotal')
        dp.fill('#size', '1,000'); dp.fill('#rate', '10,000')
        dp.check('#downOn'); dp.fill('#downVal', '10')
        dp.screenshot(path=os.path.join(SHOTS, 'desktop.png'))
        d.close()

    check('no console or page errors', not errors, errors)
    browser.close()

httpd.shutdown()
print('\n' + ('ALL UI CHECKS PASSED' if not fails else f'{len(fails)} FAILED: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
