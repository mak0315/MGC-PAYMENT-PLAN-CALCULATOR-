# MGC Jewel Calculator

Installable payment-plan calculator for MGC Jewel Tower 1 and Tower 2. Plain HTML, CSS and JavaScript. No build step, no server, no accounts. Calculations run on the device and nothing is sent anywhere.

## Put it online (HTTPS is required for installation)

The folder is a static site. Any of these works; all give HTTPS automatically.

- **Netlify:** open app.netlify.com/drop and drag this whole folder onto the page.
- **Cloudflare Pages:** create a project, choose "Direct upload", upload the folder.
- **GitHub Pages:** push the folder to a repository, then Settings, Pages, deploy from the main branch.

Open the HTTPS address in Chrome on Android. Chrome offers **Install app** (an Install App button also appears in the app header). If it does not, use Chrome's menu, then **Install app** or **Add to Home Screen**. On iPhone use Share, then **Add to Home Screen**.

To try it on your computer first: `python3 -m http.server 8000` in this folder, then open http://localhost:8000.

## Before the sales team uses it

1. **Add the official rates.** Open Settings, Floor-wise rates. No rates are built in and the app never invents one. Until a rate row exists, salespeople type the rate by hand.
2. **Confirm the plan numbers** in Settings, Payment plans. The 40/20 and 50/20 values are months, not percentages.
3. **Swap in the official logo.** The gem icon is a placeholder, not MGC's logo. Replace the files in `icons/` (same names and sizes: 192, 512, maskable 512, 180 apple-touch, 32 favicon) and change `CACHE = 'mgc-jewel-calc-v1'` in `sw.js` to `v2` so installed copies update.

## Rules the calculator follows

- Final price = size x rate, minus the discount. Every payment uses the discounted price.
- Monthly installment (1% plan) = 1% of the final price, not of the remaining balance. It can be overridden or set manually.
- The down payment is part of the amount due before possession. It is never added on top.
- Balloons absorb whatever is left after the down payment, the installments and any locked balloons. Typing an amount locks that balloon; locked balloons are never changed silently. Unlocked balloons share the remainder, and any rounding difference goes to the last unlocked one.
- A plan is only called valid when scheduled payments equal the final price within PKR 1. Overpaid and uncovered plans show the exact amount, and the summary cannot be copied until the plan reconciles.
- Month 1 is the month after booking. Possession falls after month 40 (Tower 1) or 50 (Tower 2). Enter a booking month to get real dates on the schedule.

## Defaults I had to choose (all editable)

The brief did not say how balloons are split around possession or when they fall due, so these are starting points, not MGC rules:

- Tower 1 defaults to 4 balloons before possession and 2 after; Tower 2 to 6 before and 2 after (roughly in proportion to the months). Change them in Settings, or per balloon with the Timing selector.
- Balloon due months are spread evenly inside their period. Type a month on any balloon to override it.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The interface |
| `engine.js` | Calculation engine (no DOM, no storage) |
| `config.js` | Default plan configuration and the empty rate table |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and installation |
| `tests/engine.test.js` | 27 calculation tests: `node tests/engine.test.js` |
| `tests/ui-smoke.py` | Browser test, including offline: `python3 tests/ui-smoke.py` (needs Playwright) |
| `tests/make-icons.py` | Regenerates the placeholder icons (needs Pillow) |

The test files are not needed on the website; you can leave the `tests/` folder out when uploading.
