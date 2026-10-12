/*
 * MGC Jewel Calculator: user interface.
 * All money maths lives in engine.js; this file only reads inputs, calls the
 * engine and draws the result. Everything is stored on this device only.
 */
(function () {
  'use strict';

  var E = window.JewelEngine;
  var D = window.JEWEL_DEFAULTS;
  var LS_SETTINGS = 'mgc.jewel.settings.v1';
  var LS_STATE = 'mgc.jewel.state.v1';

  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function num(s) { var n = parseFloat(String(s == null ? '' : s).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function pkr(n) { return 'PKR ' + E.fmt(n); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ------------------------------------------------------------------ *
   * Settings (plans + rate table)
   * ------------------------------------------------------------------ */
  function loadSettings() {
    var s = loadJSON(LS_SETTINGS) || {};
    var out = { plans: {}, rates: Array.isArray(s.rates) ? s.rates : clone(D.rates) };
    ['1', '2'].forEach(function (t) {
      out.plans[t] = Object.assign({}, D.plans[t], (s.plans && s.plans[t]) || {});
    });
    return out;
  }
  var settings = loadSettings();
  function saveSettings() { saveJSON(LS_SETTINGS, settings); }
  function plan() { return settings.plans[state.tower]; }

  /* ------------------------------------------------------------------ *
   * Working state (the current calculation)
   * ------------------------------------------------------------------ */
  function blankState() {
    return {
      tower: '1', type: 'Apartment', floor: '', unitId: '', locNote: '',
      size: '', rate: '', rateSource: 'manual',
      discOn: false, discType: 'percent', discVal: '',
      downOn: false, downType: 'percent', downVal: '',
      instMode: 'percent', instManual: '', instOverride: '',
      preCount: '', postCount: '', bookingDate: '', startOffset: '',
      balloons: []
    };
  }
  var state = Object.assign(blankState(), loadJSON(LS_STATE) || {});
  if (state.tower !== '1' && state.tower !== '2') state.tower = '1';

  function syncBalloons() {
    var n = E.normalizePlan(plan()).balloons;
    while (state.balloons.length < n) state.balloons.push({ amount: '', period: '', month: '' });
    if (state.balloons.length > n) state.balloons.length = n;
  }

  function buildInput() {
    return {
      sizeSqft: num(state.size),
      rate: num(state.rate),
      discount: { enabled: state.discOn, type: state.discType, value: num(state.discVal) },
      down: { enabled: state.downOn, type: state.downType, value: num(state.downVal) },
      installment: { mode: state.instMode, manual: num(state.instManual), override: state.instOverride === '' ? null : num(state.instOverride) },
      preCount: state.preCount === '' ? null : num(state.preCount),
      postCount: state.postCount === '' ? null : num(state.postCount),
      booking: { date: state.bookingDate, startOffset: state.startOffset === '' ? null : num(state.startOffset) },
      balloons: state.balloons.map(function (b) {
        return { amount: b.amount === '' ? null : num(b.amount), period: b.period || null, month: b.month === '' ? null : num(b.month) };
      })
    };
  }

  /* ------------------------------------------------------------------ *
   * Input formatting (live thousands separators, caret preserved)
   * ------------------------------------------------------------------ */
  function liveFormat(el) {
    var kind = el.dataset.fmt;
    var pos = el.selectionStart == null ? el.value.length : el.selectionStart;
    var keep = /[\d.]/;
    var before = el.value.slice(0, pos).split('').filter(function (c) { return keep.test(c); }).length;
    var raw = el.value.replace(kind === 'int' ? /[^\d]/g : /[^\d.]/g, '');
    var out;
    if (kind === 'int') {
      out = raw.replace(/^0+(?=\d)/, '');
    } else {
      var parts = raw.split('.');
      var intPart = parts[0].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      out = parts.length > 1 ? (intPart || '0') + '.' + parts.slice(1).join('').slice(0, 2) : intPart;
    }
    el.value = out;
    var count = 0, i = 0;
    for (; i < out.length && count < before; i++) if (keep.test(out[i])) count++;
    try { el.setSelectionRange(i, i); } catch (e) { /* not supported for this input type */ }
  }

  /* ------------------------------------------------------------------ *
   * Rate table
   * ------------------------------------------------------------------ */
  function findRate() {
    var f = String(state.floor).trim().toLowerCase();
    if (!f) return null;
    for (var i = 0; i < settings.rates.length; i++) {
      var r = settings.rates[i];
      if (String(r.tower) !== state.tower) continue;
      if (String(r.floor).trim().toLowerCase() !== f) continue;
      if (r.type && r.type !== 'Any' && r.type !== state.type) continue;
      var v = num(r.rate);
      if (v > 0) return v;
    }
    return null;
  }
  function fmtInputNumber(n) {
    var s = String(n);
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }
  function applyTableRate() {
    var found = findRate();
    if (found !== null) {
      state.rate = fmtInputNumber(found);
      state.rateSource = 'table';
    } else if (state.rateSource === 'table') {
      state.rate = '';
      state.rateSource = 'manual';
    }
    $('rate').value = state.rate;
  }
  function refreshFloorList() {
    var seen = {}, html = '';
    settings.rates.forEach(function (r) {
      if (String(r.tower) !== state.tower || !String(r.floor).trim() || seen[r.floor]) return;
      seen[r.floor] = 1;
      html += '<option value="' + esc(r.floor) + '"></option>';
    });
    $('floorList').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */
  var last = null;

  function setSeg(id, attr, value) {
    var btns = $(id).querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-checked', String(btns[i].dataset[attr] === value));
    }
  }

  function writeInputs() {
    ['floor', 'unitId', 'locNote', 'size', 'rate', 'discVal', 'downVal', 'instManual', 'instOverride', 'preCount', 'postCount', 'bookingDate', 'startOffset']
      .forEach(function (k) { $(k).value = state[k]; });
    $('discOn').checked = state.discOn;
    $('downOn').checked = state.downOn;
    setSeg('towerSeg', 'tower', state.tower);
    setSeg('typeSeg', 'type', state.type);
    setSeg('discSeg', 'v', state.discType);
    setSeg('downSeg', 'v', state.downType);
    setSeg('instSeg', 'v', state.instMode);
  }

  function render() {
    syncBalloons();
    var p = plan();
    var np = E.normalizePlan(p);
    var r = E.calculate(buildInput(), p);
    last = r;

    // plan summary + dynamic labels
    $('planLine').textContent = np.preMonths + ' months before possession, ' + np.postMonths + ' after (' +
      (np.preMonths + np.postMonths) + ' in total). ' + np.balloons + ' balloon payments.';
    $('instPctBtn').textContent = np.installmentPercent + '% plan';
    $('preCount').placeholder = String(np.preMonths);
    $('postCount').placeholder = String(np.postMonths);
    $('startOffset').placeholder = '1';
    $('preCountLabel').textContent = 'Installments before possession (standard ' + np.preMonths + ')';
    $('postCountLabel').textContent = 'Installments after possession (standard ' + np.postMonths + ')';
    $('discBox').hidden = !state.discOn;
    $('downBox').hidden = !state.downOn;
    $('discLabel').textContent = state.discType === 'percent' ? 'Discount (% of base price)' : 'Discount (PKR)';
    $('downLabel').textContent = state.downType === 'percent' ? 'Down payment (% of final price)' : 'Down payment (PKR)';
    $('instPctBox').hidden = state.instMode !== 'percent';
    $('instManualBox').hidden = state.instMode !== 'manual';
    $('instStd').textContent = pkr(E.pctOf(r.final, np.installmentPercent)) + ' (' + np.installmentPercent + '% of the final price)';
    $('balloonHint').textContent = 'Balloons cover whatever the down payment and installments leave. Type an amount to lock a balloon; the unlocked balloons adjust so the total stays correct.';

    renderRateHint();
    renderResults(r);
    renderBalloons(r);
    saveJSON(LS_STATE, state);
  }

  function renderRateHint() {
    var h = $('rateHint');
    var towerRows = settings.rates.filter(function (x) { return String(x.tower) === state.tower; }).length;
    if (state.rateSource === 'table' && state.rate) {
      h.textContent = 'Rate filled from your rate table for this floor. You can still change it.';
      h.hidden = false;
    } else if (towerRows && String(state.floor).trim() && !findRate()) {
      h.textContent = 'No table rate for this floor and unit type. Enter the rate yourself.';
      h.hidden = false;
    } else {
      h.hidden = true;
    }
  }

  function locationText() {
    var t = (plan().name || ('Tower ' + state.tower));
    var s = 'Jewel, ' + t;
    if (state.locNote.trim()) return s + ', ' + state.locNote.trim();
    if (state.floor.trim()) s += ', Floor ' + state.floor.trim();
    if (state.unitId.trim()) s += ', Unit ' + state.unitId.trim();
    return s;
  }

  function renderResults(r) {
    var empty = r.status === 'empty';
    var st = $('status');
    st.className = 'status';
    if (empty) {
      st.classList.add('empty');
      st.textContent = 'Enter the unit size and the rate per sq ft to see the payment plan.';
    } else if (r.valid) {
      st.classList.add('valid');
      st.textContent = 'Plan reconciles. Scheduled payments equal the property price.';
    } else {
      st.classList.add('bad');
      st.textContent = 'This plan does not add up yet. Fix the items below before quoting it.';
    }

    $('rTotal').textContent = empty ? '—' : pkr(r.final);
    $('rMonthly').textContent = empty ? '—' : pkr(r.monthly);
    $('rDownRow').hidden = !(r.down > 0);
    $('rDown').textContent = pkr(r.down);
    $('rDiscRow').hidden = !(r.discount > 0);
    $('rDisc').textContent = pkr(r.discount);
    var size = num(state.size);
    $('rSize').textContent = size > 0 ? fmtInputNumber(size) + ' sq ft' : '—';
    $('rType').textContent = state.type;
    $('rLoc').textContent = locationText();

    var pr = $('problems');
    var html = '';
    r.errors.forEach(function (m) { html += '<div class="problem">' + esc(m) + '</div>'; });
    r.warnings.forEach(function (m) { html += '<div class="problem warn">' + esc(m) + '</div>'; });
    pr.innerHTML = html;
    pr.hidden = !html;

    $('breakdownBody').innerHTML = empty ? '<p class="bd-note">The schedule appears here once the size and rate are entered.</p>' : breakdownHTML(r);

    // phone dock
    var dock = $('dock');
    dock.hidden = empty;
    $('dockTotal').textContent = empty ? '' : pkr(r.final);
    $('dockMonthly').textContent = empty ? '' : pkr(r.monthly);
    var ds = $('dockState');
    ds.className = 'dock-state ' + (r.valid ? 'ok' : 'bad');
    ds.textContent = r.valid ? 'Reconciles' : 'Check plan';
  }

  function row(label, value, cls) {
    return '<div class="bd-row ' + (cls || '') + '"><span>' + esc(label) + '</span><span>' + esc(value) + '</span></div>';
  }

  function breakdownHTML(r) {
    var b = state.bookingDate;
    var h = '';
    var inst = r.rows.filter(function (x) { return x.kind === 'installments'; });

    h += '<div class="bd-group"><h4>Installments</h4>';
    h += row('Monthly installment', pkr(r.monthly));
    var preRow = inst.filter(function (x) { return x.period === 'pre'; })[0];
    var postRow = inst.filter(function (x) { return x.period === 'post'; })[0];
    h += row('Before possession', r.preCount + ' installments' + (preRow ? ' (' + preRow.fromLabel + ' to ' + preRow.toLabel + ')' : ''));
    h += row('After possession', r.postCount + ' installments' + (postRow ? ' (' + postRow.fromLabel + ' to ' + postRow.toLabel + ')' : ''));
    h += row('Installments in total', r.preCount + r.postCount + ' = ' + pkr(r.installmentsTotal));
    h += '</div>';

    h += '<div class="bd-group"><h4>Possession</h4>';
    h += row('Possession milestone', 'After month ' + r.possessionMonth + (b ? ' (' + E.monthLabel(r.possessionMonth, b) + ')' : ''));
    h += row('Plan length', (r.plan.preMonths + r.plan.postMonths) + ' months (' + r.plan.preMonths + ' + ' + r.plan.postMonths + ')');
    h += '</div>';

    h += '<div class="bd-group"><h4>Balloons (' + r.balloons.length + ')</h4>';
    r.balloons.forEach(function (bl) {
      h += row('Balloon ' + bl.index + ', ' + (bl.period === 'pre' ? 'before' : 'after') + ' possession, ' + bl.dateLabel + (bl.locked ? ', locked' : ''), pkr(bl.amount));
    });
    h += row('Balloons in total', pkr(r.balloonsTotal), 'sum');
    h += '</div>';

    h += '<div class="bd-group"><h4>Before possession</h4>';
    if (r.down > 0) h += row('Down payment', pkr(r.down));
    h += row('Installments', pkr(r.pre.installments));
    h += row('Balloons', pkr(r.pre.balloons));
    if (r.pre.other) h += row('Other payments', pkr(r.pre.other));
    h += row('Due before possession', pkr(r.pre.total), 'sum');
    if (r.down > 0) h += row('Remaining after the down payment', pkr(r.pre.remainingAfterDown));
    h += '</div>';

    h += '<div class="bd-group"><h4>After possession</h4>';
    h += row('Installments', pkr(r.post.installments));
    h += row('Balloons', pkr(r.post.balloons));
    if (r.post.other) h += row('Other payments', pkr(r.post.other));
    h += row('Due after possession', pkr(r.post.total), 'sum');
    h += '</div>';

    h += '<div class="bd-group"><h4>Validation</h4>';
    h += row('Final property price', pkr(r.final));
    h += row('Scheduled payments', pkr(r.scheduledTotal));
    if (r.valid) {
      h += row('Difference', 'PKR ' + E.fmt(Math.abs(r.difference)) + ' (within PKR ' + E.TOLERANCE + ')', 'ok');
      h += row('Result', 'Reconciles', 'ok');
    } else if (r.excess) {
      h += row('Excess', pkr(r.excess), 'bad');
      h += row('Result', 'Overpaid', 'bad');
    } else if (r.shortfall) {
      h += row('Shortfall', pkr(r.shortfall), 'bad');
      h += row('Result', 'Balance not covered', 'bad');
    } else {
      h += row('Result', 'Inputs need fixing', 'bad');
    }
    h += '</div>';
    return h;
  }

  function renderBalloons(r) {
    var list = $('balloonList');
    var act = document.activeElement;
    var keep = null;
    if (act && list.contains(act) && act.dataset && act.dataset.key) {
      keep = { key: act.dataset.key, i: act.dataset.i, s: act.selectionStart, e: act.selectionEnd };
    }
    var empty = r.status === 'empty';
    var html = '';
    var shown = r.balloons.length ? r.balloons : [];
    if (!shown.length) {
      // before a size and rate exist the engine returns no balloons; draw the rows from state so they can be set up
      var np = E.normalizePlan(plan());
      shown = state.balloons.map(function (b, i) {
        return { index: i + 1, locked: b.amount !== '', amount: num(b.amount), period: b.period || (i < np.balloonsPre ? 'pre' : 'post'), month: b.month === '' ? '' : num(b.month), autoMonth: '', dateLabel: '' };
      });
    }
    shown.forEach(function (bl, i) {
      var s = state.balloons[i] || { amount: '', period: '', month: '' };
      var amountVal = bl.locked ? s.amount : (empty ? '' : fmtInputNumber(bl.amount));
      html += '<div class="b-row ' + (bl.locked ? 'locked' : '') + '">' +
        '<div class="b-head"><strong>Balloon ' + bl.index + '</strong><span class="tag ' + (bl.locked ? 'locked' : 'auto') + '">' + (bl.locked ? 'Locked' : 'Automatic') + '</span></div>' +
        '<label class="field b-amt"><span>Amount (PKR)</span><input type="text" inputmode="decimal" data-fmt="dec" data-key="amount" data-i="' + i + '" value="' + esc(amountVal) + '" placeholder="0"></label>' +
        '<label class="field"><span>Timing</span><select data-key="period" data-i="' + i + '">' +
          '<option value="pre"' + (bl.period === 'pre' ? ' selected' : '') + '>Before possession</option>' +
          '<option value="post"' + (bl.period === 'post' ? ' selected' : '') + '>After possession</option></select></label>' +
        '<label class="field"><span>Due month</span><input type="text" inputmode="numeric" data-fmt="int" data-key="month" data-i="' + i + '" value="' + esc(s.month) + '" placeholder="' + esc(bl.autoMonth === undefined ? '' : bl.autoMonth) + '"></label>' +
        '<div class="b-date">' + esc(bl.dateLabel || '') + '</div>' +
        (bl.locked ? '<div class="b-actions"><button type="button" class="btn small" data-act="unlock" data-i="' + i + '">Unlock and let it adjust</button></div>' : '') +
        '</div>';
    });
    list.innerHTML = html;
    if (keep) {
      var el = list.querySelector('[data-key="' + keep.key + '"][data-i="' + keep.i + '"]');
      if (el) {
        el.focus();
        try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* select has no selection */ }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Events: main form
   * ------------------------------------------------------------------ */
  var simple = ['floor', 'unitId', 'locNote', 'size', 'rate', 'discVal', 'downVal', 'instManual', 'instOverride', 'preCount', 'postCount', 'bookingDate', 'startOffset'];
  simple.forEach(function (k) {
    $(k).addEventListener('input', function () {
      if (this.dataset.fmt) liveFormat(this);
      state[k] = this.value;
      if (k === 'rate') state.rateSource = 'manual';
      if (k === 'floor') applyTableRate();
      render();
    });
  });

  function segHandler(id, attr, onPick) {
    $(id).addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      onPick(btn.dataset[attr]);
      setSeg(id, attr, btn.dataset[attr]);
      render();
    });
  }
  segHandler('towerSeg', 'tower', function (v) {
    if (v === state.tower) return;
    state.tower = v;
    state.balloons = [];
    state.preCount = ''; state.postCount = '';
    $('preCount').value = ''; $('postCount').value = '';
    refreshFloorList();
    applyTableRate();
  });
  segHandler('typeSeg', 'type', function (v) { state.type = v; applyTableRate(); });
  segHandler('discSeg', 'v', function (v) { state.discType = v; });
  segHandler('downSeg', 'v', function (v) { state.downType = v; });
  segHandler('instSeg', 'v', function (v) { state.instMode = v; });

  $('discOn').addEventListener('change', function () { state.discOn = this.checked; render(); });
  $('downOn').addEventListener('change', function () { state.downOn = this.checked; render(); });

  // balloons (delegated, because the rows are redrawn)
  var bl = $('balloonList');
  bl.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.dataset || !el.dataset.key || el.tagName === 'SELECT') return;
    if (el.dataset.fmt) liveFormat(el);
    state.balloons[+el.dataset.i][el.dataset.key] = el.value;
    render();
  });
  bl.addEventListener('change', function (e) {
    var el = e.target;
    if (el.tagName !== 'SELECT') return;
    state.balloons[+el.dataset.i].period = el.value;
    render();
  });
  bl.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act="unlock"]');
    if (!btn) return;
    state.balloons[+btn.dataset.i].amount = '';
    render();
  });
  $('resetBalloons').addEventListener('click', function () {
    state.balloons = [];
    render();
    toast('Balloons reset to automatic amounts');
  });

  $('clearAll').addEventListener('click', function () {
    if (!window.confirm('Clear this calculation? Your settings and rate table are kept.')) return;
    var tower = state.tower;
    state = blankState();
    state.tower = tower;
    writeInputs();
    refreshFloorList();
    render();
    window.scrollTo({ top: 0 });
  });

  // keep the form from submitting on Enter
  $('form').addEventListener('submit', function (e) { e.preventDefault(); });

  /* ------------------------------------------------------------------ *
   * Summary: copy / share
   * ------------------------------------------------------------------ */
  function summaryText() {
    var r = last;
    var lines = [];
    lines.push('MGC Jewel payment plan');
    lines.push('Unit: ' + locationText() + ' (' + state.type + ')');
    lines.push('Size: ' + fmtInputNumber(num(state.size)) + ' sq ft');
    lines.push('Total property amount: ' + pkr(r.final));
    if (r.discount > 0) lines.push('Discount: ' + pkr(r.discount));
    if (r.down > 0) lines.push('Down payment: ' + pkr(r.down));
    lines.push('Monthly installment: ' + pkr(r.monthly));
    lines.push('Installments: ' + r.preCount + ' before possession, ' + r.postCount + ' after possession');
    lines.push('Balloon payments:');
    r.balloons.forEach(function (b) {
      lines.push('  ' + b.index + '. ' + pkr(b.amount) + ', ' + b.dateLabel + ' (' + (b.period === 'pre' ? 'before' : 'after') + ' possession)');
    });
    return lines.join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); } finally { document.body.removeChild(ta); }
    });
  }

  function requireValid() {
    if (!last || last.valid) return true;
    toast(last.status === 'empty' ? 'Enter the unit size and rate first' : 'Fix the plan before copying it');
    return false;
  }
  $('copyBtn').addEventListener('click', function () {
    if (!requireValid()) return;
    copyText(summaryText()).then(function () { toast('Summary copied'); }, function () { toast('Could not copy. Select the text and copy it manually.'); });
  });
  if (navigator.share) {
    $('shareBtn').hidden = false;
    $('shareBtn').addEventListener('click', function () {
      if (!requireValid()) return;
      navigator.share({ title: 'MGC Jewel payment plan', text: summaryText() }).catch(function () { /* cancelled */ });
    });
  }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ------------------------------------------------------------------ *
   * Settings dialog
   * ------------------------------------------------------------------ */
  function planEditorHTML() {
    var h = '';
    ['1', '2'].forEach(function (t) {
      var p = settings.plans[t];
      var total = num(p.preMonths) + num(p.postMonths);
      h += '<div class="plan-card" data-tower="' + t + '"><h3>Tower ' + t + ' <span class="hint">(' + total + ' months in total)</span></h3><div class="plan-fields">' +
        planField(t, 'preMonths', 'Months before possession', p.preMonths) +
        planField(t, 'postMonths', 'Months after possession', p.postMonths) +
        planField(t, 'balloons', 'Number of balloons', p.balloons) +
        planField(t, 'balloonsPre', 'Balloons before possession (default)', p.balloonsPre) +
        planField(t, 'installmentPercent', 'Installment (% of final price)', p.installmentPercent) +
        '</div></div>';
    });
    return h;
  }
  function planField(t, key, label, value) {
    return '<label class="field"><span>' + label + '</span><input type="text" inputmode="decimal" data-plan="' + t + '" data-pk="' + key + '" value="' + esc(value) + '"></label>';
  }
  function rateEditorHTML() {
    if (!settings.rates.length) return '<div class="empty-note">No rates yet. Until you add them, enter the rate by hand on the main screen.</div>';
    return settings.rates.map(function (r, i) {
      return '<div class="rate-row">' +
        '<label class="field"><span>Tower</span><select data-ri="' + i + '" data-rk="tower"><option value="1"' + (String(r.tower) === '1' ? ' selected' : '') + '>Tower 1</option><option value="2"' + (String(r.tower) === '2' ? ' selected' : '') + '>Tower 2</option></select></label>' +
        '<label class="field"><span>Floor</span><input type="text" data-ri="' + i + '" data-rk="floor" value="' + esc(r.floor) + '"></label>' +
        '<label class="field"><span>Unit type</span><select data-ri="' + i + '" data-rk="type">' +
          ['Apartment', 'Shop', 'Any'].map(function (ty) { return '<option' + (r.type === ty ? ' selected' : '') + '>' + ty + '</option>'; }).join('') + '</select></label>' +
        '<label class="field"><span>Rate per sq ft (PKR)</span><input type="text" inputmode="decimal" data-fmt="dec" data-ri="' + i + '" data-rk="rate" value="' + esc(r.rate === '' || r.rate == null ? '' : fmtInputNumber(r.rate)) + '"></label>' +
        '<button type="button" class="btn small danger rate-del" data-del="' + i + '">Remove</button></div>';
    }).join('');
  }
  function openSettings() {
    $('planEditor').innerHTML = planEditorHTML();
    $('rateEditor').innerHTML = rateEditorHTML();
    var d = $('settings');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  $('settingsBtn').addEventListener('click', openSettings);
  $('settings').addEventListener('close', function () { refreshFloorList(); applyTableRate(); render(); });

  $('planEditor').addEventListener('input', function (e) {
    var el = e.target;
    if (!el.dataset.plan) return;
    var v = num(el.value);
    var key = el.dataset.pk;
    if (key !== 'installmentPercent') v = Math.max(0, Math.round(v));
    settings.plans[el.dataset.plan][key] = v;
    saveSettings();
    if (key === 'preMonths' || key === 'postMonths') {
      var p = settings.plans[el.dataset.plan];
      var h = el.closest('.plan-card').querySelector('h3 .hint');
      if (h) h.textContent = '(' + (num(p.preMonths) + num(p.postMonths)) + ' months in total)';
    }
    render();
  });

  $('rateEditor').addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.ri === undefined || el.tagName === 'SELECT') return;
    if (el.dataset.fmt) liveFormat(el);
    settings.rates[+el.dataset.ri][el.dataset.rk] = el.dataset.rk === 'rate' ? num(el.value) : el.value;
    saveSettings();
  });
  $('rateEditor').addEventListener('change', function (e) {
    var el = e.target;
    if (el.tagName !== 'SELECT' || el.dataset.ri === undefined) return;
    settings.rates[+el.dataset.ri][el.dataset.rk] = el.value;
    saveSettings();
  });
  $('rateEditor').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-del]');
    if (!b) return;
    settings.rates.splice(+b.dataset.del, 1);
    saveSettings();
    $('rateEditor').innerHTML = rateEditorHTML();
  });
  $('addRate').addEventListener('click', function () {
    settings.rates.push({ tower: state.tower, floor: '', type: state.type, rate: '' });
    saveSettings();
    $('rateEditor').innerHTML = rateEditorHTML();
    var rows = $('rateEditor').querySelectorAll('.rate-row');
    var inp = rows[rows.length - 1].querySelector('input');
    if (inp) inp.focus();
  });
  $('resetSettings').addEventListener('click', function () {
    if (!window.confirm('Restore the default plans and remove all saved rates?')) return;
    settings = { plans: clone(D.plans), rates: clone(D.rates) };
    saveSettings();
    $('planEditor').innerHTML = planEditorHTML();
    $('rateEditor').innerHTML = rateEditorHTML();
  });

  /* ------------------------------------------------------------------ *
   * PWA: service worker + install button
   * ------------------------------------------------------------------ */
  var deferredPrompt = null;
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!standalone) { $('installBtn').hidden = false; $('installHelp').hidden = true; }
  });
  $('installBtn').addEventListener('click', function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () { deferredPrompt = null; $('installBtn').hidden = true; });
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    $('installBtn').hidden = true;
    $('installHelp').hidden = true;
    toast('App installed');
  });
  if (!standalone) {
    // Not every browser exposes an install prompt, so show the manual route unless one appears.
    setTimeout(function () { if (!deferredPrompt) $('installHelp').hidden = false; }, 2500);
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
    });
  }

  /* ------------------------------------------------------------------ *
   * Start
   * ------------------------------------------------------------------ */
  refreshFloorList();
  writeInputs();
  render();
})();
