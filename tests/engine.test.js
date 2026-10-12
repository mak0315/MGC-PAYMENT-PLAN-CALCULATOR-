/*
 * Engine tests. Run:  node tests/engine.test.js
 *
 * The sizes and rates below are arbitrary TEST numbers chosen to make the
 * arithmetic easy to check by hand. They are NOT Jewel prices.
 */
'use strict';
const assert = require('assert');
const E = require('../engine.js');
require('vm').runInNewContext(require('fs').readFileSync(__dirname + '/../config.js', 'utf8'), (global.window = {}, global));
const PLANS = global.window.JEWEL_DEFAULTS.plans;
const T1 = PLANS['1'], T2 = PLANS['2'];

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const base = (over) => Object.assign({ sizeSqft: 1000, rate: 10000 }, over || {}); // 10,000,000 base

function reconciles(r) {
  assert.strictEqual(r.status, 'valid', 'status was ' + r.status + ': ' + r.errors.join(' | '));
  assert.ok(Math.abs(r.scheduledTotal - r.final) <= 1, 'scheduled ' + r.scheduledTotal + ' vs final ' + r.final);
  const parts = r.down + r.installmentsTotal + r.balloonsTotal + r.otherTotal;
  assert.strictEqual(parts, r.scheduledTotal);
  assert.strictEqual(r.pre.total + r.post.total, r.scheduledTotal);
  assert.ok(r.balloons.every((b) => b.amount >= 0), 'negative balloon');
}

console.log('Engine tests');

test('1. Tower 1: 1% installment, 6 balloons, 40/20 months', () => {
  const r = E.calculate(base(), T1);
  assert.strictEqual(r.final, 10000000);
  assert.strictEqual(r.monthly, 100000);
  assert.strictEqual(r.preCount, 40);
  assert.strictEqual(r.postCount, 20);
  assert.strictEqual(r.balloons.length, 6);
  assert.strictEqual(r.installmentsTotal, 6000000);       // 60 x 1%
  assert.strictEqual(r.balloonsTotal, 4000000);            // remaining 40% covered by balloons
  reconciles(r);
});

test('2. Tower 2: 1% installment, 8 balloons, 50/20 months', () => {
  const r = E.calculate(base(), T2);
  assert.strictEqual(r.balloons.length, 8);
  assert.strictEqual(r.preCount, 50);
  assert.strictEqual(r.postCount, 20);
  assert.strictEqual(r.installmentsTotal, 7000000);        // 70 x 1%
  assert.strictEqual(r.balloonsTotal, 3000000);
  reconciles(r);
});

test('months are not percentages (40/20 does not mean 40%/20%)', () => {
  const r = E.calculate(base(), T1);
  assert.notStrictEqual(r.pre.total, 4000000);
  assert.strictEqual(r.pre.installments, 4000000);         // 40 x 100,000 happens to equal 40% only because 1% x 40 months
  const r2 = E.calculate(base({ installment: { mode: 'manual', manual: 50000 } }), T1);
  assert.strictEqual(r2.pre.installments, 2000000);        // changes with the installment, proving it is month-driven
});

test('3. No down payment', () => {
  const r = E.calculate(base({ down: { enabled: false, type: 'percent', value: 20 } }), T1);
  assert.strictEqual(r.down, 0);
  assert.ok(!r.rows.some((x) => x.kind === 'down'));
  reconciles(r);
});

test('4. Down payment as percentage', () => {
  const r = E.calculate(base({ down: { enabled: true, type: 'percent', value: 10 } }), T1);
  assert.strictEqual(r.down, 1000000);
  assert.strictEqual(r.balloonsTotal, 3000000);            // 4,000,000 - 1,000,000: down is NOT added on top
  assert.strictEqual(r.scheduledTotal, 10000000);
  assert.strictEqual(r.pre.down, 1000000);
  reconciles(r);
});

test('5. Down payment as fixed PKR', () => {
  const r = E.calculate(base({ down: { enabled: true, type: 'fixed', value: 1500000 } }), T2);
  assert.strictEqual(r.down, 1500000);
  assert.strictEqual(r.balloonsTotal, 1500000);
  reconciles(r);
});

test('6a. Percentage discount', () => {
  const r = E.calculate(base({ discount: { enabled: true, type: 'percent', value: 5 } }), T1);
  assert.strictEqual(r.discount, 500000);
  assert.strictEqual(r.final, 9500000);
  assert.strictEqual(r.monthly, 95000);                    // 1% of DISCOUNTED price
  reconciles(r);
});

test('6b. Fixed PKR discount', () => {
  const r = E.calculate(base({ discount: { enabled: true, type: 'fixed', value: 250000 } }), T1);
  assert.strictEqual(r.final, 9750000);
  assert.strictEqual(r.monthly, 97500);
  reconciles(r);
});

test('6c. Discount cannot exceed base price', () => {
  const r = E.calculate(base({ discount: { enabled: true, type: 'fixed', value: 99999999 } }), T1);
  assert.ok(r.discount <= r.base);
  assert.ok(r.errors.some((e) => /Discount/.test(e)));
  assert.notStrictEqual(r.status, 'valid');
});

test('7. Shortened pre-possession installments (39 of 40) go to balloons', () => {
  const full = E.calculate(base(), T1);
  const r = E.calculate(base({ preCount: 39 }), T1);
  assert.strictEqual(r.preCount, 39);
  assert.strictEqual(r.installmentsTotal, 59 * 100000);
  assert.strictEqual(r.balloonsTotal, full.balloonsTotal + 100000);
  reconciles(r);
  const r2 = E.calculate(base({ preCount: 49 }), T2);
  assert.strictEqual(r2.preCount, 49);
  assert.strictEqual(r2.balloonsTotal, 3000000 + 100000);
  reconciles(r2);
});

test('8. Manual monthly installment; balloons absorb the balance', () => {
  const r = E.calculate(base({ installment: { mode: 'manual', manual: 75000 } }), T1);
  assert.strictEqual(r.monthly, 75000);
  assert.strictEqual(r.installmentsTotal, 60 * 75000);
  assert.strictEqual(r.balloonsTotal, 10000000 - 60 * 75000);
  reconciles(r);
});

test('8b. Override of the 1% amount', () => {
  const r = E.calculate(base({ installment: { mode: 'percent', override: 120000 } }), T1);
  assert.strictEqual(r.monthly, 120000);
  reconciles(r);
});

test('9. Manual balloon adjustment is locked and others rebalance', () => {
  const auto = E.calculate(base(), T1);
  const b = auto.balloons.map(() => ({ amount: null }));
  b[0] = { amount: 1000000 };
  const r = E.calculate(base({ balloons: b }), T1);
  assert.strictEqual(r.balloons[0].amount, 1000000);       // locked value never altered
  assert.strictEqual(r.balloons[0].locked, true);
  assert.strictEqual(sum(r.balloons.slice(1).map((x) => x.amount)), 3000000);
  reconciles(r);
});

test('10. Automatic redistribution; rounding goes to the last adjustable balloon', () => {
  const r = E.calculate(base(), T1);                       // 4,000,000 / 6 is not a whole number
  const amts = r.balloons.map((x) => x.amount);
  assert.strictEqual(sum(amts), 4000000);
  assert.strictEqual(amts[0], 666666);
  assert.strictEqual(amts[5], 666670);
  // lock the last one: rounding moves to the new last adjustable balloon
  const b = r.balloons.map(() => ({ amount: null }));
  b[5] = { amount: 500000 };
  const r2 = E.calculate(base({ balloons: b }), T1);
  assert.strictEqual(r2.balloons[5].amount, 500000);
  assert.strictEqual(sum(r2.balloons.map((x) => x.amount)), 4000000);
  reconciles(r2);
});

test('11a. Overpaid plan is flagged with the exact excess', () => {
  const b = Array.from({ length: 6 }, () => ({ amount: 1000000 })); // 6,000,000 + 6,000,000 installments
  const r = E.calculate(base({ balloons: b }), T1);
  assert.strictEqual(r.status, 'overpaid');
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.excess, 2000000);
  assert.ok(r.errors.some((e) => /Overpaid by PKR 2,000,000/.test(e)));
});

test('11b. Uncovered balance is flagged with the exact shortfall', () => {
  const b = Array.from({ length: 6 }, () => ({ amount: 500000 })); // 3,000,000 of 4,000,000
  const r = E.calculate(base({ balloons: b }), T1);
  assert.strictEqual(r.status, 'incomplete');
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.shortfall, 1000000);
  assert.ok(r.errors.some((e) => /Uncovered balance of PKR 1,000,000/.test(e)));
});

test('11c. Installments larger than the price: overpaid, never a negative balloon', () => {
  const r = E.calculate(base({ installment: { mode: 'manual', manual: 400000 } }), T1);
  assert.ok(r.balloons.every((x) => x.amount === 0));
  assert.strictEqual(r.status, 'overpaid');
});

test('11d. Down payment larger than the pre-possession amount is rejected', () => {
  const r = E.calculate(base({ down: { enabled: true, type: 'percent', value: 80 } }), T1);
  assert.notStrictEqual(r.status, 'valid');
  assert.ok(r.errors.length > 0);
  assert.ok(r.balloons.every((x) => x.amount >= 0));
});

test('11e. Negative balloon input is clamped to zero with a warning', () => {
  const b = [{ amount: -500 }];
  const r = E.calculate(base({ balloons: b }), T1);
  assert.strictEqual(r.balloons[0].amount, 0);
  assert.ok(r.warnings.some((w) => /negative/.test(w)));
});

test('12. Different sizes, rates, floors and unit types give correct bases', () => {
  const cases = [
    { sizeSqft: 523.5, rate: 8765.25, expect: Math.round(523.5 * 8765.25) },
    { sizeSqft: 1, rate: 1, expect: 1 },
    { sizeSqft: 2000, rate: 25000, expect: 50000000 },
    { sizeSqft: 310, rate: 41500, expect: 12865000 }
  ];
  cases.forEach((c) => {
    [T1, T2].forEach((plan) => {
      const r = E.calculate({ sizeSqft: c.sizeSqft, rate: c.rate }, plan);
      assert.strictEqual(r.base, c.expect);
      reconciles(r);
    });
  });
});

test('12b. Missing size or rate yields an empty (not valid) result, no invented numbers', () => {
  assert.strictEqual(E.calculate({}, T1).status, 'empty');
  assert.strictEqual(E.calculate({ sizeSqft: 500 }, T1).final, 0);
  assert.strictEqual(E.calculate({ rate: 9000 }, T1).valid, false);
});

test('Balloons before/after possession are tracked and reconcile', () => {
  const b = Array.from({ length: 6 }, (_, i) => ({ amount: null, period: i < 2 ? 'pre' : 'post' }));
  const r = E.calculate(base({ balloons: b }), T1);
  const preB = sum(r.balloons.filter((x) => x.period === 'pre').map((x) => x.amount));
  const postB = sum(r.balloons.filter((x) => x.period === 'post').map((x) => x.amount));
  assert.strictEqual(r.pre.balloons, preB);
  assert.strictEqual(r.post.balloons, postB);
  assert.strictEqual(r.pre.total, r.down + 40 * 100000 + preB);
  assert.strictEqual(r.post.total, 20 * 100000 + postB);
  reconciles(r);
});

test('Plan config is respected (engine has no hard-coded towers)', () => {
  const custom = { preMonths: 12, postMonths: 6, balloons: 3, balloonsPre: 2, installmentPercent: 2 };
  const r = E.calculate(base(), custom);
  assert.strictEqual(r.balloons.length, 3);
  assert.strictEqual(r.monthly, 200000);
  assert.strictEqual(r.installmentsTotal, 18 * 200000);
  reconciles(r);
});

test('Dates label the schedule when a booking month is given', () => {
  const r = E.calculate(base({ booking: { date: '2026-11', startOffset: 1 } }), T1);
  const inst = r.rows.find((x) => x.kind === 'installments' && x.period === 'pre');
  assert.strictEqual(inst.fromLabel, 'Dec 2026');           // month 1 = month after booking
  assert.strictEqual(inst.toLabel, 'Mar 2030');             // month 40
  const noDate = E.calculate(base(), T1);
  assert.strictEqual(noDate.rows.find((x) => x.kind === 'installments').fromLabel, 'Month 1');
});

test('Balloon due month can be set and overrides the default', () => {
  const b = [{ amount: null, period: 'pre', month: 12 }];
  const r = E.calculate(base({ balloons: b }), T1);
  assert.strictEqual(r.balloons[0].month, 12);
  assert.strictEqual(r.balloons[0].monthIsAuto, false);
});

test('Other scheduled payments are counted once', () => {
  const r = E.calculate(base({ other: [{ label: 'Processing', amount: 200000, period: 'pre' }] }), T1);
  assert.strictEqual(r.otherTotal, 200000);
  assert.strictEqual(r.balloonsTotal, 3800000);
  reconciles(r);
});

test('Money stays whole-rupee integers', () => {
  const r = E.calculate({ sizeSqft: 733.33, rate: 7919.17, discount: { enabled: true, type: 'percent', value: 3.3 },
    down: { enabled: true, type: 'percent', value: 12.5 } }, T2);
  [r.base, r.discount, r.final, r.down, r.monthly, r.scheduledTotal].concat(r.balloons.map((x) => x.amount))
    .forEach((n) => assert.ok(Number.isInteger(n), 'not an integer: ' + n));
  reconciles(r);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
