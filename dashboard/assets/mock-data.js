/* =====================================================================
   DEMO DATA ONLY - ข้อมูลจำลองทั้งหมด
   - สร้างด้วยตัวสุ่มแบบกำหนดค่าเริ่มต้นคงที่ (seeded) ทุกครั้งที่เปิดจะได้ชุดเดิม
   - ไม่ได้มาจาก Helpdesk Spreadsheet และไม่ใช่ผลการทำงานจริงของ Dr.Orn Clinic
   - Ticket ID ใช้รูปแบบ DEMO-YYYYMMDD-NNNN เพื่อไม่ให้สับสนกับ ID จริง
   - ไม่มี LINE User ID, ชื่อผู้แจ้ง, รายละเอียดปัญหา, Resolution, AnyDesk ID, File Link อยู่ในชุดข้อมูลนี้
   - rating = คะแนนความพึงพอใจ 1-5 (จำลอง) มีเฉพาะ Ticket ที่ Closed ค่า null = ยังไม่ได้ประเมิน (ไม่นับเป็น 0) ไม่มีความเห็นอิสระ/ชื่อผู้ให้คะแนน
   - SLA: นับจาก Claimed At ตามเป้าต่อ Priority (Critical 24/7, อื่นๆ จ.-ศ. 09:00-18:00) หยุดนับตอน Waiting; slaDue/respDue เก็บไว้ในข้อมูล (null ถ้ายังไม่ Claim)
   - "เวลาปัจจุบันของ Demo" ถูกตรึงไว้ เพื่อให้ SLA คำนวณซ้ำได้เสมอ

   การเชื่อมข้อมูลจริงในอนาคต: สร้างไฟล์อื่น (เช่น api-client.js) ที่ implement
   window.DashboardData.load() ให้คืนค่ารูปแบบเดียวกัน แล้วเปลี่ยน <script> ใน index.html
   ไฟล์นี้ต้องไม่ถูกนำไปใช้ใน Production
   ===================================================================== */
(function () {
  'use strict';

  var TZ_MS = 7 * 3600 * 1000;                    // Asia/Bangkok (UTC+7, no DST)
  var HOUR = 3600 * 1000, MIN = 60 * 1000, DAY = 24 * HOUR;
  var NOW = Date.UTC(2026, 11, 15, 3, 0, 0);      // 15 Dec 2026 10:00 (UTC+7) - fixed DEMO clock
  var DAYS_BACK = 60;

  var BRANCHES = ['Phaholyothin', 'Chidlom', 'Ratchaphruek', 'Rangsit', 'Ram Inthra', 'Emsphere'];   // the 6 branches shown in the UI (internal English keys)
  var NON_BRANCH = 'Other/Non-branch';             // generator-only bucket: such tickets are EXCLUDED from the data the UI receives (see below)
  var GEN_BRANCHES = BRANCHES.concat([NON_BRANCH]);   // kept so the random sequence, and every other ticket, stay exactly as before
  var BRANCH_W = [0.28, 0.16, 0.14, 0.13, 0.12, 0.11, 0.06];
  var CATEGORIES = ['Network / Internet', 'Printer', 'CCTV', 'Fingerprint (ZKTeco)', 'PC / Notebook', 'Software / Application', 'Email / Account', 'Phone / Meeting room', 'Other'];
  var CATEGORY_W = [0.2, 0.17, 0.08, 0.1, 0.17, 0.13, 0.07, 0.04, 0.04];
  var PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
  var PRIORITY_W = [0.3, 0.42, 0.22, 0.06];
  /* SLA targets (demo values; lower bound of the ranges the team gave).  respMin = Response target (Created -> Claimed),
     resMin = Resolution target counted from Claimed At (SLA clock).  cal: '24x7' = continuous, 'work' = working time only. */
  var SLA_TARGETS = {
    Critical: { respMin: 5,   resMin: 120,  cal: '24x7' },
    High:     { respMin: 15,  resMin: 240,  cal: 'work' },
    Medium:   { respMin: 60,  resMin: 540,  cal: 'work' },     // 1 working day = 9 working hours
    Low:      { respMin: 240, resMin: 1080, cal: 'work' }      // 2 working days = 18 working hours
  };
  var WORK_CAL = { startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] };   // 09:00-18:00 Mon-Fri (Asia/Bangkok); public holidays are NOT excluded; no lunch break
  // calendar maths (kept identical to the helpers in app.js; the DEMO guard recomputes every stored due time with them)
  function nextOpen(t) {                          // earliest working moment >= t
    var S = WORK_CAL.startHour * HOUR, E = WORK_CAL.endHour * HOUR, l = t + TZ_MS, di = Math.floor(l / DAY), tod = l - di * DAY;
    for (var g = 0; g < 400; g++) {
      if (WORK_CAL.days.indexOf(((4 + di) % 7 + 7) % 7) >= 0) {
        if (tod < S) { return di * DAY + S - TZ_MS; }
        if (tod < E) { return di * DAY + tod - TZ_MS; }
      }
      di++; tod = 0;
    }
    return t;
  }
  function addWork(start, ms) {
    var E = WORK_CAL.endHour * HOUR, t = nextOpen(start);
    while (ms > 0) {
      var end = Math.floor((t + TZ_MS) / DAY) * DAY + E - TZ_MS, room = end - t;
      if (ms <= room) { return t + ms; }
      ms -= room; t = nextOpen(end);
    }
    return t;
  }
  function workBetween(a, b) {
    if (b <= a) { return 0; }
    var E = WORK_CAL.endHour * HOUR, total = 0, t = nextOpen(a);
    while (t < b) { var end = Math.floor((t + TZ_MS) / DAY) * DAY + E - TZ_MS; total += Math.min(end, b) - t; t = nextOpen(end); }
    return total;
  }
  function addCal(cal, start, ms) { return cal === '24x7' ? start + ms : addWork(start, ms); }
  function betweenCal(cal, a, b) { return cal === '24x7' ? Math.max(0, b - a) : workBetween(a, b); }
  // SLA Due = the moment the SLA clock (running from Claimed At, stopped while Waiting) has used up the Resolution target.
  // A ticket that is still Waiting is treated as if it resumed at the demo clock.
  function slaDueOf(t) {
    if (t.claimedAt === null) { return null; }
    var tg = SLA_TARGETS[t.priority], budget = tg.resMin * MIN;
    if (t.waitStartedAt === null) { return addCal(tg.cal, t.claimedAt, budget); }
    var used = betweenCal(tg.cal, t.claimedAt, t.waitStartedAt);
    if (used >= budget) { return addCal(tg.cal, t.claimedAt, budget); }
    return addCal(tg.cal, t.waitEndedAt !== null ? t.waitEndedAt : NOW, budget - used);
  }
  var STAFF = ['Staff A', 'Staff B', 'Staff C'];

  // mulberry32 - small seeded PRNG
  var seed = 20261215;
  function rnd() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(list, weights) {
    var r = rnd(), s = 0;
    for (var i = 0; i < list.length; i++) { s += weights[i]; if (r < s) { return list[i]; } }
    return list[list.length - 1];
  }
  function between(a, b) { return a + (b - a) * rnd(); }
  function logn(median, spread) {                 // log-normal-ish positive duration
    var u = (rnd() + rnd() + rnd() + rnd() - 2) / 0.58;
    return median * Math.exp(u * spread);
  }
  function pad(n, w) { var s = String(n); while (s.length < w) { s = '0' + s; } return s; }
  function dayKey(ms) { var d = new Date(ms + TZ_MS); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2); }

  var RESP_MIN = { Critical: 6, High: 14, Medium: 35, Low: 80 };        // median response (minutes)
  var WORK_H = { Critical: 0.45, High: 1.3, Medium: 2.4, Low: 3.5 };    // median hands-on work (hours)

  var tickets = [];
  var perDay = {};

  function build(createdAt, forced) {
    var priority = forced && forced.priority ? forced.priority : pick(PRIORITIES, PRIORITY_W);
    var t = {
      id: '', createdAt: createdAt, branch: pick(GEN_BRANCHES, BRANCH_W), category: pick(CATEGORIES, CATEGORY_W),
      priority: priority, status: 'Open', waitingReason: null, assignee: null,
      claimedAt: null, startedAt: null, closedAt: null, waitMs: 0, waitStartedAt: null, waitEndedAt: null,
      respDue: addCal(SLA_TARGETS[priority].cal, createdAt, SLA_TARGETS[priority].respMin * MIN), slaDue: null   // slaDue is set once the ticket is claimed (see finalize below)
    };
    var k = dayKey(createdAt); perDay[k] = (perDay[k] || 0) + 1;
    t.id = 'DEMO-' + k + '-' + pad(perDay[k], 4);

    var ageDays = (NOW - createdAt) / DAY;
    var target;                                     // intended outcome before the clock check
    if (forced && forced.status) { target = forced.status; }
    else {
      var r = rnd();
      if (ageDays > 4) { target = r < 0.93 ? 'Closed' : r < 0.96 ? 'Waiting' : r < 0.98 ? 'In Progress' : 'Open'; }
      else if (ageDays > 1) { target = r < 0.78 ? 'Closed' : r < 0.88 ? 'Waiting' : r < 0.95 ? 'In Progress' : 'Open'; }
      else { target = r < 0.45 ? 'Closed' : r < 0.6 ? 'Waiting' : r < 0.82 ? 'In Progress' : 'Open'; }
    }
    if (target === 'Open') { return t; }

    var claimed = createdAt + logn(RESP_MIN[priority], 0.7) * MIN;
    if (forced && forced.claimDelayMin != null) { claimed = createdAt + forced.claimDelayMin * MIN; }
    if (claimed > NOW) { return t; }                // not claimed yet at the demo clock
    t.claimedAt = claimed;
    t.assignee = STAFF[Math.floor(rnd() * STAFF.length)];
    var started = claimed + between(2, 18) * MIN;
    if (started > NOW) { t.status = 'In Progress'; return t; }
    t.startedAt = started;

    var waitMs = 0;
    if (target === 'Waiting' || (target === 'Closed' && rnd() < 0.2)) { waitMs = logn(5, 0.8) * HOUR; }
    var work = logn(WORK_H[priority], 0.6) * HOUR;

    if (target === 'In Progress') { t.status = 'In Progress'; return t; }
    if (target === 'Waiting') {
      var reason = rnd() < 0.6 ? 'User' : 'Vendor';     // always drawn, so the random sequence is the same either way
      if (NOW - started < 15 * MIN) {                   // waiting so far cannot exceed the time since start; minimum wait is 15 min
        t.status = 'In Progress'; t.waitMs = 0; t.waitingReason = null;
        return t;
      }
      t.status = 'Waiting'; t.waitingReason = reason;
      t.waitMs = Math.max(15 * MIN, Math.min(NOW - started - 10 * MIN, waitMs));   // waiting so far (<= time since start)
      t.waitStartedAt = NOW - t.waitMs; t.waitEndedAt = null;                      // still waiting: the SLA clock has been stopped since waitStartedAt
      return t;
    }
    var closed = started + work + waitMs;
    if (closed > NOW) { t.status = 'In Progress'; return t; }
    t.status = 'Closed'; t.closedAt = closed; t.waitMs = waitMs;
    if (waitMs > 0) { t.waitStartedAt = started + work / 2; t.waitEndedAt = t.waitStartedAt + waitMs; }   // one waiting period inside the working time
    return t;
  }

  // regular flow: DAYS_BACK days ending at the demo clock
  var startDay = Math.floor((NOW + TZ_MS) / DAY) * DAY - TZ_MS - (DAYS_BACK - 1) * DAY;   // 00:00 local, first day
  for (var d = 0; d < DAYS_BACK; d++) {
    var dayStart = startDay + d * DAY;
    var dow = new Date(dayStart + TZ_MS).getUTCDay();
    var weekend = dow === 0 || dow === 6;
    var n = weekend ? Math.round(between(1, 3)) : Math.round(between(4, 9));
    for (var i = 0; i < n; i++) {
      var hour = weekend ? between(9, 17) : (rnd() < 0.7 ? between(8.5, 12.5) : between(13, 18.5));
      var created = dayStart + hour * HOUR;
      if (created < NOW) { tickets.push(build(created)); }
    }
  }

  // a few crafted "live" tickets so SLA Breached / Due Soon always have examples in the demo
  var live = [
    { p: 'Critical', ageMin: 95, s: 'In Progress' }, { p: 'High', ageMin: 6 * 60, s: 'In Progress' }, { p: 'High', ageMin: 5 * 60 + 10, s: 'Open' },
    { p: 'Medium', ageMin: 9.5 * 60, s: 'In Progress' }, { p: 'Medium', ageMin: 11 * 60, s: 'Open' },
    { p: 'Critical', ageMin: 38, s: 'In Progress' }, { p: 'High', ageMin: 3 * 60 + 25, s: 'In Progress' }, { p: 'Medium', ageMin: 7 * 60 + 18, s: 'Open' }
  ];
  live.forEach(function (x) {
    var t = build(NOW - x.ageMin * MIN, { priority: x.p, status: x.s === 'Open' ? 'Open' : 'In Progress', claimDelayMin: 4 });
    if (x.s === 'Open') { t.status = 'Open'; t.claimedAt = null; t.startedAt = null; t.assignee = null; }
    tickets.push(t);
  });

  tickets.forEach(function (t) { t.slaDue = slaDueOf(t); });   // after every ticket field (incl. the crafted live ones) is final

  tickets.sort(function (a, b) { return b.createdAt - a.createdAt; });

  // Tickets without one of the 6 real branches are not moved to another branch and not hidden silently:
  // they are removed from the data handed to the UI and counted in `excluded` (returned by load()) so the impact is reportable.
  var excludedCount = 0, excludedIds = [];
  tickets = tickets.filter(function (t) {
    if (BRANCHES.indexOf(t.branch) !== -1) { return true; }
    excludedCount++; excludedIds.push(t.id); return false;
  });

  // Satisfaction rating (DEMO): only Closed tickets can have a 1-5 star rating; blank (null) = not rated.
  // Uses its own hash-seeded generator per ticket so the main random sequence above (and every other demo number) is unchanged.
  var RATE_RESPONSE = 0.55;                                   // share of closed tickets that were rated (demo value)
  var RATE_MET = [0.02, 0.04, 0.12, 0.32, 0.50];              // distribution of 1..5 when closed within SLA Due
  var RATE_MISSED = [0.10, 0.15, 0.30, 0.28, 0.17];           // distribution of 1..5 when closed after SLA Due
  function hashSeed(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function seededRnd(seedValue) {
    var s = seedValue | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  tickets.forEach(function (t) {
    t.rating = null;
    if (t.status !== 'Closed') { return; }
    var r = seededRnd(hashSeed('rating:' + t.id));
    if (r() >= RATE_RESPONSE) { return; }
    var w = t.closedAt <= t.slaDue ? RATE_MET : RATE_MISSED, x = r(), acc = 0;
    for (var i = 0; i < 5; i++) { acc += w[i]; if (x < acc) { t.rating = i + 1; return; } }
    t.rating = 5;
  });

  window.DashboardData = {
    source: 'DEMO',                                // the UI shows DEMO labels whenever this is 'DEMO'
    load: function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({
            source: 'DEMO', now: NOW, tzOffsetMs: TZ_MS,
            branches: BRANCHES, categories: CATEGORIES, priorities: PRIORITIES,
            statuses: ['Open', 'In Progress', 'Waiting', 'Closed'],
            slaTargets: SLA_TARGETS, workCalendar: WORK_CAL,
            firstDay: startDay, tickets: tickets,
            excluded: { branch: NON_BRANCH, count: excludedCount, ids: excludedIds }   // not displayed anywhere in the UI
          });
        }, 450);
      });
    }
  };
})();
