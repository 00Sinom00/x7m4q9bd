/* Calculation engine. Pure functions, no DOM, no storage.
   Dates are 'yyyy-mm-dd' strings, clock times 'HH:mm' strings, durations integer minutes. */
(function (root) {
  'use strict';
  const E = {};
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- dates ---------- */
  E.parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  E.fmtDate = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  E.addDays = (s, n) => { const d = E.parseDate(s); d.setUTCDate(d.getUTCDate() + n); return E.fmtDate(d); };
  E.dow = (s) => (E.parseDate(s).getUTCDay() + 6) % 7; // 0 = Monday
  E.weekStart = (s) => E.addDays(s, -E.dow(s));
  E.isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && E.fmtDate(E.parseDate(s)) === s;
  E.todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  E.nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  E.WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ---------- clock times and durations ---------- */
  // '930', '0930', '9:30', '09.30' -> minutes since midnight; '' -> null; invalid -> undefined
  E.parseTime = (s) => {
    if (s == null) return null;
    s = String(s).trim();
    if (s === '') return null;
    const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(s);
    if (!m) return undefined;
    const h = +m[1], mi = +m[2];
    return h < 24 && mi < 60 ? h * 60 + mi : undefined;
  };
  E.fmtTime = (min) => (min == null ? '' : `${pad(Math.floor(min / 60))}:${pad(min % 60)}`);
  E.normTime = (s) => { const m = E.parseTime(s); return m === undefined ? undefined : E.fmtTime(m); };

  // '1:30', '-0:15', '+2:05', '1.5', '-1,25' -> minutes; '' -> 0; invalid -> undefined
  E.parseDur = (s) => {
    s = String(s == null ? '' : s).trim().replace(',', '.');
    if (s === '') return 0;
    let m = /^([+-]?)(\d+):(\d{1,2})$/.exec(s);
    if (m) { if (+m[3] > 59) return undefined; const v = +m[2] * 60 + +m[3]; return m[1] === '-' ? -v : v; }
    m = /^([+-]?)(\d*\.?\d+)$/.exec(s);
    if (m) { const v = Math.round(parseFloat(m[2]) * 60); return m[1] === '-' ? -v : v; }
    return undefined;
  };
  E.hm = (min, signed) => {
    min = Math.round(min);
    const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
    const sign = min < 0 ? '-' : (signed && min > 0 ? '+' : '');
    return `${sign}${h}:${pad(m)}`;
  };
  E.dec = (min, signed) => {
    const v = Math.round(min) / 60;
    const t = Math.abs(v).toFixed(2);
    const sign = min < 0 && t !== '0.00' ? '-' : (signed && min > 0 ? '+' : '');
    return `${sign}${t}`;
  };
  E.fmt = (min, signed) => `${E.hm(min, signed)} (${E.dec(min, signed)} h)`;
  E.days = (min, dayMin, signed) => {
    const v = dayMin ? min / dayMin : 0;
    const t = Math.abs(v).toFixed(2);
    const sign = v < 0 && t !== '0.00' ? '-' : (signed && v > 0 ? '+' : '');
    return `${sign}${t} d`;
  };

  /* ---------- day types ---------- */
  E.TYPES = {
    work: { label: 'Work' },
    half: { label: 'Half-day work' },
    holiday: { label: 'Public holiday' },
    halfholiday: { label: 'Half public holiday' },
    comp: { label: 'Compensation day' },
    halfcomp: { label: 'Half compensation day' },
    vacation: { label: 'Vacation' },
    halfvacation: { label: 'Half vacation' },
    sick: { label: 'Sick' },
    dayoff: { label: 'Unpaid / day off' },
  };
  E.isHolidayType = (t) => t === 'holiday' || t === 'halfholiday';

  /* ---------- Zurich public holidays ---------- */
  E.easter = (y) => {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${y}-${pad(month)}-${pad(day)}`;
  };
  E.nthMonday = (y, month, n) => {
    let d = `${y}-${pad(month)}-01`;
    while (E.dow(d) !== 0) d = E.addDays(d, 1);
    return E.addDays(d, 7 * (n - 1));
  };
  E.zhHolidays = (y) => {
    const easter = E.easter(y);
    const easterMonday = E.addDays(easter, 1);
    let sechse = E.nthMonday(y, 4, 3);
    if (sechse === easterMonday) sechse = E.addDays(sechse, 7);
    const list = [
      { date: `${y}-01-01`, name: 'New Year (Neujahr)' },
      { date: `${y}-01-02`, name: 'Berchtoldstag' },
      { date: E.addDays(easter, -2), name: 'Good Friday' },
      { date: easterMonday, name: 'Easter Monday' },
      { date: `${y}-05-01`, name: 'Labour Day' },
      { date: E.addDays(easter, 39), name: 'Ascension Day' },
      { date: E.addDays(easter, 50), name: 'Whit Monday' },
      { date: `${y}-08-01`, name: 'Swiss National Day' },
      { date: `${y}-12-25`, name: 'Christmas Day' },
      { date: `${y}-12-26`, name: "St. Stephen's Day" },
      { date: sechse, name: 'Sechseläuten (afternoon)', half: true },
      { date: E.nthMonday(y, 9, 2), name: 'Knabenschiessen (afternoon)', half: true },
    ];
    return list.sort((a, b) => (a.date < b.date ? -1 : 1));
  };
  E.holidaysFor = (settings, y) => (settings.holidays && settings.holidays[y]) || E.zhHolidays(y);
  E.holidayOn = (settings, date) => E.holidaysFor(settings, +date.slice(0, 4)).find((h) => h.date === date) || null;

  /* ---------- settings ---------- */
  E.defaultSettings = () => {
    const wd = () => ({ in: '09:00', out: '17:30', breaks: [['12:00', '12:30']], nominalMin: 480 });
    const we = () => ({ in: null, out: null, breaks: [], nominalMin: 0 });
    return {
      updatedAt: 0,
      schedule: [wd(), wd(), wd(), wd(), wd(), we(), we()],
      cutoff: null,             // weeks starting before this date use the legacy rule
      freeAllowanceMin: 180,    // Ueberstunden covered by contract, per week
      dayMin: 480,              // length of one day, for hours -> days
      vacationPerYear: 20,
      vacationStartYear: new Date().getFullYear(),
      vacationOpening: 0,       // days carried in at the start year
      startDate: E.todayStr(),  // planned days start here
      legalWeekMin: 2700,       // 45 h
      legalFreeYearMin: 3600,   // 60 h
      legalCapYearMin: 10200,   // 170 h
      backupHours: 24,          // warn when the last export is older than this
      holidays: {},             // per-year overrides of the generated calendar
    };
  };
  E.emptyState = () => ({ version: 1, settings: E.defaultSettings(), days: {}, deleted: {}, adjustments: [] });
  E.normalize = (st) => {
    const out = E.emptyState();
    if (!st || typeof st !== 'object') return out;
    out.settings = Object.assign(E.defaultSettings(), st.settings || {});
    out.days = st.days && typeof st.days === 'object' ? st.days : {};
    out.deleted = st.deleted && typeof st.deleted === 'object' ? st.deleted : {};
    out.adjustments = Array.isArray(st.adjustments) ? st.adjustments : [];
    return out;
  };

  /* ---------- one day ---------- */
  const span = (a, b) => (b >= a ? b - a : b + 1440 - a);
  E.workedMin = (rec) => {
    if (!rec) return 0;
    const i = E.parseTime(rec.in), o = E.parseTime(rec.out);
    if (i == null || o == null || i === undefined || o === undefined) return 0;
    let w = span(i, o);
    for (const br of rec.breaks || []) {
      const bs = E.parseTime(br[0]), be = E.parseTime(br[1]);
      if (bs != null && be != null && bs !== undefined && be !== undefined) w -= span(bs, be);
    }
    return Math.max(0, w);
  };
  E.dayMin = (rec) => E.workedMin(rec) + ((rec && rec.extraMin) || 0);
  E.baseNominal = (settings, date) => settings.schedule[E.dow(date)].nominalMin || 0;
  E.nominalFor = (settings, date, rec) => {
    if (rec && rec.nominalMin != null) return rec.nominalMin;
    const base = E.baseNominal(settings, date);
    switch (rec && rec.type) {
      case 'half': case 'halfholiday': case 'halfvacation': return Math.round(base / 2);
      case 'holiday': case 'vacation': case 'sick': case 'dayoff': return 0;
      default: return base; // work, comp
    }
  };
  // Hours of this day taken as time in lieu: they use up the week's Ueberstunden first, then Ueberzeit.
  E.timeOffMin = (rec, nominal) => (rec.type === 'comp' ? nominal : rec.type === 'halfcomp' ? Math.round(nominal / 2) : 0);
  // Virtual day pre-filled from the schedule (not stored, never counted).
  E.plannedDay = (settings, date) => {
    const sch = settings.schedule[E.dow(date)];
    if (!sch || !sch.nominalMin) return null;
    const hol = E.holidayOn(settings, date);
    if (hol && !hol.half) return { type: 'holiday', note: hol.name, planned: true, confirmed: false };
    if (hol && hol.half) {
      const i = E.parseTime(sch.in);
      return { type: 'halfholiday', in: sch.in, out: i == null ? null : E.fmtTime((i + Math.round(sch.nominalMin / 2)) % 1440), breaks: [], note: hol.name, planned: true, confirmed: false };
    }
    return { type: 'work', in: sch.in, out: sch.out, breaks: (sch.breaks || []).map((b) => b.slice()), planned: true, confirmed: false };
  };
  E.dayInfo = (state, date) => {
    const s = state.settings;
    let rec = state.days[date], planned = false;
    if (!rec) { rec = E.plannedDay(s, date); planned = !!rec; }
    if (!rec) return { date, rec: null, planned: false, confirmed: false, worked: 0, nominal: 0, diff: 0, holiday: E.holidayOn(s, date) };
    const worked = E.dayMin(rec), nominal = E.nominalFor(s, date, rec);
    return { date, rec, planned, confirmed: !planned && !!rec.confirmed, worked, nominal, diff: worked - nominal, holiday: E.holidayOn(s, date) };
  };
  E.weekDays = (state, monday) => Array.from({ length: 7 }, (_, i) => E.dayInfo(state, E.addDays(monday, i)));

  // Days waiting for confirmation: stored drafts and planned days, up to today.
  E.pendingDays = (state, today) => {
    const out = [];
    const s = state.settings;
    for (const [d, r] of Object.entries(state.days)) if (!r.confirmed && d <= today) out.push(d);
    if (s.startDate) {
      for (let d = s.startDate; d <= today; d = E.addDays(d, 1)) {
        if (!state.days[d] && E.plannedDay(s, d)) out.push(d);
      }
    }
    return out.sort();
  };

  /* ---------- counters ---------- */
  E.compute = (state) => {
    const s = state.settings, cutoff = s.cutoff || null, allow = s.freeAllowanceMin;
    const weeks = {};
    const getWeek = (mon) => weeks[mon] || (weeks[mon] = {
      monday: mon, sunday: E.addDays(mon, 6), legacy: !!(cutoff && mon < cutoff),
      workedMin: 0, nominalMin: 0, netMin: 0, workNetMin: 0, timeOffMin: 0, creditMin: 0, usMin: 0, uzMin: 0, balanceMin: 0, legalUzMin: 0, days: 0,
    });
    const vacTaken = {}, compDays = {};
    for (const date of Object.keys(state.days).sort()) {
      const rec = state.days[date];
      if (!rec.confirmed) continue;
      const w = getWeek(E.weekStart(date));
      const worked = E.dayMin(rec), nom = E.nominalFor(s, date, rec), diff = worked - nom;
      w.workedMin += worked; w.nominalMin += nom; w.days++;
      if (E.isHolidayType(rec.type) && diff > 0) w.creditMin += diff;
      else {
        const off = E.timeOffMin(rec, nom);
        w.netMin += diff; w.workNetMin += diff + off; w.timeOffMin += off;
      }
      const y = +date.slice(0, 4);
      if (rec.type === 'vacation') vacTaken[y] = (vacTaken[y] || 0) + 1;
      if (rec.type === 'halfvacation') vacTaken[y] = (vacTaken[y] || 0) + 0.5;
      if (rec.type === 'comp') compDays[y] = (compDays[y] || 0) + 1;
      if (rec.type === 'halfcomp') compDays[y] = (compDays[y] || 0) + 0.5;
    }
    const T = { legacyMin: 0, uzMin: 0, usMin: 0, creditMin: 0, adjMin: 0 };
    const months = {}, years = {};
    const mk = (k) => months[k] || (months[k] = { key: k, weeks: [], workedMin: 0, nominalMin: 0, netMin: 0, usMin: 0, uzMin: 0, creditMin: 0, legacyMin: 0, adjMin: 0 });
    const yk = (y) => years[y] || (years[y] = { year: y, workedMin: 0, nominalMin: 0, netMin: 0, usMin: 0, uzMin: 0, creditMin: 0, legacyMin: 0, adjMin: 0, legalUzMin: 0 });
    for (const mon of Object.keys(weeks).sort()) {
      const w = weeks[mon];
      if (w.legacy) { w.balanceMin = w.netMin + w.creditMin; T.legacyMin += w.balanceMin; }
      else {
        // Earned from the work itself, then time in lieu uses Ueberstunden first, the rest comes out of Ueberzeit.
        const n0 = w.workNetMin, off = w.timeOffMin;
        const usEarned = Math.min(Math.max(n0, 0), allow);
        const uzEarned = n0 >= allow ? n0 - allow : (n0 >= 0 ? 0 : n0);
        const usedUs = Math.min(off, usEarned);
        w.usMin = usEarned - usedUs;
        w.uzMin = uzEarned - (off - usedUs);
        w.balanceMin = w.uzMin + w.creditMin;
        T.uzMin += w.uzMin; T.usMin += w.usMin; T.creditMin += w.creditMin;
      }
      w.legalUzMin = Math.max(0, w.workedMin - s.legalWeekMin);
      const m = mk(w.sunday.slice(0, 7)), y = yk(+w.sunday.slice(0, 4));
      for (const t of [m, y]) {
        t.workedMin += w.workedMin; t.nominalMin += w.nominalMin; t.netMin += w.netMin;
        t.usMin += w.usMin; t.uzMin += w.uzMin;
        if (w.legacy) t.legacyMin += w.balanceMin; else t.creditMin += w.creditMin;
      }
      y.legalUzMin += w.legalUzMin;
      m.weeks.push(w);
    }
    for (const a of state.adjustments) {
      if (a.deleted) continue;
      T.adjMin += a.minutes;
      mk(a.date.slice(0, 7)).adjMin += a.minutes;
      yk(+a.date.slice(0, 4)).adjMin += a.minutes;
    }
    const balanceMin = T.legacyMin + T.uzMin + T.creditMin + T.adjMin;

    // vacation, carried over year to year
    const thisYear = +E.todayStr().slice(0, 4);
    const vac = (y) => {
      const n = Math.max(0, y - s.vacationStartYear + 1);
      const entitled = s.vacationOpening + s.vacationPerYear * n;
      let takenBefore = 0;
      for (const [yy, v] of Object.entries(vacTaken)) if (+yy < y) takenBefore += v;
      const takenYear = vacTaken[y] || 0;
      return {
        year: y, carryIn: s.vacationOpening + s.vacationPerYear * Math.max(0, y - s.vacationStartYear) - takenBefore,
        perYear: s.vacationPerYear, takenYear, remaining: entitled - takenBefore - takenYear,
      };
    };
    const vacation = vac(thisYear);
    const totalOffDays = vacation.remaining + (s.dayMin ? balanceMin / s.dayMin : 0);
    return { weeks, months, years, vacTaken, compDays, vac, vacation, totals: Object.assign({ balanceMin }, T), balanceMin, totalOffDays };
  };

  /* ---------- merge (sync) ---------- */
  E.merge = (local, inc) => {
    local = E.normalize(local); inc = E.normalize(inc);
    const out = JSON.parse(JSON.stringify(local));
    const st = { added: 0, updated: 0, removed: 0, adjAdded: 0, adjUpdated: 0, settings: false };
    const dates = new Set([...Object.keys(local.days), ...Object.keys(inc.days), ...Object.keys(local.deleted), ...Object.keys(inc.deleted)]);
    for (const d of dates) {
      const lr = local.days[d], ir = inc.days[d];
      const tomb = Math.max(local.deleted[d] || 0, inc.deleted[d] || 0);
      const best = ir && (!lr || (ir.updatedAt || 0) > (lr.updatedAt || 0)) ? ir : lr;
      if (best && (best.updatedAt || 0) >= tomb) {
        out.days[d] = JSON.parse(JSON.stringify(best));
        delete out.deleted[d];
        if (!lr) st.added++; else if (best === ir) st.updated++;
      } else {
        delete out.days[d];
        if (tomb) out.deleted[d] = tomb;
        if (lr) st.removed++;
      }
    }
    const byId = new Map(out.adjustments.map((a) => [a.id, a]));
    for (const a of inc.adjustments) {
      const l = byId.get(a.id);
      if (!l) { out.adjustments.push(JSON.parse(JSON.stringify(a))); if (!a.deleted) st.adjAdded++; }
      else if ((a.updatedAt || 0) > (l.updatedAt || 0)) { Object.assign(l, JSON.parse(JSON.stringify(a))); st.adjUpdated++; }
    }
    if ((inc.settings.updatedAt || 0) > (local.settings.updatedAt || 0)) { out.settings = JSON.parse(JSON.stringify(inc.settings)); st.settings = true; }
    return { state: out, stats: st };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.Engine = E;
})(typeof self !== 'undefined' ? self : this);
