/*
 * MGC Jewel Calculator: calculation engine.
 *
 * Pure functions, no DOM, no storage, no network. Works in the browser
 * (window.JewelEngine) and in Node (require) so it can be unit tested.
 *
 * Money is handled as whole-PKR integers. Percentages are converted to basis
 * points and size x rate is computed in hundredths, so no floating point error
 * can leak into a payment amount. Any rounding difference is pushed into the
 * last adjustable (unlocked) balloon, never hidden.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JewelEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOLERANCE = 1; // PKR
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }
  function isBlank(v) { return v === null || v === undefined || String(v).trim() === ''; }
  function clampInt(v, min, max) {
    var n = Math.round(toNum(v));
    return Math.min(max, Math.max(min, n));
  }
  // amount * pct / 100, exact to the rupee (pct held in basis points)
  function pctOf(amount, pct) {
    var bp = Math.round(Math.max(0, toNum(pct)) * 100);
    return Math.round(amount * bp / 10000);
  }
  // size (sq ft) * rate (PKR / sq ft), computed in hundredths
  function sizeTimesRate(size, rate) {
    var s = Math.round(Math.max(0, toNum(size)) * 100);
    var r = Math.round(Math.max(0, toNum(rate)) * 100);
    return Math.round(s * r / 10000);
  }

  function addMonths(ym, n) {
    var m = /^(\d{4})-(\d{2})$/.exec(ym || '');
    if (!m) return null;
    var total = parseInt(m[1], 10) * 12 + (parseInt(m[2], 10) - 1) + n;
    return MONTHS[((total % 12) + 12) % 12] + ' ' + Math.floor(total / 12);
  }
  // Month n counted from the booking month (month 0).
  function monthLabel(n, booking) {
    var d = addMonths(booking, n);
    return d || 'Month ' + n;
  }

  function normalizePlan(plan) {
    var pre = clampInt(plan.preMonths, 0, 600);
    var post = clampInt(plan.postMonths, 0, 600);
    var n = clampInt(plan.balloons, 0, 60);
    return {
      preMonths: pre,
      postMonths: post,
      balloons: n,
      balloonsPre: clampInt(plan.balloonsPre, 0, n),
      installmentPercent: Math.max(0, toNum(plan.installmentPercent))
    };
  }

  /*
   * calculate(input, plan)
   *
   * input:
   *   sizeSqft, rate
   *   discount: { enabled, type: 'percent'|'fixed', value }
   *   down:     { enabled, type: 'percent'|'fixed', value }
   *   installment: { mode: 'percent'|'manual', manual, override }
   *   preCount, postCount   (null/blank = plan default; editable independently)
   *   booking: { date: 'YYYY-MM' | '', startOffset }   startOffset = months after booking
   *                                                     in which the first installment falls (default 1)
   *   balloons: [{ amount: null|number (number = locked), period: 'pre'|'post'|null, month: null|number }]
   *   other: [{ label, amount, period }]   other scheduled payments (optional)
   */
  function calculate(input, planIn) {
    input = input || {};
    var plan = normalizePlan(planIn);
    var errors = [];
    var warnings = [];

    var size = Math.max(0, toNum(input.sizeSqft));
    var rate = Math.max(0, toNum(input.rate));
    var base = sizeTimesRate(size, rate);

    var result = {
      status: 'empty', valid: false, errors: errors, warnings: warnings,
      plan: plan, base: base, discount: 0, final: 0, down: 0, monthly: 0,
      preCount: 0, postCount: 0, balloons: [], rows: [],
      pre: { down: 0, installments: 0, balloons: 0, other: 0, total: 0, remainingAfterDown: 0 },
      post: { installments: 0, balloons: 0, other: 0, total: 0 },
      installmentsTotal: 0, balloonsTotal: 0, otherTotal: 0,
      scheduledTotal: 0, difference: 0, possessionMonth: plan.preMonths,
      shortfall: 0, excess: 0
    };
    if (!(base > 0)) return result;

    // ---- discount -------------------------------------------------------
    var disc = input.discount || {};
    var discount = 0;
    if (disc.enabled && toNum(disc.value) > 0) {
      discount = disc.type === 'fixed' ? Math.round(toNum(disc.value)) : pctOf(base, Math.min(toNum(disc.value), 100));
      if (disc.type !== 'fixed' && toNum(disc.value) > 100) {
        errors.push('Discount cannot be more than 100% of the base price.');
      }
      if (discount > base) {
        errors.push('Discount (PKR ' + fmt(discount) + ') is more than the base price (PKR ' + fmt(base) + ').');
        discount = base;
      }
    }
    var final = base - discount;

    // ---- down payment ---------------------------------------------------
    var dp = input.down || {};
    var down = 0;
    if (dp.enabled && toNum(dp.value) > 0) {
      down = dp.type === 'fixed' ? Math.round(toNum(dp.value)) : pctOf(final, Math.min(toNum(dp.value), 100));
    }

    // ---- monthly installment -------------------------------------------
    var inst = input.installment || {};
    var monthly;
    if (inst.mode === 'manual') {
      monthly = Math.max(0, Math.round(toNum(inst.manual)));
    } else if (!isBlank(inst.override) && toNum(inst.override) > 0) {
      monthly = Math.round(toNum(inst.override));
    } else {
      monthly = pctOf(final, plan.installmentPercent);
    }

    var preCount = isBlank(input.preCount) ? plan.preMonths : clampInt(input.preCount, 0, 600);
    var postCount = isBlank(input.postCount) ? plan.postMonths : clampInt(input.postCount, 0, 600);

    var booking = input.booking || {};
    var startOffset = isBlank(booking.startOffset) ? 1 : clampInt(booking.startOffset, 0, 600);
    var bookingDate = booking.date || '';

    var preInst = monthly * preCount;
    var postInst = monthly * postCount;

    // ---- other scheduled payments --------------------------------------
    var otherPre = 0, otherPost = 0;
    (input.other || []).forEach(function (o) {
      var a = Math.max(0, Math.round(toNum(o.amount)));
      if (o.period === 'post') otherPost += a; else otherPre += a;
    });

    // ---- balloons ---------------------------------------------------------
    var balloons = [];
    var perPeriodTotal = { pre: 0, post: 0 };
    var inputB = input.balloons || [];
    var i;
    for (i = 0; i < plan.balloons; i++) {
      var b = inputB[i] || {};
      var period = (b.period === 'pre' || b.period === 'post') ? b.period : (i < plan.balloonsPre ? 'pre' : 'post');
      var locked = !isBlank(b.amount);
      var amt = null;
      if (locked) {
        var raw = toNum(b.amount);
        if (raw < 0) warnings.push('Balloon ' + (i + 1) + ' cannot be negative; it was set to 0.');
        amt = Math.max(0, Math.round(raw));
      }
      balloons.push({
        index: i + 1, locked: locked, amount: amt, period: period,
        month: isBlank(b.month) ? null : clampInt(b.month, 0, 1200)
      });
      perPeriodTotal[period]++;
    }

    // default (auto) due months: spread evenly inside each period
    var seen = { pre: 0, post: 0 };
    balloons.forEach(function (bl) {
      var k = seen[bl.period]++;
      var m = perPeriodTotal[bl.period];
      var lo = bl.period === 'pre' ? 1 : plan.preMonths + 1;
      var hi = bl.period === 'pre' ? Math.max(1, plan.preMonths) : Math.max(plan.preMonths + 1, plan.preMonths + plan.postMonths);
      bl.autoMonth = lo + Math.round((hi - lo) * (k + 1) / (m + 1));
      bl.monthIsAuto = bl.month === null;
      if (bl.month === null) bl.month = bl.autoMonth;
      bl.dateLabel = monthLabel(bl.month, bookingDate);
    });

    var lockedSum = 0, lockedPostSum = 0, unlocked = [];
    balloons.forEach(function (bl) {
      if (bl.locked) {
        lockedSum += bl.amount;
        if (bl.period === 'post') lockedPostSum += bl.amount;
      } else unlocked.push(bl);
    });

    var fixedPart = down + preInst + postInst + otherPre + otherPost + lockedSum;
    var remainder = final - fixedPart;

    if (unlocked.length) {
      if (remainder >= 0) {
        var each = Math.floor(remainder / unlocked.length);
        unlocked.forEach(function (bl, idx) {
          bl.amount = (idx === unlocked.length - 1) ? remainder - each * (unlocked.length - 1) : each;
        });
      } else {
        unlocked.forEach(function (bl) { bl.amount = 0; });
      }
    }

    var balloonPre = 0, balloonPost = 0;
    balloons.forEach(function (bl) {
      if (bl.period === 'post') balloonPost += bl.amount; else balloonPre += bl.amount;
    });

    // ---- totals / accounting ---------------------------------------------
    var scheduledTotal = down + preInst + postInst + balloonPre + balloonPost + otherPre + otherPost;
    var diff = scheduledTotal - final; // + overpaid, - uncovered

    var pre = {
      down: down, installments: preInst, balloons: balloonPre, other: otherPre,
      total: down + preInst + balloonPre + otherPre
    };
    pre.remainingAfterDown = pre.total - down;
    var post = {
      installments: postInst, balloons: balloonPost, other: otherPost,
      total: postInst + balloonPost + otherPost
    };

    // ---- validation -------------------------------------------------------
    var preAvailable = final - postInst - lockedPostSum - otherPost;
    if (down > final) {
      errors.push('Down payment (PKR ' + fmt(down) + ') is more than the property price.');
    } else if (down > preAvailable + TOLERANCE) {
      errors.push('Down payment (PKR ' + fmt(down) + ') is more than the PKR ' + fmt(Math.max(0, preAvailable)) +
        ' available before possession.');
    }
    if (inst.mode !== 'manual' || monthly > 0) {
      if (preInst + postInst > final - down - lockedSum - otherPre - otherPost + TOLERANCE && diff > TOLERANCE) {
        errors.push('Monthly installments (PKR ' + fmt(preInst + postInst) + ' in total) are more than the balance they can cover.');
      }
    }
    if (preInst > 0 && startOffset + preCount - 1 > plan.preMonths) {
      warnings.push('Installments run past the possession month (month ' + plan.preMonths + ').');
    }

    var status;
    if (diff > TOLERANCE) {
      status = 'overpaid';
      errors.push('Overpaid by PKR ' + fmt(diff) + '. Total payments are more than the property price.');
    } else if (diff < -TOLERANCE) {
      status = 'incomplete';
      errors.push('Uncovered balance of PKR ' + fmt(-diff) + '. Edit a balloon or the installments so the plan adds up.');
    } else if (errors.length) {
      status = 'invalid';
    } else {
      status = 'valid';
    }

    // ---- schedule rows (for display / summary) ---------------------------
    var rows = [];
    if (down > 0) rows.push({ kind: 'down', period: 'pre', label: 'Down payment', count: 1, amount: down, total: down });
    if (preCount > 0 && monthly > 0) {
      rows.push({
        kind: 'installments', period: 'pre', label: 'Installments before possession', count: preCount,
        amount: monthly, total: preInst, from: startOffset, to: startOffset + preCount - 1,
        fromLabel: monthLabel(startOffset, bookingDate), toLabel: monthLabel(startOffset + preCount - 1, bookingDate)
      });
    }
    if (postCount > 0 && monthly > 0) {
      rows.push({
        kind: 'installments', period: 'post', label: 'Installments after possession', count: postCount,
        amount: monthly, total: postInst, from: plan.preMonths + 1, to: plan.preMonths + postCount,
        fromLabel: monthLabel(plan.preMonths + 1, bookingDate), toLabel: monthLabel(plan.preMonths + postCount, bookingDate)
      });
    }
    balloons.forEach(function (bl) {
      rows.push({
        kind: 'balloon', period: bl.period, label: 'Balloon ' + bl.index, count: 1, amount: bl.amount,
        total: bl.amount, month: bl.month, dateLabel: bl.dateLabel, locked: bl.locked
      });
    });

    result.status = status;
    result.valid = status === 'valid';
    result.discount = discount;
    result.final = final;
    result.down = down;
    result.monthly = monthly;
    result.preCount = preCount;
    result.postCount = postCount;
    result.startOffset = startOffset;
    result.balloons = balloons;
    result.rows = rows;
    result.pre = pre;
    result.post = post;
    result.installmentsTotal = preInst + postInst;
    result.balloonsTotal = balloonPre + balloonPost;
    result.otherTotal = otherPre + otherPost;
    result.scheduledTotal = scheduledTotal;
    result.difference = diff;
    result.shortfall = diff < -TOLERANCE ? -diff : 0;
    result.excess = diff > TOLERANCE ? diff : 0;
    result.preAvailable = preAvailable;
    return result;
  }

  function fmt(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  return {
    calculate: calculate,
    normalizePlan: normalizePlan,
    sizeTimesRate: sizeTimesRate,
    pctOf: pctOf,
    monthLabel: monthLabel,
    fmt: fmt,
    TOLERANCE: TOLERANCE
  };
});
