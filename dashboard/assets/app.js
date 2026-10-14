/* Dr.Orn IT Helpdesk Dashboard - VISUAL PROTOTYPE
   อ่านข้อมูลจาก window.DashboardData.load() เท่านั้น (ในรอบนี้คือ mock-data.js ซึ่งเป็นข้อมูลจำลอง)
   ไม่มีการเรียก API/เครือข่ายเพื่อข้อมูล (มีเพียง Google Fonts ใน index.html) ไม่มี Secret / Token / Spreadsheet ID ในไฟล์นี้ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var HOUR = 3600000, MIN = 60000, DAY = 86400000;
  var TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  var D = null;                                   // loaded data
  var CLK = null;                                 // SLA clock built from D (slaClock below)
  var OFF = 7 * HOUR;
  var PAGES = {                                   // one page per left-menu item; each page offers only the filters that make sense for it
    overview:     { name: 'Overview',            fields: ['date', 'branch', 'priority'] },
    analytics:    { name: 'Ticket Analytics',    fields: ['date', 'branch', 'priority', 'category'] },
    sla:          { name: 'SLA & Performance',   fields: ['date', 'branch', 'priority', 'category'] },
    satisfaction: { name: 'Customer Satisfaction', fields: ['date', 'branch', 'priority', 'category'] },
    tickets:      { name: 'Ticket List',         fields: ['date', 'branch', 'status', 'priority', 'category', 'q'] }
  };
  var PAGE_IDS = ['overview', 'analytics', 'sla', 'satisfaction', 'tickets'];
  var FKEYS = ['preset', 'from', 'to', 'branch', 'status', 'priority', 'category', 'q'];
  var FS = {};                                    // remembered filter values per page (pages never share or leak filters)
  var cur = 'overview';
  var state = { preset: 30, from: '', to: '', branch: '', status: '', priority: '', category: '', q: '', sortKey: 'createdAt', sortDir: -1, page: 1, view: 'normal' };
  var PAGE = 10;
  var lastFiltered = [];

  /* ---------- helpers ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function loc(ms) { return new Date(ms + OFF); }
  function ymd(ms) { var d = loc(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function dayStart(s) { var p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) - OFF; }
  function fmtDT(ms) { var d = loc(ms); return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function fmtD(ms) { var d = loc(ms); return d.getUTCDate() + ' ' + TH_MONTH[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function fmtDur(ms) {
    if (ms == null || isNaN(ms)) { return '—'; }
    var m = Math.round(ms / MIN);
    if (m < 60) { return m + ' m'; }
    var h = Math.floor(m / 60), r = m % 60;
    if (h < 24) { return h + ' h' + (r ? ' ' + r + ' m' : ''); }
    var d = Math.floor(h / 24), hh = h % 24;
    return d + ' d' + (hh ? ' ' + hh + ' h' : '');
  }
  function median(a) { if (!a.length) { return null; } var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : null; }
  function count(list, fn) { var n = 0; list.forEach(function (x) { if (fn(x)) { n++; } }); return n; }

  /* ---------- SLA clock ----------
     Same calendar maths as mock-data.js. The SLA clock runs from Claimed At, only inside working time unless the priority is '24x7',
     and is stopped while the ticket is Waiting. SLA Due / Response Due are STORED in the data; this clock is used to show the time
     left (Due Soon) and by the DEMO guard to check that the stored values are consistent. */
  function slaClock(data) {
    var S = data.workCalendar.startHour * HOUR, E = data.workCalendar.endHour * HOUR, days = data.workCalendar.days, off = data.tzOffsetMs;
    function nextOpen(t) {
      var l = t + off, di = Math.floor(l / DAY), tod = l - di * DAY;
      for (var g = 0; g < 400; g++) {
        if (days.indexOf(((4 + di) % 7 + 7) % 7) >= 0) {
          if (tod < S) { return di * DAY + S - off; }
          if (tod < E) { return di * DAY + tod - off; }
        }
        di++; tod = 0;
      }
      return t;
    }
    function addWork(start, ms) {
      var t = nextOpen(start);
      while (ms > 0) {
        var end = Math.floor((t + off) / DAY) * DAY + E - off, room = end - t;
        if (ms <= room) { return t + ms; }
        ms -= room; t = nextOpen(end);
      }
      return t;
    }
    function workBetween(a, b) {
      if (b <= a) { return 0; }
      var total = 0, t = nextOpen(a);
      while (t < b) { var end = Math.floor((t + off) / DAY) * DAY + E - off; total += Math.min(end, b) - t; t = nextOpen(end); }
      return total;
    }
    function add(p, start, ms) { return data.slaTargets[p].cal === '24x7' ? start + ms : addWork(start, ms); }
    function between(p, a, b) { return data.slaTargets[p].cal === '24x7' ? Math.max(0, b - a) : workBetween(a, b); }
    return {
      add: add, between: between,
      respDue: function (t) { return add(t.priority, t.createdAt, data.slaTargets[t.priority].respMin * MIN); },
      slaDue: function (t) {
        if (t.claimedAt === null) { return null; }
        var budget = data.slaTargets[t.priority].resMin * MIN;
        if (t.waitStartedAt === null) { return add(t.priority, t.claimedAt, budget); }
        var used = between(t.priority, t.claimedAt, t.waitStartedAt);
        if (used >= budget) { return add(t.priority, t.claimedAt, budget); }
        return add(t.priority, t.waitEndedAt !== null ? t.waitEndedAt : data.now, budget - used);      // still Waiting: as if it resumed now
      }
    };
  }
  function fmtTarget(min, p) {                      // "15 นาที" / "4 ชม.ทำการ" / "9 ชม.ทำการ (1 วันทำการ)"
    var work = D.slaTargets[p].cal !== '24x7', dayMin = (D.workCalendar.endHour - D.workCalendar.startHour) * 60;
    if (min < 60) { return min + ' นาที'; }
    var h = Math.round(min / 6) / 10, s = h + (work ? ' ชม.ทำการ' : ' ชม.');
    if (work && min >= dayMin && min % dayMin === 0) { s += ' (' + (min / dayMin) + ' วันทำการ)'; }
    return s;
  }
  function targetText(p) {
    var g = D.slaTargets[p];
    return 'เป้า Response ' + fmtTarget(g.respMin, p) + ' · Resolution ' + fmtTarget(g.resMin, p) + (g.cal === '24x7' ? ' · นับตลอด 24 ชม.' : '') + ' (demo)';
  }

  /* ---------- status / SLA metadata (colour + shape + text, never colour alone) ---------- */
  var ST = {
    'Open': { cls: 'open', v: '--s-open', rank: 0 },
    'In Progress': { cls: 'prog', v: '--s-prog', rank: 1 },
    'Waiting': { cls: 'wait', v: '--s-wait', rank: 2 },
    'Closed': { cls: 'closed', v: '--s-closed', rank: 3 }
  };
  var SLAM = {
    'Overdue': { cls: 'over', v: '--sla-over', rank: 0 },
    'Near Due': { cls: 'near', v: '--sla-near', rank: 1 },
    'On Time': { cls: 'ok', v: '--sla-ok', rank: 2 },
    'Met': { cls: 'ok', v: '--sla-ok', rank: 3 },
    'Missed': { cls: 'over', v: '--sla-over', rank: 4 },
    'Not Started': { cls: 'open', v: '--s-open', rank: 5 }
  };
  var PRI = { 'Low': { v: '--p-low', rank: 0 }, 'Medium': { v: '--p-med', rank: 1 }, 'High': { v: '--p-high', rank: 2 }, 'Critical': { v: '--p-crit', rank: 3 } };

  function icon(kind, v, size) {
    var p = {
      'Open': '<circle cx="8" cy="8" r="5.6"/>',
      'In Progress': '<circle cx="8" cy="8" r="5.6"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" stroke="none"/>',
      'Waiting': '<circle cx="8" cy="8" r="5.6"/><path d="M6.4 5.6v4.8M9.6 5.6v4.8"/>',
      'Closed': '<circle cx="8" cy="8" r="5.6"/><path d="M5.4 8.2l1.8 1.8 3.4-3.8"/>',
      'Overdue': '<path d="M8 2.2l6 10.6H2z"/><path d="M8 6.4v3M8 11.2v.1"/>',
      'Near Due': '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.8V8l2.2 1.4"/>',
      'On Time': '<path d="M3 8.4l3.2 3.2L13 4.6"/>',
      'Met': '<path d="M3 8.4l3.2 3.2L13 4.6"/>',
      'Missed': '<circle cx="8" cy="8" r="5.6"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>',
      'Not Started': '<circle cx="8" cy="8" r="5.6"/>'
    }[kind] || '';
    return '<svg class="sw" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(' + v + ');' + (size ? 'width:' + size + 'px;height:' + size + 'px' : '') + '">' + p + '</svg>';
  }

  function slaOf(t) {
    if (t.status === 'Closed') { return t.closedAt <= t.slaDue ? 'Met' : 'Missed'; }
    if (t.slaDue === null) { return 'Not Started'; }                          // not claimed yet: the SLA clock has not started
    if (D.now > t.slaDue) { return 'Overdue'; }
    if (CLK.between(t.priority, D.now, t.slaDue) <= 60 * MIN) { return 'Near Due'; }   // SLA time left (working time unless 24x7)
    return 'On Time';
  }

  /* ---------- tooltip ---------- */
  var tipEl = null, tipOn = false;
  function tipHtml(txt) {
    var parts = txt.split('|');
    var h = '<b>' + esc(parts[0]) + '</b>';
    parts.slice(1).forEach(function (l) {
      var m = /^~(.+?)~(.*)$/.exec(l);
      h += m ? '<div class="row"><i style="background:' + m[1] + '"></i><span>' + esc(m[2]) + '</span></div>' : '<div>' + esc(l) + '</div>';
    });
    return h;
  }
  function showTip(txt, x, y) {
    tipEl.innerHTML = tipHtml(txt); tipEl.hidden = false; tipOn = true; moveTip(x, y);
  }
  function moveTip(x, y) {
    if (!tipOn) { return; }
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    var left = x + 14, top = y + 14;
    if (left + w > vw - 8) { left = x - w - 14; }
    if (left < 8) { left = 8; }
    if (top + h > vh - 8) { top = y - h - 14; }
    if (top < 8) { top = 8; }
    tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
  }
  function hideTip() { tipOn = false; tipEl.hidden = true; }
  function initTips() {
    tipEl = $('#tip');
    document.addEventListener('pointerover', function (e) { var el = e.target.closest ? e.target.closest('[data-tip]') : null; if (el) { showTip(el.getAttribute('data-tip'), e.clientX, e.clientY); } });
    document.addEventListener('pointermove', function (e) { if (tipOn && e.target.closest && e.target.closest('[data-tip]')) { moveTip(e.clientX, e.clientY); } });
    document.addEventListener('pointerout', function (e) { var el = e.target.closest ? e.target.closest('[data-tip]') : null; if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) { hideTip(); } });
    document.addEventListener('focusin', function (e) { var el = e.target.closest ? e.target.closest('[data-tip]') : null; if (el) { var r = el.getBoundingClientRect(); showTip(el.getAttribute('data-tip'), r.left + r.width / 2, r.top); } });
    document.addEventListener('focusout', hideTip);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideTip(); } });
  }

  /* ---------- branch display labels (display only) ----------
     The English value stays the key used for filtering and stored in the data; only the text shown on screen is Thai. */
  var BRANCH_TH = { 'Phaholyothin': 'พหลโยธิน', 'Chidlom': 'ชิดลม', 'Ratchaphruek': 'ราชพฤกษ์', 'Rangsit': 'รังสิต', 'Ram Inthra': 'รามอินทรา', 'Emsphere': 'เอ็มสเฟียร์' };
  function branchLabel(b) {
    return BRANCH_TH[b] || String(b);
  }

  /* ---------- filtering ---------- */
  function filtered() {
    var from = dayStart(state.from), to = dayStart(state.to) + DAY;
    return D.tickets.filter(function (t) {
      return t.createdAt >= from && t.createdAt < to &&
        (!state.branch || t.branch === state.branch) &&
        (!state.status || t.status === state.status) &&
        (!state.priority || t.priority === state.priority) &&
        (!state.category || t.category === state.category) &&
        (!state.q || t.id.toLowerCase().indexOf(state.q.toLowerCase()) >= 0);
    });
  }

  /* ---------- KPI cards ---------- */
  function renderKpis(f) {
    var total = f.length;
    var by = { 'Open': 0, 'In Progress': 0, 'Waiting': 0, 'Closed': 0 };
    f.forEach(function (t) { by[t.status]++; });
    var breached = count(f, function (t) { return slaOf(t) === 'Overdue'; });
    var soon = count(f, function (t) { return slaOf(t) === 'Near Due'; });
    var wu = count(f, function (t) { return t.status === 'Waiting' && t.waitingReason === 'User'; });
    var wv = count(f, function (t) { return t.status === 'Waiting' && t.waitingReason === 'Vendor'; });
    var share = function (n) { return total ? pct(n, total) + '% ของทั้งหมด' : '—'; };
    var cards = [
      { c: 'total', l: 'Total Tickets', n: total, s: 'สร้างในช่วงวันที่ที่เลือก', i: '' },
      { l: 'Open', n: by['Open'], s: share(by['Open']) + ' · รอรับเรื่อง', i: icon('Open', ST['Open'].v) },
      { l: 'In Progress', n: by['In Progress'], s: share(by['In Progress']) + ' · กำลังดำเนินการ', i: icon('In Progress', ST['In Progress'].v) },
      { l: 'Waiting', n: by['Waiting'], s: 'รอ User ' + wu + ' · รอ Vendor ' + wv, i: icon('Waiting', ST['Waiting'].v) },
      { l: 'Closed', n: by['Closed'], s: share(by['Closed']) + ' · ปิดแล้ว', i: icon('Closed', ST['Closed'].v) },
      { l: 'SLA Breached', n: breached, s: 'รับเรื่องแล้ว ยังไม่ปิด และเกิน SLA Due', i: icon('Overdue', '--sla-over') },
      { l: 'SLA Due Soon', n: soon, s: 'รับเรื่องแล้ว ยังไม่ปิด และเวลา SLA เหลือ ≤ 60 นาที', i: icon('Near Due', '--sla-near') }
    ];
    $('#kpis').innerHTML = cards.map(function (c) {
      return '<div class="kpi ' + (c.c || '') + '"><div class="kpi-l">' + c.i + '<span>' + esc(c.l) + '</span></div><div class="kpi-n">' + c.n + '</div><div class="kpi-s">' + esc(c.s) + '</div></div>';
    }).join('');
  }

  /* ---------- generic bar rows ---------- */
  function barRows(rows, max, valFn, cls) {
    if (!rows.length) { return '<div class="empty-mini">ไม่มีข้อมูลในตัวกรองนี้</div>'; }
    return '<div class="bars">' + rows.map(function (r) {
      var w = max ? Math.max(0, r.value / max * 100) : 0;
      return '<div class="bar-row' + (cls ? ' ' + cls : '') + '" tabindex="0" data-tip="' + esc(r.tip) + '"><span class="name" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
        '<span class="track"><span class="fill" style="display:block;width:' + w + '%;background:' + r.color + '"></span></span>' +
        '<span class="val">' + (valFn ? valFn(r) : r.value) + '</span></div>';
    }).join('') + '</div>';
  }
  function dataTable(head, rows) {
    return '<details class="data"><summary>ดูข้อมูลเป็นตาราง</summary><table><thead><tr>' + head.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return i === 0 ? '<th scope="row">' + esc(c) + '</th>' : '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></details>';
  }

  /* ---------- status donut ---------- */
  function renderStatus(f) {
    var order = ['Open', 'In Progress', 'Waiting', 'Closed'];
    var by = {}; order.forEach(function (s) { by[s] = 0; }); f.forEach(function (t) { by[t.status]++; });
    var total = f.length, R = 62, C = 2 * Math.PI * R, off = 0, arcs = '';
    order.forEach(function (s) {
      var n = by[s]; if (!n) { return; }
      var len = n / total * C, gap = total > n ? 2.5 : 0;
      arcs += '<circle class="seg-arc" cx="85" cy="85" r="' + R + '" fill="none" stroke="var(' + ST[s].v + ')" stroke-width="24" stroke-dasharray="' + Math.max(0, len - gap) + ' ' + (C - Math.max(0, len - gap)) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 85 85)" tabindex="0" data-tip="' + esc(s + '|' + n + ' tickets (' + pct(n, total) + '%)') + '"/>';
      off += len;
    });
    if (!total) { arcs = '<circle cx="85" cy="85" r="' + R + '" fill="none" stroke="var(--line)" stroke-width="24"/>'; }
    $('#statusBody').innerHTML =
      '<div class="donut-wrap"><svg class="donut" viewBox="0 0 170 170" role="img" aria-label="Tickets by status">' + arcs +
      '<text x="85" y="84" text-anchor="middle" font-size="28" font-weight="700">' + total + '</text><text x="85" y="104" text-anchor="middle" font-size="12" style="fill:var(--ink-3)">tickets</text></svg>' +
      '<ul class="dl">' + order.map(function (s) { return '<li>' + icon(s, ST[s].v) + '<span>' + s + '</span><span><b>' + by[s] + '</b><small>' + (total ? pct(by[s], total) + '%' : '—') + '</small></span></li>'; }).join('') + '</ul></div>' +
      dataTable(['Status', 'Tickets', '%'], order.map(function (s) { return [s, by[s], total ? pct(by[s], total) + '%' : '—']; }));
  }

  /* ---------- by branch ---------- */
  function renderBranch(f) {
    var rows = D.branches.map(function (b) {
      var n = count(f, function (t) { return t.branch === b; });
      return { name: branchLabel(b), value: n, color: 'var(--brand)', tip: branchLabel(b) + '|' + n + ' tickets' + (f.length ? ' (' + pct(n, f.length) + '%)' : '') };
    }).sort(function (a, b) { return b.value - a.value; });
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    $('#branchBody').innerHTML = barRows(f.length ? rows : [], max, function (r) { return r.value + '<small> ' + (f.length ? Math.round(r.value / f.length * 100) + '%' : '') + '</small>'; }, 'nm') +
      dataTable(['Branch', 'Tickets'], rows.map(function (r) { return [r.name, r.value]; }));
  }

  /* ---------- by priority ---------- */
  function renderPriority(f) {
    var rows = D.priorities.slice().reverse().map(function (p) {
      var n = count(f, function (t) { return t.priority === p; });
      return { name: p, value: n, color: 'var(' + PRI[p].v + ')', tip: p + '|' + n + ' tickets' + (f.length ? ' (' + pct(n, f.length) + '%)' : '') + '|' + targetText(p) };
    });
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    $('#priorityBody').innerHTML = barRows(f.length ? rows : [], max, function (r) { return r.value; }) +
      '<div class="legend"><span>เรียงจาก Critical ไป Low · เข้มขึ้น = เร่งด่วนขึ้น</span></div>' +
      dataTable(['Priority', 'Tickets', 'Response target (demo)', 'Resolution target (demo)'], rows.map(function (r) { var g = D.slaTargets[r.name]; return [r.name, r.value, fmtTarget(g.respMin, r.name), fmtTarget(g.resMin, r.name) + (g.cal === '24x7' ? ' (24 ชม.)' : '')]; }));
  }

  /* ---------- category ---------- */
  function renderCategory(f) {
    var rows = D.categories.map(function (c) {
      var n = count(f, function (t) { return t.category === c; });
      return { name: c, value: n, color: 'var(--brand)', tip: c + '|' + n + ' tickets' + (f.length ? ' (' + pct(n, f.length) + '%)' : '') };
    }).sort(function (a, b) { return b.value - a.value; }).filter(function (r) { return r.value > 0; });
    var max = rows.length ? rows[0].value : 1;
    $('#categoryBody').innerHTML = barRows(rows, max, function (r) { return r.value + '<small> ' + Math.round(r.value / f.length * 100) + '%</small>'; }) +
      dataTable(['Category', 'Tickets'], rows.map(function (r) { return [r.name, r.value]; }));
  }

  /* ---------- waiting by reason ---------- */
  function renderWaiting(f) {
    var wu = count(f, function (t) { return t.status === 'Waiting' && t.waitingReason === 'User'; });
    var wv = count(f, function (t) { return t.status === 'Waiting' && t.waitingReason === 'Vendor'; });
    var rows = [
      { name: 'Waiting for User', value: wu, color: 'var(--s-wait)', tip: 'Waiting for User|' + wu + ' tickets (รอ User)' },
      { name: 'Waiting for Vendor', value: wv, color: 'var(--s-wait-2)', tip: 'Waiting for Vendor|' + wv + ' tickets (รอ Vendor)' }
    ];
    var max = Math.max(wu, wv, 1);
    $('#waitingBody').innerHTML = (wu + wv ? barRows(rows, max, function (r) { return r.value; }) : '<div class="empty-mini">ไม่มี Ticket สถานะ Waiting ในตัวกรองนี้</div>') +
      dataTable(['Waiting reason', 'Tickets'], rows.map(function (r) { return [r.name, r.value]; }));
  }

  /* ---------- trend (SVG, drawn to the container width) ---------- */
  var trendCache = null;
  function renderTrend(f) {
    var from = dayStart(state.from), to = dayStart(state.to), n = Math.round((to - from) / DAY) + 1;
    var created = [], closed = [], labels = [], i;
    for (i = 0; i < n; i++) { created.push(0); closed.push(0); labels.push(from + i * DAY); }
    f.forEach(function (t) {
      var a = Math.floor((t.createdAt - from) / DAY); if (a >= 0 && a < n) { created[a]++; }
      if (t.closedAt) { var b = Math.floor((t.closedAt - from) / DAY); if (b >= 0 && b < n) { closed[b]++; } }
    });
    trendCache = { created: created, closed: closed, labels: labels, n: n };
    drawTrend();
    $('#trendTable').innerHTML = dataTable(['Date', 'Created', 'Closed (ของ Ticket ที่สร้างในช่วง)'], labels.map(function (d, k) { return [ymd(d), created[k], closed[k]]; }));
  }
  function drawTrend() {
    if (!trendCache) { return; }
    var box = $('#trendBox'), w = Math.max(300, box.clientWidth), h = 250;
    var c = trendCache, L = 34, Rr = 12, T = 12, B = 26, n = c.n;
    var maxV = Math.max.apply(null, c.created.concat(c.closed).concat([1]));
    var step = maxV <= 5 ? 1 : maxV <= 10 ? 2 : maxV <= 25 ? 5 : 10, top = Math.ceil(maxV / step) * step;
    var X = function (k) { return n === 1 ? L + (w - L - Rr) / 2 : L + k * (w - L - Rr) / (n - 1); };
    var Y = function (v) { return T + (h - T - B) * (1 - v / top); };
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Tickets created and closed per day" preserveAspectRatio="none">';
    for (var g = 0; g <= top; g += step) { s += '<line class="grid-l" x1="' + L + '" x2="' + (w - Rr) + '" y1="' + Y(g) + '" y2="' + Y(g) + '"/><text x="' + (L - 6) + '" y="' + (Y(g) + 4) + '" text-anchor="end">' + g + '</text>'; }
    var every = Math.ceil(n / Math.max(2, Math.floor((w - L - Rr) / 62)));
    for (var k = 0; k < n; k += every) { var d = loc(c.labels[k]); s += '<text x="' + X(k) + '" y="' + (h - 7) + '" text-anchor="middle">' + d.getUTCDate() + ' ' + TH_MONTH[d.getUTCMonth()] + '</text>'; }
    var line = function (arr, col) { return '<path d="' + arr.map(function (v, k2) { return (k2 ? 'L' : 'M') + X(k2).toFixed(1) + ' ' + Y(v).toFixed(1); }).join('') + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'; };
    s += line(c.created, 'var(--brand)') + line(c.closed, 'var(--s-closed)');
    var dots = n <= 31;
    [[c.created, 'var(--brand)'], [c.closed, 'var(--s-closed)']].forEach(function (p) {
      p[0].forEach(function (v, k2) { if (dots || k2 === n - 1) { s += '<circle cx="' + X(k2).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="3" fill="' + p[1] + '" stroke="var(--surface)" stroke-width="2"/>'; } });
    });
    s += '<line class="cross" id="cross" x1="0" x2="0" y1="' + T + '" y2="' + (h - B) + '" style="display:none"/>';
    s += '<rect id="hit" x="' + L + '" y="0" width="' + (w - L - Rr) + '" height="' + h + '" fill="transparent"/></svg>';
    box.innerHTML = s;
    var hit = $('#hit', box), cross = $('#cross', box);
    function at(e) {
      var r = hit.getBoundingClientRect(), rel = (e.clientX - r.left) / r.width;
      var k3 = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1))));
      var x = X(k3); cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.style.display = '';
      showTip(fmtD(c.labels[k3]) + '|~var(--brand)~Created: ' + c.created[k3] + '|~var(--s-closed)~Closed (ของ Ticket ที่สร้างในช่วง): ' + c.closed[k3], e.clientX, e.clientY);
    }
    hit.addEventListener('pointermove', at); hit.addEventListener('pointerdown', at);
    hit.addEventListener('pointerleave', function () { cross.style.display = 'none'; hideTip(); });
  }

  /* ---------- SLA & performance ---------- */
  function renderPerf(f) {
    var resp = [], resTot = [], resEx = [], waits = [], closedN = 0, met = 0, rClaimed = 0, rMet = 0, rLate = 0;
    f.forEach(function (t) {
      if (t.claimedAt) { resp.push(t.claimedAt - t.createdAt); }
      if (t.claimedAt !== null) { rClaimed++; if (t.claimedAt <= t.respDue) { rMet++; } } else if (D.now > t.respDue) { rLate++; }
      if (t.waitMs > 0) { waits.push(t.waitMs); }
      if (t.status === 'Closed') {
        closedN++; if (t.closedAt <= t.slaDue) { met++; }
        resTot.push(t.closedAt - t.createdAt); resEx.push(Math.max(0, t.closedAt - t.createdAt - t.waitMs));
      }
    });
    var comp = pct(met, closedN), rcomp = pct(rMet, rClaimed);
    var tiles = [
      { l: 'Response Time', n: fmtDur(median(resp)), s: 'median · avg ' + fmtDur(mean(resp)) + ' · n=' + resp.length + ' (Created → Claimed)' },
      { l: 'Response ตามเป้า', n: rcomp == null ? '—' : rcomp + '<small>%</small>', s: rClaimed ? 'ตอบทัน ' + rMet + ' จาก ' + rClaimed + ' Ticket ที่รับเรื่องแล้ว' + (rLate ? ' · ยังไม่รับและเกินเป้า ' + rLate : '') : 'ยังไม่มี Ticket ที่รับเรื่อง', m: rcomp, ml: 'Response on-target' },
      { l: 'Resolution Time', n: fmtDur(median(resTot)), s: 'median รวมเวลา Waiting · avg ' + fmtDur(mean(resTot)) + ' · n=' + closedN },
      { l: 'Resolution (excl. Waiting)', n: fmtDur(median(resEx)), s: 'median ไม่รวมช่วง Waiting · avg ' + fmtDur(mean(resEx)) + ' · n=' + closedN },
      { l: 'Waiting Time', n: fmtDur(mean(waits)), s: 'avg ต่อ Ticket ที่เคย Waiting · ' + (f.length ? pct(waits.length, f.length) + '% ของ Ticket' : '—') + ' · n=' + waits.length },
      { l: 'SLA Compliance', n: comp == null ? '—' : comp + '<small>%</small>', s: closedN ? met + ' จาก ' + closedN + ' Ticket ที่ปิด ปิดทัน SLA Due' : 'ยังไม่มี Ticket ที่ปิด', m: comp }
    ];
    var tileHtml = function (t, cls) {
      return '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="t-l">' + esc(t.l) + '</div><div class="t-n">' + t.n + '</div><div class="t-s">' + esc(t.s) + '</div>' +
        (t.m != null ? '<div class="meter" role="img" aria-label="' + (t.ml || 'SLA compliance') + ' ' + t.m + ' percent"><i style="width:' + t.m + '%"></i></div>' : '') + '</div>';
    };
    var byL = {}; tiles.forEach(function (t) { byL[t.l] = t; });
    $('#perf').innerHTML =
      '<h3 class="perf-h">ผลตามเป้า SLA</h3><div class="perf-row hero">' + tileHtml(byL['SLA Compliance'], 'hero') + tileHtml(byL['Response ตามเป้า'], 'hero') + '</div>' +
      '<h3 class="perf-h">เวลาที่ใช้</h3><div class="perf-row">' + ['Response Time', 'Resolution Time', 'Resolution (excl. Waiting)', 'Waiting Time'].map(function (l) { return tileHtml(byL[l]); }).join('') + '</div>';
    $('#slaTargetsTbl').innerHTML = '<table class="targets"><caption class="sr-only">เป้า SLA ต่อ Priority (ค่าจำลอง)</caption><thead><tr><th scope="col">Priority</th><th scope="col">Response</th><th scope="col">Resolution</th><th scope="col">ปฏิทินนับเวลา</th></tr></thead><tbody>' +
      D.priorities.slice().reverse().map(function (p) { var g = D.slaTargets[p]; return '<tr><th scope="row">' + esc(p) + '</th><td>' + fmtTarget(g.respMin, p) + '</td><td>' + fmtTarget(g.resMin, p) + '</td><td>' + (g.cal === '24x7' ? 'ตลอด 24 ชม. ทุกวัน' : 'จ.–ศ. ' + pad(D.workCalendar.startHour) + ':00–' + pad(D.workCalendar.endHour) + ':00') + '</td></tr>'; }).join('') + '</tbody></table>';

    // resolution time by priority: total vs excluding waiting (median hours)
    var prow = D.priorities.slice().reverse().map(function (p) {
      var tt = [], ee = [];
      f.forEach(function (t) { if (t.status === 'Closed' && t.priority === p) { tt.push(t.closedAt - t.createdAt); ee.push(Math.max(0, t.closedAt - t.createdAt - t.waitMs)); } });
      return { p: p, n: tt.length, tot: median(tt), ex: median(ee) };
    });
    var mx = Math.max.apply(null, prow.map(function (r) { return Math.max(r.tot || 0, r.ex || 0); }).concat([1]));
    $('#resBody').innerHTML = prow.some(function (r) { return r.n; }) ?
      '<div class="bars">' + prow.map(function (r) {
        if (!r.n) { return '<div class="bar-row" style="--vw:150px"><span class="name">' + r.p + '</span><span class="empty-mini" style="padding:0;text-align:left">ไม่มี Ticket ที่ปิด</span><span class="val">—</span></div>'; }
        return '<div class="bar-row" tabindex="0" style="--vw:150px" data-tip="' + esc(r.p + ' · n=' + r.n + '|~var(--brand)~รวม Waiting: ' + fmtDur(r.tot) + '|~var(--brand-2)~ไม่รวม Waiting: ' + fmtDur(r.ex) + '|' + targetText(r.p)) + '"><span class="name">' + r.p + '</span>' +
          '<span class="pair"><span class="track"><span class="fill" style="display:block;width:' + (r.tot / mx * 100) + '%;background:var(--brand)"></span></span><span class="track"><span class="fill" style="display:block;width:' + (r.ex / mx * 100) + '%;background:var(--brand-2)"></span></span></span>' +
          '<span class="val">' + fmtDur(r.tot) + '<small> / ' + fmtDur(r.ex) + '</small></span></div>';
      }).join('') + '</div><div class="legend"><span><i style="background:var(--brand)"></i>รวมเวลา Waiting</span><span><i style="background:var(--brand-2)"></i>ไม่รวมเวลา Waiting</span></div>' :
      '<div class="empty-mini">ไม่มี Ticket ที่ปิดในตัวกรองนี้</div>';
    $('#resBody').innerHTML += dataTable(['Priority', 'Closed (n)', 'Median total', 'Median excl. waiting'], prow.map(function (r) { return [r.p, r.n, fmtDur(r.tot), fmtDur(r.ex)]; }));

    // SLA compliance by branch
    var brow = D.branches.map(function (b) {
      var cl = f.filter(function (t) { return t.status === 'Closed' && t.branch === b; });
      var ok = count(cl, function (t) { return t.closedAt <= t.slaDue; });
      return { name: branchLabel(b), n: cl.length, ok: ok, value: cl.length ? pct(ok, cl.length) : 0, has: cl.length > 0 };
    });
    $('#slaBranchBody').innerHTML = brow.some(function (r) { return r.has; }) ?
      '<div class="bars">' + brow.map(function (r) {
        return '<div class="bar-row nm sla-b" tabindex="0" data-tip="' + esc(r.name + '|' + (r.has ? '~var(--sla-ok)~ปิดทัน SLA ' + r.ok + ' จาก ' + r.n + ' (' + r.value + '%)' : 'ยังไม่มี Ticket ที่ปิด')) + '"><span class="name">' + esc(r.name) + '</span><span class="track"><span class="fill" style="display:block;width:' + (r.has ? r.value : 0) + '%;background:var(--sla-ok)"></span></span><span class="val">' + (r.has ? r.value + '%' : '—') + '<small> n=' + r.n + '</small></span></div>';
      }).join('') + '</div>' : '<div class="empty-mini">ไม่มี Ticket ที่ปิดในตัวกรองนี้</div>';
    $('#slaBranchBody').innerHTML += dataTable(['Branch', 'Closed (n)', 'Met SLA', 'Compliance %'], brow.map(function (r) { return [r.name, r.n, r.ok, r.has ? r.value + '%' : '—']; }));
  }

  /* ---------- satisfaction (rating 1-5, closed tickets only; null = not rated) ---------- */
  var MIN_N = 5;                                  // fewer rated tickets than this => flagged "ตัวอย่างน้อย"
  function stars(r) {
    if (!r) { return '<span style="color:var(--ink-3)" title="ยังไม่ได้ประเมิน / ยังไม่ปิด">—</span>'; }
    return '<span class="stars" role="img" aria-label="' + r + ' จาก 5 ดาว">' + new Array(r + 1).join('★') + '<span class="off">' + new Array(6 - r).join('★') + '</span><b>' + r + '</b></span>';
  }
  function renderSatisfaction(f) {
    var closed = f.filter(function (t) { return t.status === 'Closed'; });
    var rated = closed.filter(function (t) { return t.rating >= 1 && t.rating <= 5; });
    var n = rated.length, avg = mean(rated.map(function (t) { return t.rating; }));
    var cards = [
      { l: 'Avg Satisfaction', n: n ? avg.toFixed(1) + '<small>/ 5</small>' : '—', s: n ? 'ค่าเฉลี่ยจาก ' + n + ' Ticket ที่ให้คะแนน' : 'ยังไม่มี Ticket ที่ให้คะแนน' },
      { l: 'Rated', n: String(n), s: closed.length ? pct(n, closed.length) + '% ของ Ticket ที่ปิด (' + n + ' จาก ' + closed.length + ')' : 'ยังไม่มี Ticket ที่ปิด' }
    ];
    $('#satKpis').innerHTML = cards.map(function (c) {
      return '<div class="kpi"><div class="kpi-l"><span>' + esc(c.l) + '</span></div><div class="kpi-n">' + c.n + '</div><div class="kpi-s">' + esc(c.s) + '</div></div>';
    }).join('');

    var dist = [5, 4, 3, 2, 1].map(function (s) {
      var v = count(rated, function (t) { return t.rating === s; });
      return { name: s + ' ดาว', value: v, color: 'var(--brand)', tip: s + ' ดาว|' + v + ' Ticket' + (n ? ' (' + pct(v, n) + '% ของที่ให้คะแนน)' : '') };
    });
    var dmax = Math.max.apply(null, dist.map(function (r) { return r.value; }).concat([1]));
    $('#ratingDistBody').innerHTML = (n ? barRows(dist, dmax, function (r) { return r.value + '<small> ' + pct(r.value, n) + '%</small>'; }, 'sat-d') : '<div class="empty-mini">ยังไม่มี Ticket ที่ให้คะแนนในตัวกรองนี้</div>') +
      dataTable(['Rating', 'Tickets'], dist.map(function (r) { return [r.name, r.value]; }));

    var brs = D.branches.map(function (b) {
      var rs = rated.filter(function (t) { return t.branch === b; }).map(function (t) { return t.rating; });
      return { b: b, n: rs.length, avg: mean(rs) };
    });
    $('#ratingBranchBody').innerHTML = (n ?
      '<div class="bars">' + brs.map(function (r) {
        var low = r.n > 0 && r.n < MIN_N, nm = branchLabel(r.b);
        var tip = nm + '|' + (r.n ? 'คะแนนเฉลี่ย ' + r.avg.toFixed(2) + ' / 5 จาก ' + r.n + ' Ticket' + (low ? ' (ตัวอย่างน้อย)' : '') : 'ยังไม่มี Ticket ที่ให้คะแนน');
        return '<div class="bar-row nm sat' + (low ? ' low' : '') + '" tabindex="0" data-tip="' + esc(tip) + '"><span class="name">' + esc(nm) + '</span>' +
          '<span class="track"><span class="fill" style="display:block;width:' + (r.n ? r.avg / 5 * 100 : 0) + '%;background:var(--brand)"></span></span>' +
          '<span class="val">' + (r.n ? r.avg.toFixed(1) : '—') + '<small> n=' + r.n + (low ? ' · ตัวอย่างน้อย' : '') + '</small></span></div>';
      }).join('') + '</div>' : '<div class="empty-mini">ยังไม่มี Ticket ที่ให้คะแนนในตัวกรองนี้</div>') +
      dataTable(['Branch', 'Avg rating', 'Rated (n)'], brs.map(function (r) { return [branchLabel(r.b), r.n ? r.avg.toFixed(2) : '—', r.n]; }));
  }

  /* ---------- table ---------- */
  var COLS = [
    ['id', 'Ticket ID'], ['createdAt', 'Created At'], ['branch', 'Branch'], ['category', 'Category'],
    ['priority', 'Priority'], ['status', 'Status'], ['assignee', 'Assignee'], ['sla', 'SLA Status'], ['rating', 'Rating']
  ];
  function sortVal(t, k) {
    if (k === 'priority') { return PRI[t.priority].rank; }
    if (k === 'status') { return ST[t.status].rank; }
    if (k === 'sla') { return SLAM[slaOf(t)].rank; }
    if (k === 'assignee') { return t.assignee || '~'; }
    if (k === 'rating') { return t.rating || 0; }
    return t[k];
  }
  function renderTable(f) {
    var k = state.sortKey, dir = state.sortDir;
    var rows = f.slice().sort(function (a, b) { var x = sortVal(a, k), y = sortVal(b, k); return (x < y ? -1 : x > y ? 1 : (a.createdAt - b.createdAt)) * dir; });
    var pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (state.page > pages) { state.page = pages; }
    var s0 = (state.page - 1) * PAGE, view = rows.slice(s0, s0 + PAGE);
    var head = COLS.map(function (c) {
      var on = c[0] === k;
      return '<th scope="col" aria-sort="' + (on ? (dir === 1 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + c[0] + '">' + c[1] + '<span class="arr" aria-hidden="true">' + (on ? (dir === 1 ? '▲' : '▼') : '↕') + '</span></button></th>';
    }).join('');
    var body = view.map(function (t) {
      var sl = slaOf(t), sm = SLAM[sl], sm2 = ST[t.status];
      var due = (t.slaDue === null ? 'ยังไม่เริ่มนับ SLA (ยังไม่มีผู้รับเรื่อง)' : 'SLA Due ' + fmtDT(t.slaDue) + (t.status === 'Closed' ? ' · ปิด ' + fmtDT(t.closedAt) : '')) + ' · Response Due ' + fmtDT(t.respDue);
      return '<tr><td class="id">' + esc(t.id) + '</td><td>' + fmtDT(t.createdAt) + '</td><td>' + esc(branchLabel(t.branch)) + '</td><td>' + esc(t.category) + '</td>' +
        '<td><span class="pr"><i style="background:var(' + PRI[t.priority].v + ')"></i>' + t.priority + '</span></td>' +
        '<td><span class="pill ' + sm2.cls + '">' + icon(t.status, sm2.v) + t.status + (t.status === 'Waiting' ? ' · ' + (t.waitingReason === 'User' ? 'รอ User' : 'รอ Vendor') : '') + '</span></td>' +
        '<td>' + (t.assignee ? esc(t.assignee) : '<span style="color:var(--ink-3)">Unassigned</span>') + '</td>' +
        '<td><span class="pill ' + sm.cls + '" title="' + esc(due) + '">' + icon(sl, sm.v) + sl + '</span></td>' +
        '<td>' + stars(t.rating) + '</td></tr>';
    }).join('');
    $('#ticketTable').innerHTML = '<caption>Ticket list · DEMO DATA · ' + rows.length + ' tickets ตามตัวกรอง</caption><thead><tr>' + head + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="9" style="padding:26px;text-align:center;color:var(--ink-3)">ไม่มี Ticket ตามตัวกรองนี้</td></tr>') + '</tbody>';
    $('#pagerInfo').textContent = rows.length ? 'แสดง ' + (s0 + 1) + '–' + (s0 + view.length) + ' จาก ' + rows.length + ' รายการ' : 'ไม่มีรายการ';
    $('#pageNo').textContent = 'หน้า ' + state.page + ' / ' + pages;
    $('#prev').disabled = state.page <= 1; $('#next').disabled = state.page >= pages;
    $$('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-sort');
        if (state.sortKey === key) { state.sortDir *= -1; } else { state.sortKey = key; state.sortDir = (key === 'createdAt' || key === 'priority') ? -1 : 1; }
        state.page = 1; renderTable(lastFiltered);
      });
    });
  }

  /* ---------- render pipeline ---------- */
  function activeLine(n) {
    var parts = [fmtD(dayStart(state.from)) + ' – ' + fmtD(dayStart(state.to))];
    if (state.branch) { parts.push('Branch: ' + branchLabel(state.branch)); }
    if (state.status) { parts.push('Status: ' + state.status); }
    if (state.priority) { parts.push('Priority: ' + state.priority); }
    if (state.category) { parts.push('Category: ' + state.category); }
    if (state.q) { parts.push('Ticket ID มี "' + state.q + '"'); }
    $('#activeLine').textContent = 'ตัวกรองที่ใช้: ' + parts.join(' · ') + ' → ' + n + ' tickets (DEMO)';
  }
  function showView() {
    var v = state.view;
    $('#skeleton').hidden = v !== 'loading';
    $('#errorBox').hidden = v !== 'error';
    var bad = v === 'loading' || v === 'error';
    var empty = (v === 'empty') || (v === 'normal' && lastFiltered.length === 0);
    $('#overview').hidden = bad || cur !== 'overview';
    $('#emptyBox').hidden = bad ? true : !empty;
    $('#detail').hidden = bad || empty;
    PAGE_IDS.forEach(function (id) { if (id !== 'overview') { var el = document.getElementById(id); if (el) { el.hidden = cur !== id; } } });
  }
  var RENDERERS = {
    overview: function (f) { renderKpis(f); },
    analytics: function (f) { renderStatus(f); renderBranch(f); renderPriority(f); renderCategory(f); renderWaiting(f); renderTrend(f); },
    sla: function (f) { renderPerf(f); },
    satisfaction: function (f) { renderSatisfaction(f); },
    tickets: function (f) { renderTable(f); }
  };
  function render() {
    lastFiltered = state.view === 'empty' ? [] : filtered();
    activeLine(lastFiltered.length);
    showView();
    if (lastFiltered.length) { RENDERERS[cur](lastFiltered); }
  }

  /* ---------- pages (hash routing) ---------- */
  function applyFields() {                        // show only this page's filters and put its remembered values in the controls
    var allow = PAGES[cur].fields;
    $$('.filters [data-f]').forEach(function (el) { el.hidden = allow.indexOf(el.getAttribute('data-f')) < 0; });
    $('#from').value = state.from; $('#to').value = state.to;
    ['branch', 'status', 'priority', 'category', 'q'].forEach(function (k) { $('#' + k).value = state[k]; });
    $$('.presets button').forEach(function (b) { b.setAttribute('aria-pressed', String(state.preset !== null && Number(b.getAttribute('data-n')) === state.preset)); });
    $('#pageName').textContent = 'ตัวกรองของหน้า ' + PAGES[cur].name;
    $$('.nav a').forEach(function (a) { if (a.getAttribute('href') === '#' + cur) { a.setAttribute('aria-current', 'true'); } else { a.removeAttribute('aria-current'); } });
  }
  function pageFromHash() { var h = (location.hash || '').replace('#', ''); return PAGES[h] ? h : 'overview'; }
  function route(first) {
    var next = pageFromHash();
    if (!first && next === cur) { return; }
    FKEYS.forEach(function (k) { FS[cur][k] = state[k]; });           // remember the page we are leaving
    cur = next;
    FKEYS.forEach(function (k) { state[k] = FS[cur][k]; });
    state.page = 1; dateNote('');
    applyFields();
    if (!first) { window.scrollTo(0, 0); }
    if (D) { render(); }
  }
  function initPages() {
    var def = function () { var to = ymd(D.now), from = ymd(D.now - 29 * DAY); if (dayStart(from) < D.firstDay) { from = ymd(D.firstDay); } return { preset: 30, from: from, to: to, branch: '', status: '', priority: '', category: '', q: '' }; };
    PAGE_IDS.forEach(function (id) { FS[id] = def(); });
    window.addEventListener('hashchange', function () { route(false); });
    cur = pageFromHash(); FKEYS.forEach(function (k) { state[k] = FS[cur][k]; });
    applyFields();
  }

  /* ---------- filter controls ---------- */
  function dateNote(msg) { var el = $('#dateNote'); el.textContent = msg || ''; el.hidden = !msg; }
  function setPreset(n) {
    dateNote('');
    state.preset = n;
    var to = ymd(D.now); state.to = to; state.from = ymd(D.now - (n - 1) * DAY);
    if (dayStart(state.from) < D.firstDay) { state.from = ymd(D.firstDay); }
    $('#from').value = state.from; $('#to').value = state.to;
    $$('.presets button').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-n')) === n)); });
  }
  function initFilters() {
    var fill = function (id, list, all, label) { $(id).innerHTML = '<option value="">' + all + '</option>' + list.map(function (x) { return '<option value="' + esc(x) + '">' + esc(label ? label(x) : x) + '</option>'; }).join(''); };
    fill('#branch', D.branches, 'ทุกสาขา', branchLabel); fill('#status', D.statuses, 'All statuses'); fill('#priority', D.priorities.slice().reverse(), 'All priorities'); fill('#category', D.categories, 'All categories');
    $('#from').min = $('#to').min = ymd(D.firstDay); $('#from').max = $('#to').max = ymd(D.now);
    initPages();
    $$('.presets button').forEach(function (b) { b.addEventListener('click', function () { setPreset(Number(b.getAttribute('data-n'))); state.page = 1; render(); }); });
    ['from', 'to'].forEach(function (id) {
      $('#' + id).addEventListener('change', function () {
        var a = $('#from').value, b = $('#to').value;
        if (!a || !b) { $('#from').value = state.from; $('#to').value = state.to; dateNote(''); return; }   /* cleared: restore the range in use and drop any old notice */
        var lo = ymd(D.firstDay), hi = ymd(D.now), notes = [];
        var ca = a < lo ? lo : a > hi ? hi : a, cb = b < lo ? lo : b > hi ? hi : b;
        if (ca !== a || cb !== b) { notes.push('ปรับวันที่ให้อยู่ในช่วงข้อมูลจำลองแล้ว (' + fmtD(dayStart(lo)) + ' – ' + fmtD(dayStart(hi)) + ')'); }
        a = ca; b = cb;
        if (a > b) { var t = a; a = b; b = t; notes.unshift('สลับวันที่ให้แล้ว'); }
        dateNote(notes.join(' · '));
        state.from = a; state.to = b; state.preset = null; $('#from').value = a; $('#to').value = b;
        $$('.presets button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        state.page = 1; render();
      });
    });
    ['branch', 'status', 'priority', 'category'].forEach(function (id) { $('#' + id).addEventListener('change', function () { state[id] = this.value; state.page = 1; render(); }); });
    $('#q').addEventListener('input', function () { state.q = this.value.replace(/^\s+|\s+$/g, '').slice(0, 24); state.page = 1; render(); });
    var reset = function () { state.branch = state.status = state.priority = state.category = state.q = ''; ['branch', 'status', 'priority', 'category', 'q'].forEach(function (id) { $('#' + id).value = ''; }); setPreset(30); state.page = 1; state.view = 'normal'; $('#vNormal').checked = true; render(); };
    $('#reset').addEventListener('click', reset); $('#resetEmpty').addEventListener('click', reset);
    $('#prev').addEventListener('click', function () { state.page--; renderTable(lastFiltered); });
    $('#next').addEventListener('click', function () { state.page++; renderTable(lastFiltered); });
    $$('input[name="view"]').forEach(function (r) { r.addEventListener('change', function () { state.view = this.value; render(); }); });
  }

  /* ---------- chrome: theme, nav, resize ---------- */
  function initChrome() {
    /* keep sticky offsets in sync with the DEMO banner, which may wrap to several lines on narrow screens */
    var bar = document.querySelector('.demo-bar');
    function syncBar() { if (bar) { document.documentElement.style.setProperty('--demo-h', bar.offsetHeight + 'px'); } }
    syncBar(); window.addEventListener('resize', syncBar);
    if (window.ResizeObserver && bar) { new ResizeObserver(syncBar).observe(bar); }
    var root = document.documentElement;
    $('#theme').addEventListener('click', function () {
      var cur = root.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var nxt = cur === 'dark' ? 'light' : 'dark'; root.setAttribute('data-theme', nxt);
      try { localStorage.setItem('drorn-demo-theme', nxt); } catch (e) { /* storage may be unavailable */ }
      $('#theme').setAttribute('aria-pressed', String(nxt === 'dark'));
    });
    try { var saved = localStorage.getItem('drorn-demo-theme'); if (saved === 'dark' || saved === 'light') { root.setAttribute('data-theme', saved); } } catch (e) { /* ignore */ }
    $('#menu').addEventListener('click', function (e) { e.stopPropagation(); document.body.classList.toggle('nav-open'); $('#menu').setAttribute('aria-expanded', String(document.body.classList.contains('nav-open'))); });
    document.addEventListener('click', function (e) { if (document.body.classList.contains('nav-open') && !e.target.closest('#side')) { document.body.classList.remove('nav-open'); $('#menu').setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { document.body.classList.remove('nav-open'); } });
    $$('.nav a').forEach(function (a) { a.addEventListener('click', function () { document.body.classList.remove('nav-open'); }); });
    var raf = 0, lastW = 0;
    var onResize = function () { var b = $('#trendBox'); if (!b || b.clientWidth === lastW) { return; } lastW = b.clientWidth; cancelAnimationFrame(raf); raf = requestAnimationFrame(drawTrend); };
    if ('ResizeObserver' in window) { new ResizeObserver(onResize).observe($('#trendBox')); } else { window.addEventListener('resize', onResize); }
  }

  /* ---------- DEMO guard ----------
     Accidental-mix-up protection ONLY: it rejects the whole data set (nothing is rendered) when the shape does not match this
     prototype's Mock Data schema. It is NOT proof that the data source really is mock data - anyone can imitate the format. */
  var T_KEYS = ['id', 'createdAt', 'branch', 'category', 'priority', 'status', 'waitingReason', 'assignee', 'claimedAt', 'startedAt', 'closedAt', 'waitMs', 'waitStartedAt', 'waitEndedAt', 'respDue', 'slaDue', 'rating'];
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.floor(x) === x; }
  function isStrList(a) { return Array.isArray(a) && a.length > 0 && a.every(function (s) { return typeof s === 'string' && s !== ''; }); }
  function sameSet(a, ref) {                      // same members as `ref`, no duplicates (order may differ)
    return a.length === ref.length && ref.every(function (x) { return a.indexOf(x) >= 0; }) && a.every(function (x, i) { return a.indexOf(x) === i; });
  }
  function validYmd(s) {
    var y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8), dt = new Date(Date.UTC(y, m - 1, d));
    return y >= 2000 && m >= 1 && m <= 12 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function checkDemoData(data) {                  // returns '' when OK, otherwise a short reason (never echoes ticket content)
    try {
      if (!data || typeof data !== 'object') { return 'ไม่มีข้อมูล'; }
      if (data.source !== 'DEMO') { return 'source ไม่ใช่ DEMO'; }
      if (!isNum(data.now) || !isNum(data.tzOffsetMs) || !isNum(data.firstDay)) { return 'ขาดค่าเวลา now/tzOffsetMs/firstDay'; }
      if (!isStrList(data.branches) || !isStrList(data.categories) || !isStrList(data.priorities) || !isStrList(data.statuses)) { return 'ขาดรายการ branches/categories/priorities/statuses'; }
      if (!data.slaTargets || typeof data.slaTargets !== 'object' || !data.priorities.every(function (p) { var g = data.slaTargets[p]; return g && isNum(g.respMin) && g.respMin > 0 && isNum(g.resMin) && g.resMin > 0 && (g.cal === '24x7' || g.cal === 'work'); })) { return 'slaTargets ไม่ครบ'; }
      var wc = data.workCalendar;
      if (!wc || typeof wc !== 'object' || !isInt(wc.startHour) || !isInt(wc.endHour) || wc.startHour < 0 || wc.endHour > 24 || wc.endHour <= wc.startHour ||
          !Array.isArray(wc.days) || wc.days.length === 0 || !wc.days.every(function (d) { return isInt(d) && d >= 0 && d <= 6; })) { return 'workCalendar ไม่ถูกต้อง'; }
      if (!sameSet(data.branches, Object.keys(BRANCH_TH))) { return 'branches ต้องเป็น 6 สาขาที่กำหนดเท่านั้น'; }
      if (!sameSet(data.statuses, Object.keys(ST))) { return 'statuses ไม่ตรงกับค่าที่ Dashboard รองรับ'; }
      if (!sameSet(data.priorities, Object.keys(PRI))) { return 'priorities ไม่ตรงกับค่าที่ Dashboard รองรับ'; }
      if (!Array.isArray(data.tickets)) { return 'tickets ไม่ใช่รายการ'; }
      var seen = {}, clk = slaClock(data), i, t, k, idm;
      for (i = 0; i < data.tickets.length; i++) {
        t = data.tickets[i];
        var tag = 'Ticket ลำดับที่ ' + (i + 1) + ' ไม่ผ่านการตรวจ: ';
        if (!t || typeof t !== 'object') { return tag + 'รูปแบบ'; }
        for (k in t) { if (Object.prototype.hasOwnProperty.call(t, k) && T_KEYS.indexOf(k) < 0) { return tag + 'มีฟิลด์ที่ไม่อยู่ใน schema'; } }
        for (k = 0; k < T_KEYS.length; k++) { if (!(T_KEYS[k] in t)) { return tag + 'ขาดฟิลด์ ' + T_KEYS[k]; } }
        idm = typeof t.id === 'string' ? /^DEMO-(\d{8})-(\d{4})$/.exec(t.id) : null;
        if (!idm) { return tag + 'รูปแบบ ID'; }
        if (!validYmd(idm[1])) { return tag + 'วันที่ใน ID'; }
        if (seen[t.id]) { return tag + 'ID ซ้ำ'; }
        seen[t.id] = 1;
        if (data.branches.indexOf(t.branch) < 0) { return tag + 'สาขา'; }
        if (data.categories.indexOf(t.category) < 0) { return tag + 'category'; }
        if (data.priorities.indexOf(t.priority) < 0) { return tag + 'priority'; }
        if (data.statuses.indexOf(t.status) < 0) { return tag + 'status'; }
        if (!isNum(t.createdAt) || t.createdAt > data.now) { return tag + 'createdAt'; }
        var d0 = new Date(t.createdAt + data.tzOffsetMs);
        if (idm[1] !== String(d0.getUTCFullYear()) + ('0' + (d0.getUTCMonth() + 1)).slice(-2) + ('0' + d0.getUTCDate()).slice(-2)) { return tag + 'วันที่ใน ID ไม่ตรงกับ createdAt'; }
        if (!isNum(t.respDue) || Math.abs(t.respDue - clk.respDue(t)) > 1) { return tag + 'respDue'; }
        if (!isNum(t.waitMs) || t.waitMs < 0) { return tag + 'waitMs'; }
        if (t.waitingReason !== null && t.waitingReason !== 'User' && t.waitingReason !== 'Vendor') { return tag + 'waitingReason'; }
        if (t.assignee !== null && typeof t.assignee !== 'string') { return tag + 'assignee'; }
        var ts = ['claimedAt', 'startedAt', 'closedAt'];
        for (k = 0; k < 3; k++) { if (t[ts[k]] !== null && (!isNum(t[ts[k]]) || t[ts[k]] < t.createdAt || t[ts[k]] > data.now)) { return tag + ts[k]; } }
        if (t.startedAt !== null && t.claimedAt === null) { return tag + 'มี startedAt แต่ไม่มี claimedAt'; }
        if (t.claimedAt !== null && t.startedAt !== null && t.startedAt < t.claimedAt) { return tag + 'startedAt ก่อน claimedAt'; }
        if (t.closedAt !== null && ((t.startedAt !== null && t.closedAt < t.startedAt) || (t.claimedAt !== null && t.closedAt < t.claimedAt))) { return tag + 'closedAt ก่อน claimedAt/startedAt'; }
        /* waitMs = total time the ticket has spent in Waiting (so far, if it is still Waiting). Waiting can only start after the ticket was
           claimed/started, and it may already be over (ticket back In Progress or Closed), so the status is NOT restricted here. */
        var tEnd = t.closedAt !== null ? t.closedAt : data.now;
        var wBase = t.startedAt !== null ? t.startedAt : (t.claimedAt !== null ? t.claimedAt : t.createdAt);
        if (t.waitMs > 0 && t.claimedAt === null) { return tag + 'waitMs > 0 แต่ยังไม่มี claimedAt'; }
        if (t.waitMs > tEnd - wBase) { return tag + 'waitMs มากกว่าช่วงเวลาที่ Ticket ถูกดำเนินการ'; }
        if ((t.status === 'Closed') !== (t.closedAt !== null)) { return tag + 'closedAt ไม่สอดคล้องกับ status'; }
        if ((t.status === 'Open') !== (t.claimedAt === null)) { return tag + 'status Open ไม่สอดคล้องกับ claimedAt'; }
        /* Waiting period (one per ticket): the SLA clock is stopped inside it. waitMs must equal its length (still-open period: up to the demo clock). */
        if (t.waitMs === 0) {
          if (t.waitStartedAt !== null || t.waitEndedAt !== null || t.status === 'Waiting') { return tag + 'ช่วง Waiting ไม่สอดคล้องกับ waitMs'; }
        } else {
          if (!isNum(t.waitStartedAt) || t.waitStartedAt < wBase || t.waitStartedAt > tEnd) { return tag + 'waitStartedAt'; }
          if (t.status === 'Waiting') {
            if (t.waitEndedAt !== null || Math.abs(t.waitMs - (data.now - t.waitStartedAt)) > 1) { return tag + 'ช่วง Waiting ที่ยังไม่จบไม่ตรงกับ waitMs'; }
          } else if (!isNum(t.waitEndedAt) || t.waitEndedAt < t.waitStartedAt || t.waitEndedAt > tEnd || Math.abs(t.waitMs - (t.waitEndedAt - t.waitStartedAt)) > 1) { return tag + 'waitEndedAt'; }
        }
        /* SLA Due (stored): null until the ticket is claimed; afterwards it must match the SLA clock (from Claimed At, working time unless 24x7, stopped while Waiting). */
        if (t.claimedAt === null ? t.slaDue !== null : (!isNum(t.slaDue) || Math.abs(t.slaDue - clk.slaDue(t)) > 1)) { return tag + 'slaDue'; }
        if (t.rating !== null && !(t.status === 'Closed' && typeof t.rating === 'number' && t.rating >= 1 && t.rating <= 5 && Math.floor(t.rating) === t.rating)) { return tag + 'rating'; }
      }
      return '';
    } catch (e) { return 'ตรวจโครงสร้างข้อมูลไม่ได้'; }
  }

  /* ---------- start ---------- */
  var started = false;
  var ERR_DEF = null, loadFailed = false;      // default texts of #errorBox (restored after a failed/blocked load)
  function showError(h, p) {
    $('#skeleton').hidden = true; $('#overview').hidden = true; $('#detail').hidden = true; $('#emptyBox').hidden = true;
    $('#errorBox h2').textContent = h; $('#errorBox p').textContent = p; $('#errorBox').hidden = false;
  }
  function load() {
    if (!ERR_DEF) { ERR_DEF = { h: $('#errorBox h2').textContent, p: $('#errorBox p').textContent }; }
    state.view = 'loading'; loadFailed = false;
    $('#skeleton').hidden = false; $('#errorBox').hidden = true; $('#overview').hidden = true; $('#detail').hidden = true; $('#emptyBox').hidden = true;
    var pr;
    try { pr = Promise.resolve(window.DashboardData.load()); }     // DashboardData / load missing, or a synchronous throw -> handled below
    catch (e) { pr = Promise.reject(e); }
    pr.then(function (data) {
      var bad = checkDemoData(data);                  // guard: validates the WHOLE data set before anything is rendered
      if (bad) {
        loadFailed = true; state.view = 'error';
        showError('Prototype blocked', 'ไฟล์นี้เป็นต้นแบบสำหรับข้อมูลจำลองเท่านั้น และไม่รับข้อมูลที่ไม่ได้ติดป้าย DEMO หรือมีรูปแบบไม่ตรงกับ Mock Data (' + bad + ')');
        return;
      }
      $('#errorBox h2').textContent = ERR_DEF.h; $('#errorBox p').textContent = ERR_DEF.p;
      D = data; OFF = D.tzOffsetMs; CLK = slaClock(D);
      $('#updated').textContent = fmtDT(D.now) + ' น. (DEMO)';
      if (!started) { initFilters(); started = true; }
      state.view = 'normal'; $('#vNormal').checked = true; render();
    }).catch(function () {
      loadFailed = true; state.view = 'error';
      showError('โหลดข้อมูลไม่สำเร็จ', 'โหลดข้อมูลจำลองไม่สำเร็จ กดปุ่ม "ลองใหม่" เพื่อโหลดอีกครั้ง หากยังไม่หายให้แจ้งทีม IT');
    });
  }
  function start() {
    initTips(); initChrome();
    $('#retry').addEventListener('click', function () { if (!D || loadFailed) { load(); } else { state.view = 'normal'; $('#vNormal').checked = true; render(); } });
    load();
  }
  start();
})();
