/* UI. Vanilla JS, no dependencies. All figures come from Engine; nothing is stored as a total. */
(function () {
  'use strict';
  const E = window.Engine;
  const VERSION = '1.0.0';
  const $app = document.getElementById('app');

  let S = E.emptyState();            // synced data: settings, days, deleted, adjustments
  let META = { lastExportAt: null }; // device-local
  const UI = {
    tab: 'week', more: null,
    week: E.weekStart(E.todayStr()), month: E.todayStr().slice(0, 7), year: +E.todayStr().slice(0, 4),
    holYear: +E.todayStr().slice(0, 4),
  };

  /* ---------- storage: IndexedDB, localStorage as fallback ---------- */
  const store = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('wl', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const idbGet = (k) => open().then((db) => new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    }));
    const idbSet = (k, v) => open().then((db) => new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    }));
    return {
      async get(k) {
        try { return await idbGet(k); } catch (e) { /* fall through */ }
        try { const v = localStorage.getItem('wl.' + k); return v ? JSON.parse(v) : undefined; } catch (e) { return undefined; }
      },
      async set(k, v) {
        try { await idbSet(k, v); return; } catch (e) { /* fall through */ }
        try { localStorage.setItem('wl.' + k, JSON.stringify(v)); } catch (e) { toast('Could not save data on this device'); }
      },
    };
  })();
  let saveTimer;
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set('state', S), 40); };
  const persistMeta = () => store.set('meta', META);

  /* ---------- mutations ---------- */
  const stamp = () => Date.now();
  function saveDay(date, rec) { rec.updatedAt = stamp(); S.days[date] = rec; delete S.deleted[date]; persist(); }
  function removeDay(date) { delete S.days[date]; S.deleted[date] = stamp(); persist(); }
  function saveSettings() { S.settings.updatedAt = stamp(); persist(); }
  function saveAdj(a) {
    a.updatedAt = stamp();
    const i = S.adjustments.findIndex((x) => x.id === a.id);
    if (i >= 0) S.adjustments[i] = a; else S.adjustments.push(a);
    persist();
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const stripPlanned = (p) => { const r = clone(p); delete r.planned; return r; };
  const defaultType = (date) => {
    const h = E.holidayOn(S.settings, date);
    return h ? (h.half ? 'halfholiday' : 'holiday') : 'work';
  };

  /* ---------- DOM helpers ---------- */
  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'value') e.value = v;
      else if (k === 'selected' || k === 'checked' || k === 'disabled') e[k] = !!v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  function toast(msg, action) {
    const t = el('div', { class: 'toast' }, msg, action ? el('button', { onclick: () => { t.remove(); action.fn(); } }, action.label) : null);
    document.body.append(t);
    setTimeout(() => t.remove(), action ? 9000 : 2600);
  }
  function modal(title, body, buttons) {
    const close = () => { back.remove(); if (!document.querySelector('.backdrop')) document.body.classList.remove('noscroll'); };
    const foot = el('div', { class: 'sheet-foot' }, buttons.map((b) => el('button', {
      class: 'btn ' + (b.kind || ''),
      onclick: () => { if (b.fn && b.fn() === false) return; close(); },
    }, b.label)));
    const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
      el('div', { class: 'sheet-head' }, el('h2', {}, title), el('button', { class: 'icon', 'aria-label': 'Close', onclick: close }, '×')),
      el('div', { class: 'sheet-body' }, body), foot);
    const back = el('div', { class: 'backdrop' }, sheet);
    document.body.append(back);
    document.body.classList.add('noscroll');
    return { close, sheet };
  }
  const confirmBox = (msg, ok = 'OK', kind = 'primary') => new Promise((res) => {
    modal('Please confirm', el('p', {}, msg), [
      { label: 'Cancel', fn: () => { res(false); } },
      { label: ok, kind, fn: () => { res(true); } },
    ]);
  });

  /* ---------- inputs (24 h clock, yyyy-mm-dd, h:mm / decimal durations) ---------- */
  function timeInput(value) {
    const i = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'HH:mm', maxlength: 5, autocomplete: 'off', class: 'time', value: value || '' });
    i.addEventListener('blur', () => {
      const n = E.normTime(i.value);
      if (n === undefined) i.classList.add('bad'); else { i.classList.remove('bad'); i.value = n; }
    });
    return i;
  }
  function readTime(i) {
    const m = E.parseTime(i.value);
    i.classList.toggle('bad', m === undefined);
    return m === undefined ? undefined : E.fmtTime(m);
  }
  function durInput(min, placeholder, signed) {
    return el('input', { type: 'text', autocomplete: 'off', placeholder: placeholder || 'h:mm or 1.5', class: 'dur', value: min ? E.hm(min, !!signed) : '' });
  }
  function readDur(i) {
    const m = E.parseDur(i.value);
    i.classList.toggle('bad', m === undefined);
    return m;
  }
  function dateInput(value) { return el('input', { type: 'text', inputmode: 'numeric', placeholder: 'yyyy-mm-dd', maxlength: 10, autocomplete: 'off', value: value || '' }); }
  function readDate(i, allowEmpty) {
    const v = i.value.trim();
    const ok = (allowEmpty && v === '') || E.isDate(v);
    i.classList.toggle('bad', !ok);
    return ok ? (v || null) : undefined;
  }
  const field = (label, ...inputs) => el('label', { class: 'f' }, el('span', {}, label), inputs);

  /* ---------- formatting ---------- */
  function dual(min, signed) {
    const cls = signed ? (min > 0 ? 'pos' : min < 0 ? 'neg' : '') : '';
    return el('span', { class: 'dual ' + cls }, el('b', {}, E.hm(min, signed)), el('small', {}, E.dec(min, signed) + ' h'));
  }
  const daysStr = (min, signed) => E.days(min, S.settings.dayMin, signed);
  function kv(label, min, o = {}) {
    return el('div', { class: 'kv' + (o.strong ? ' strong' : '') },
      el('span', { class: 'lbl' }, label, o.sub ? el('small', {}, o.sub) : null),
      el('span', {}, dual(min, o.signed), o.days ? el('small', { class: 'dual' }, daysStr(min, o.signed)) : null));
  }
  const kvText = (label, text, cls) => el('div', { class: 'kv' }, el('span', { class: 'lbl' }, label), el('span', { class: cls || '' }, text));
  const range = (d1, d2) => `${d1} – ${d2}`;
  const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const localStamp = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  /* ---------- navigation ---------- */
  function go(patch) { Object.assign(UI, patch); window.scrollTo(0, 0); render(); }
  function topbar(left, title, sub, right) {
    return el('header', { class: 'top' },
      el('div', { class: 'nav' }, left), el('div', { class: 'title' }, el('h1', {}, title), sub ? el('small', {}, sub) : null), el('div', { class: 'nav' }, right));
  }
  const navBtn = (label, fn, aria) => el('button', { class: 'icon', 'aria-label': aria || label, onclick: fn }, label);

  function tabs(C, today) {
    const pending = E.pendingDays(S, today).length;
    const t = [['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['totals', 'Totals'], ['more', 'More']];
    return el('nav', { class: 'tabs' }, t.map(([k, label]) => el('button', { class: UI.tab === k ? 'on' : '', onclick: () => go({ tab: k, more: null }) },
      label, k === 'week' && pending ? el('span', { class: 'dot' }, pending) : null)));
  }
  function banners(today) {
    const out = [];
    const pending = E.pendingDays(S, today);
    if (pending.length) {
      out.push(el('div', { class: 'banner warn' }, el('span', {}, `${pending.length} day${pending.length > 1 ? 's' : ''} to confirm`),
        el('button', { class: 'btn small', onclick: () => go({ tab: 'week', week: E.weekStart(pending[0]) }) }, 'Show')));
    }
    if (Object.keys(S.days).length) {
      const since = META.lastExportAt ? (Date.now() - new Date(META.lastExportAt).getTime()) / 864e5 : Infinity;
      if (since > S.settings.backupDays) {
        out.push(el('div', { class: 'banner warn' }, el('span', {}, META.lastExportAt ? `No backup for ${Math.floor(since)} days` : 'No backup exported yet'),
          el('button', { class: 'btn small', onclick: () => go({ tab: 'more', more: 'sync' }) }, 'Back up')));
      }
    }
    return out;
  }

  /* ---------- day actions ---------- */
  function confirmDay(date, quiet) {
    let rec = S.days[date];
    if (!rec) { const p = E.plannedDay(S.settings, date); if (!p) return false; rec = stripPlanned(p); }
    if (rec.in && !rec.out) { if (!quiet) toast(`${date}: OUT is missing`); return false; }
    rec.confirmed = true;
    saveDay(date, rec);
    return true;
  }
  function confirmMany(dates) {
    let n = 0, skipped = 0;
    for (const d of dates) { if (confirmDay(d, true)) n++; else skipped++; }
    toast(`${n} day${n === 1 ? '' : 's'} confirmed` + (skipped ? `, ${skipped} skipped (OUT missing)` : ''));
    render();
  }
  function liveRecord(date) {
    let rec = S.days[date];
    if (!rec) rec = { type: defaultType(date), in: null, out: null, breaks: [], confirmed: false };
    return rec;
  }
  function startNow(date) { const r = liveRecord(date); r.in = E.nowTime(); r.out = null; r.breaks = []; r.confirmed = false; saveDay(date, r); render(); }
  function stopNow(date) {
    const r = liveRecord(date);
    const now = E.nowTime();
    const open = (r.breaks || []).find((b) => !b[1]);
    if (open) open[1] = now;
    r.out = now; r.confirmed = false; saveDay(date, r); render();
  }
  function breakNow(date, start) {
    const r = liveRecord(date);
    const now = E.nowTime();
    if (start) (r.breaks = r.breaks || []).push([now, '']);
    else { const open = (r.breaks || []).find((b) => !b[1]); if (open) open[1] = now; }
    r.confirmed = false; saveDay(date, r); render();
  }

  /* ---------- day editor ---------- */
  function openDay(date) {
    const info = E.dayInfo(S, date);
    const stored = !!S.days[date];
    const rec = clone(info.rec || { type: defaultType(date), in: null, out: null, breaks: [] });
    const sch = S.settings.schedule[E.dow(date)];
    const typeSel = el('select', {}, Object.entries(E.TYPES).map(([k, v]) => el('option', { value: k, selected: k === rec.type }, v.label)));
    const inI = timeInput(rec.in), outI = timeInput(rec.out);
    const brBox = el('div', {});
    const brRows = [];
    const extraI = durInput(rec.extraMin, '±h:mm, e.g. 1:30', true);
    const nomI = durInput(rec.nominalMin, 'auto');
    const tagSel = el('select', {}, [['', 'none'], ['travel', 'Travel'], ['remote', 'Remote']].map(([k, l]) => el('option', { value: k, selected: (rec.tag || '') === k }, l)));
    const noteI = el('input', { type: 'text', value: rec.note || '', autocomplete: 'off' });
    const note2I = el('input', { type: 'text', value: rec.note2 || '', autocomplete: 'off' });
    const err = el('div', { class: 'err' });
    const prev = el('div', { class: 'preview' });
    const nomHint = el('small', {});

    const addBreak = (s, e2) => {
      const row = { s: timeInput(s), e: timeInput(e2) };
      row.node = el('div', { class: 'row tight', style: 'margin-top:6px' }, row.s, '–', row.e,
        el('button', { class: 'icon', 'aria-label': 'Remove break', onclick: () => { row.node.remove(); brRows.splice(brRows.indexOf(row), 1); refresh(); } }, '×'));
      row.node.addEventListener('input', refresh);
      brRows.push(row); brBox.append(row.node);
    };
    (rec.breaks || []).forEach((b) => addBreak(b[0], b[1]));

    const tolerant = () => {
      const t = (i) => { const m = E.parseTime(i.value); return m === undefined ? null : E.fmtTime(m); };
      const ex = E.parseDur(extraI.value), no = E.parseDur(nomI.value);
      return {
        type: typeSel.value, in: t(inI), out: t(outI), breaks: brRows.map((r) => [t(r.s), t(r.e)]),
        extraMin: ex === undefined ? 0 : ex, nominalMin: nomI.value.trim() === '' || no === undefined ? undefined : no,
      };
    };
    function refresh() {
      const t = tolerant();
      const worked = E.dayMin(t);
      const auto = E.nominalFor(S.settings, date, Object.assign({}, t, { nominalMin: undefined }));
      const nom = t.nominalMin != null ? t.nominalMin : auto;
      nomHint.textContent = `auto: ${E.hm(auto)} (${E.dec(auto)} h)`;
      prev.replaceChildren(
        el('div', { class: 'kv' }, el('span', {}, 'Worked (incl. extra)'), dual(worked)),
        el('div', { class: 'kv' }, el('span', {}, 'Nominal'), dual(nom)),
        el('div', { class: 'kv strong' }, el('span', {}, 'Difference'), dual(worked - nom, true)));
    }
    typeSel.addEventListener('change', () => {
      const ty = typeSel.value;
      if (['work', 'half', 'halfholiday'].includes(ty) && !inI.value && !outI.value && sch && sch.in) {
        inI.value = sch.in;
        if (ty === 'work') { outI.value = sch.out || ''; brRows.splice(0).forEach((r) => r.node.remove()); (sch.breaks || []).forEach((b) => addBreak(b[0], b[1])); }
        else { const i = E.parseTime(sch.in); outI.value = E.fmtTime((i + Math.round((sch.nominalMin || 0) / 2)) % 1440); }
      }
      refresh();
    });
    for (const i of [inI, outI, extraI, nomI]) i.addEventListener('input', refresh);

    function collect() {
      err.textContent = '';
      const o = { type: typeSel.value };
      const i = readTime(inI), ou = readTime(outI);
      if (i === undefined || ou === undefined) return fail('Times must look like 09:30 (24 h).');
      if ((i == null) !== (ou == null)) return fail('Enter both IN and OUT, or neither.');
      if (i != null) { o.in = i; o.out = ou; }
      const brs = [];
      for (const r of brRows) {
        const a = readTime(r.s), b = readTime(r.e);
        if (a === undefined || b === undefined) return fail('Break times must look like 12:00.');
        if ((a == null) !== (b == null)) return fail('Each break needs a start and an end.');
        if (a != null) brs.push([a, b]);
      }
      o.breaks = brs;
      const ex = readDur(extraI), no = readDur(nomI);
      if (ex === undefined) return fail('Extra hours: use h:mm (e.g. 1:30, -0:15) or decimal (1.5).');
      if (no === undefined) return fail('Nominal: use h:mm or decimal.');
      if (ex) o.extraMin = ex;
      if (nomI.value.trim() !== '') o.nominalMin = no;
      if (tagSel.value) o.tag = tagSel.value;
      if (noteI.value.trim()) o.note = noteI.value.trim();
      if (note2I.value.trim()) o.note2 = note2I.value.trim();
      return o;
    }
    function fail(msg) { err.textContent = msg; return null; }
    const commit = (confirmed) => {
      const o = collect();
      if (!o) return false;
      o.confirmed = confirmed;
      saveDay(date, o);
      render();
      return true;
    };

    const body = [
      el('p', { class: 'muted' }, `${E.WEEKDAYS[E.dow(date)]} ${date}`, info.holiday ? ` · ${info.holiday.name}${info.holiday.half ? ' (half day)' : ''}` : ''),
      field('Type', typeSel),
      el('div', { class: 'row' }, field('IN', inI), field('OUT', outI)),
      field('Breaks', brBox, el('button', { class: 'btn small', style: 'margin-top:6px', onclick: () => { addBreak('', ''); } }, '+ Add break')),
      field('Extra hours (±, worked outside IN/OUT)', extraI),
      field('Tag', tagSel), field('Note', noteI), field('More info', note2I),
      field('Nominal override (leave empty for auto)', nomI, nomHint),
      prev, err,
    ];
    refresh();
    const buttons = [{ label: 'Cancel' }];
    if (stored) buttons.push({ label: 'Delete', kind: 'danger', fn: () => { removeDay(date); render(); } });
    if (stored && info.confirmed) buttons.push({ label: 'Save', kind: 'primary', fn: () => commit(true) === false ? false : undefined });
    else {
      buttons.push({ label: 'Save draft', fn: () => commit(false) === false ? false : undefined });
      buttons.push({ label: 'Confirm', kind: 'primary', fn: () => {
        if (!commit(true)) return false;
        return undefined;
      } });
    }
    modal(`Day ${date}`, body, buttons);
  }

  /* ---------- week view ---------- */
  function dayCard(info, today) {
    const { date, rec, planned } = info;
    const state = !rec ? 'empty' : planned ? 'planned' : info.confirmed ? 'confirmed' : 'draft';
    const wd = E.WEEKDAYS[E.dow(date)];
    const head = el('div', { class: 'head' },
      el('div', { class: 'date' }, wd + ' ' + date,
        rec ? el('span', { class: 'chip' }, E.TYPES[rec.type].label) : null,
        state === 'draft' ? el('span', { class: 'chip warn' }, 'draft') : null,
        rec && rec.tag ? el('span', { class: 'chip' }, rec.tag) : null),
      rec ? el('div', {}, dual(info.worked), el('div', { class: 'dual' }, dual(info.diff, true))) : null);
    const kids = [head];
    if (rec) {
      const parts = [];
      if (rec.in) parts.push(`${rec.in}–${rec.out || '…'}`);
      for (const b of rec.breaks || []) parts.push(`break ${b[0]}–${b[1] || '…'}`);
      if (rec.extraMin) parts.push(`extra ${E.hm(rec.extraMin, true)}`);
      if (info.nominal) parts.push(`nominal ${E.hm(info.nominal)}`);
      if (parts.length) kids.push(el('div', { class: 'times' }, parts.join(' · ')));
      const nt = [rec.note, rec.note2].filter(Boolean).join(' · ');
      if (nt) kids.push(el('div', { class: 'note' }, nt));
      if (info.holiday && !E.isHolidayType(rec.type) && !rec.note) kids.push(el('div', { class: 'note muted' }, `Calendar: ${info.holiday.name}`));
    } else {
      kids.push(el('div', { class: 'times' }, info.holiday ? info.holiday.name : 'Tap to add'));
    }
    if (date <= today && state !== 'confirmed' && rec) {
      const btns = [];
      const open = rec.in && !rec.out;
      if (date === today && state !== 'confirmed') {
        if (!rec.in || planned) btns.push(el('button', { class: 'btn small', onclick: (ev) => { ev.stopPropagation(); startNow(date); } }, 'Start now'));
        else if (open) {
          const ob = (rec.breaks || []).some((b) => !b[1]);
          btns.push(el('button', { class: 'btn small', onclick: (ev) => { ev.stopPropagation(); breakNow(date, !ob); } }, ob ? 'End break' : 'Start break'));
          btns.push(el('button', { class: 'btn small', onclick: (ev) => { ev.stopPropagation(); stopNow(date); } }, 'Stop now'));
        }
      }
      btns.push(el('button', { class: 'btn small primary', onclick: (ev) => { ev.stopPropagation(); if (confirmDay(date)) render(); } }, 'Confirm'));
      kids.push(el('div', { class: 'btns' }, btns));
    } else if (date === today && !rec) {
      kids.push(el('div', { class: 'btns' }, el('button', { class: 'btn small', onclick: (ev) => { ev.stopPropagation(); startNow(date); } }, 'Start now')));
    }
    return el('div', { class: `card day ${state}${date === today ? ' today' : ''}`, onclick: () => openDay(date) }, kids);
  }

  function viewWeek(C, today) {
    const mon = UI.week, sun = E.addDays(mon, 6);
    const days = E.weekDays(S, mon);
    const w = C.weeks[mon];
    const out = [topbar(
      navBtn('‹', () => go({ week: E.addDays(mon, -7) }), 'Previous week'),
      range(mon, sun), mon === E.weekStart(today) ? 'This week' : null,
      [mon !== E.weekStart(today) ? el('button', { class: 'btn small', onclick: () => go({ week: E.weekStart(today) }) }, 'Today') : null,
        navBtn('›', () => go({ week: E.addDays(mon, 7) }), 'Next week')])];
    out.push(...banners(today));
    const sum = el('div', { class: 'card' }, el('h3', {}, 'Week (confirmed days only)'));
    if (!w) sum.append(el('p', { class: 'muted' }, 'No confirmed days yet.'));
    else {
      sum.append(kv('Worked', w.workedMin), kv('Nominal', w.nominalMin), kv('Net', w.netMin, { signed: true, strong: true }));
      if (w.legacy) sum.append(kvText('Rule', 'legacy week: all of it goes to the balance', 'muted'));
      else {
        sum.append(kv('Überstunden', w.usMin, { sub: 'covered by contract', signed: true }), kv('Überzeit', w.uzMin, { sub: 'net above the weekly allowance', signed: true }));
        if (w.creditMin) sum.append(kv('Holiday credit', w.creditMin, { signed: true }));
      }
    }
    const pend = E.pendingDays(S, today).filter((d) => d >= mon && d <= sun);
    if (pend.length) sum.append(el('div', { class: 'btns' }, el('button', { class: 'btn primary', onclick: () => confirmMany(pend) }, `Confirm ${pend.length} day${pend.length > 1 ? 's' : ''}`)));
    out.push(sum);
    for (const d of days) out.push(dayCard(d, today));
    return out;
  }

  /* ---------- month view ---------- */
  function weekRow(w) {
    return el('div', { class: 'week-row', onclick: () => go({ tab: 'week', week: w.monday }) },
      el('b', {}, range(w.monday, w.sunday)), dual(w.netMin, true),
      el('div', { class: 'sub' }, el('span', {}, 'worked ' + E.hm(w.workedMin)),
        w.legacy ? el('span', {}, 'legacy week') : [el('span', {}, 'Überstunden ' + E.hm(w.usMin)), el('span', {}, 'Überzeit ' + E.hm(w.uzMin, true)), w.creditMin ? el('span', {}, 'holiday credit ' + E.hm(w.creditMin, true)) : null]));
  }
  function monthCounts(prefix) {
    let vac = 0, comp = 0;
    for (const [d, r] of Object.entries(S.days)) {
      if (!r.confirmed || !d.startsWith(prefix)) continue;
      if (r.type === 'vacation') vac += 1; else if (r.type === 'halfvacation') vac += 0.5; else if (r.type === 'comp') comp += 1;
    }
    return { vac, comp };
  }
  function viewMonth(C, today) {
    const key = UI.month, [y, m] = key.split('-').map(Number);
    const mo = C.months[key];
    const out = [topbar(navBtn('‹', () => go({ month: addMonths(key, -1) }), 'Previous month'), `${MONTHS[m - 1]} ${y}`, null,
      [key !== today.slice(0, 7) ? el('button', { class: 'btn small', onclick: () => go({ month: today.slice(0, 7) }) }, 'Today') : null,
        navBtn('›', () => go({ month: addMonths(key, 1) }), 'Next month')])];
    out.push(...banners(today));
    const sum = el('div', { class: 'card' }, el('h3', {}, 'Month totals'));
    const t = mo || { workedMin: 0, nominalMin: 0, netMin: 0, usMin: 0, uzMin: 0, creditMin: 0, legacyMin: 0, adjMin: 0, weeks: [] };
    sum.append(kv('Worked', t.workedMin), kv('Nominal', t.nominalMin), kv('Net', t.netMin, { signed: true, strong: true }),
      kv('Überstunden', t.usMin, { sub: 'tracking only', signed: true }), kv('Überzeit', t.uzMin, { signed: true }));
    if (t.legacyMin) sum.append(kv('Legacy weeks', t.legacyMin, { signed: true }));
    if (t.creditMin) sum.append(kv('Holiday credit', t.creditMin, { signed: true }));
    if (t.adjMin) sum.append(kv('Adjustments', t.adjMin, { signed: true }));
    sum.append(kv('Balance change', t.legacyMin + t.uzMin + t.creditMin + t.adjMin, { signed: true, strong: true, days: true }));
    const mc = monthCounts(key);
    if (mc.vac) sum.append(kvText('Vacation days taken', String(mc.vac)));
    if (mc.comp) sum.append(kvText('Compensation days taken', String(mc.comp)));
    out.push(sum);
    const weeks = el('div', { class: 'card' }, el('h3', {}, 'Weeks ending in this month'));
    if (t.weeks.length) t.weeks.forEach((w) => weeks.append(weekRow(w))); else weeks.append(el('p', { class: 'muted' }, 'No confirmed days.'));
    weeks.append(el('small', {}, 'A week belongs to the month in which it ends (Sunday), as in the old sheet.'));
    out.push(weeks);
    const adj = S.adjustments.filter((a) => !a.deleted && a.date.startsWith(key));
    if (adj.length) out.push(el('div', { class: 'card' }, el('h3', {}, 'Adjustments'), adj.map((a) => el('div', { class: 'kv', onclick: () => openAdj(a) }, el('span', { class: 'lbl' }, a.date, el('small', {}, a.reason)), dual(a.minutes, true)))));
    return out;
  }

  /* ---------- year view ---------- */
  function viewYear(C, today) {
    const y = UI.year;
    const yr = C.years[y] || { workedMin: 0, nominalMin: 0, netMin: 0, usMin: 0, uzMin: 0, creditMin: 0, legacyMin: 0, adjMin: 0, legalUzMin: 0 };
    const out = [topbar(navBtn('‹', () => go({ year: y - 1 }), 'Previous year'), String(y), null,
      [y !== +today.slice(0, 4) ? el('button', { class: 'btn small', onclick: () => go({ year: +today.slice(0, 4) }) }, 'Today') : null, navBtn('›', () => go({ year: y + 1 }), 'Next year')])];
    out.push(...banners(today));
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      const mo = C.months[k];
      if (!mo) continue;
      rows.push(el('tr', { onclick: () => go({ tab: 'month', month: k }), style: 'cursor:pointer' },
        el('td', {}, MONTHS[m - 1].slice(0, 3)), el('td', {}, E.hm(mo.workedMin)), el('td', {}, E.hm(mo.netMin, true)),
        el('td', {}, E.hm(mo.usMin)), el('td', {}, E.hm(mo.uzMin, true)), el('td', {}, E.hm(mo.legacyMin + mo.creditMin + mo.adjMin, true))));
    }
    rows.push(el('tr', { class: 'tot' }, el('td', {}, 'Total'), el('td', {}, E.hm(yr.workedMin)), el('td', {}, E.hm(yr.netMin, true)),
      el('td', {}, E.hm(yr.usMin)), el('td', {}, E.hm(yr.uzMin, true)), el('td', {}, E.hm(yr.legacyMin + yr.creditMin + yr.adjMin, true))));
    out.push(el('div', { class: 'card' }, el('h3', {}, 'Months'), el('div', { class: 'scroll-x' }, el('table', { class: 't' },
      el('tr', {}, ['', 'Worked', 'Net', 'Überst.', 'Überzeit', 'Other'].map((h) => el('th', {}, h))), rows)),
    el('small', {}, 'Other = legacy weeks, holiday credit and adjustments. Decimal values: see Totals or the week view.')));
    const mc = monthCounts(String(y));
    const v = el('div', { class: 'card' }, el('h3', {}, 'Time off ' + y),
      kvText('Vacation taken', `${mc.vac} d`), kvText('Compensation days taken', `${mc.comp} d`),
      kvText('Public holidays in calendar', String(E.holidaysFor(S.settings, y).length)));
    out.push(v);
    return out;
  }

  /* ---------- totals ---------- */
  function viewTotals(C, today) {
    const t = C.totals, s = S.settings, out = [topbar(null, 'Totals', today), ...banners(today)];
    const comp = el('div', { class: 'card' }, el('h3', {}, 'Compensation balance'),
      el('div', { class: 'big ' + (C.balanceMin < 0 ? 'neg' : 'pos') }, E.hm(C.balanceMin), el('small', {}, E.dec(C.balanceMin) + ' h · ' + daysStr(C.balanceMin))),
      el('p', { class: 'muted', style: 'margin:4px 0 8px' }, 'Time you can take off or have paid out.'),
      kv('Legacy weeks', t.legacyMin, { sub: s.cutoff ? `weeks starting before ${s.cutoff}` : 'none', signed: true }),
      kv('Überzeit', t.uzMin, { sub: 'weekly net above the allowance', signed: true }),
      kv('Holiday credit', t.creditMin, { sub: 'surplus on public holidays', signed: true }),
      kv('Adjustments', t.adjMin, { signed: true }),
      kv('Balance', C.balanceMin, { signed: true, strong: true, days: true }));
    out.push(comp);
    const wk = C.weeks[E.weekStart(today)];
    out.push(el('div', { class: 'card' }, el('h3', {}, 'Überstunden (tracking only)'),
      kv('Total since cutoff', t.usMin, { sub: 'covered by contract, never paid' }),
      kv('This week', wk ? wk.usMin : 0, { sub: `allowance ${E.hm(s.freeAllowanceMin)} per week` })));
    const v = C.vacation;
    out.push(el('div', { class: 'card' }, el('h3', {}, 'Vacation ' + v.year),
      el('div', { class: 'big' }, `${v.remaining}`, el('small', {}, 'days left')),
      kvText('Entitlement this year', `${v.perYear} d`),
      kvText('Carried in', `${v.carryIn} d`),
      kvText('Taken this year', `${v.takenYear} d`)));
    out.push(el('div', { class: 'card' }, el('h3', {}, 'Total time off'),
      el('div', { class: 'big' }, C.totalOffDays.toFixed(2), el('small', {}, 'days')),
      kvText('Vacation left', `${v.remaining} d`),
      kvText('Compensation', daysStr(C.balanceMin, true))));
    const y = +today.slice(0, 4), yr = C.years[y], legal = yr ? yr.legalUzMin : 0;
    const bar = (min, cap) => el('div', { class: 'bar' + (min > cap ? ' over' : '') }, el('i', { style: `width:${Math.min(100, cap ? (min / cap) * 100 : 0)}%` }));
    out.push(el('div', { class: 'card' }, el('h3', {}, `Legal Überzeit ${y} (ArG, info)`),
      el('p', { class: 'muted', style: 'margin:0 0 6px' }, `Hours worked above ${E.hm(s.legalWeekMin)} per week. Can differ from your Überzeit above.`),
      kv('Legal Überzeit this year', legal),
      el('small', {}, `Surcharge-free limit ${E.hm(s.legalFreeYearMin)} (${E.dec(s.legalFreeYearMin)} h)`), bar(legal, s.legalFreeYearMin),
      el('small', {}, `Yearly cap ${E.hm(s.legalCapYearMin)} (${E.dec(s.legalCapYearMin)} h)`), bar(legal, s.legalCapYearMin),
      kv('Überzeit by your rule, this year', yr ? yr.uzMin : 0, { signed: true })));
    return out;
  }

  /* ---------- adjustments ---------- */
  function openAdj(a) {
    const isNew = !a;
    a = a ? clone(a) : { id: 'adj-' + Date.now().toString(36), date: E.todayStr(), minutes: 0, reason: '' };
    const dI = dateInput(a.date), mI = durInput(a.minutes, '±h:mm, e.g. 4:12 or -1.5', true), rI = el('input', { type: 'text', value: a.reason, autocomplete: 'off' });
    const err = el('div', { class: 'err' });
    const buttons = [{ label: 'Cancel' }];
    if (!isNew) buttons.push({ label: 'Delete', kind: 'danger', fn: () => { a.deleted = true; saveAdj(a); render(); } });
    buttons.push({ label: 'Save', kind: 'primary', fn: () => {
      const d = readDate(dI), m = readDur(mI);
      if (!d) { err.textContent = 'Date must look like 2026-11-01.'; return false; }
      if (m === undefined || m === 0) { err.textContent = 'Enter hours, e.g. 4:12, -1:30 or 1.5.'; return false; }
      if (!rI.value.trim()) { err.textContent = 'Please give a reason.'; return false; }
      Object.assign(a, { date: d, minutes: m, reason: rI.value.trim() });
      saveAdj(a); render(); return undefined;
    } });
    modal(isNew ? 'New adjustment' : 'Adjustment', [
      el('p', { class: 'muted' }, 'A manual ± credit or debit that goes straight to the compensation balance.'),
      field('Date', dI), field('Hours (±)', mI), field('Reason', rI), err], buttons);
  }
  function viewAdjustments(C) {
    const list = S.adjustments.filter((a) => !a.deleted).sort((a, b) => (a.date < b.date ? 1 : -1));
    return [
      topbar(navBtn('‹', () => go({ more: null }), 'Back'), 'Adjustments'),
      el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Manual ± hours that go straight to the compensation balance (e.g. time lost for work reasons).'),
        list.length ? list.map((a) => el('div', { class: 'kv', style: 'cursor:pointer', onclick: () => openAdj(a) }, el('span', { class: 'lbl' }, a.date, el('small', {}, a.reason)), dual(a.minutes, true))) : el('p', { class: 'muted' }, 'None yet.'),
        kv('Total', C.totals.adjMin, { signed: true, strong: true }),
        el('div', { class: 'btns' }, el('button', { class: 'btn primary', onclick: () => openAdj() }, '+ Add adjustment'))),
    ];
  }

  /* ---------- settings ---------- */
  function viewSettings() {
    const s = S.settings;
    const sch = s.schedule.map((d, i) => {
      const b = (d.breaks && d.breaks[0]) || ['', ''];
      const r = { in: timeInput(d.in), out: timeInput(d.out), bs: timeInput(b[0]), be: timeInput(b[1]), nom: durInput(d.nominalMin, '0:00') };
      return { i, r, node: el('div', { class: 'card' }, el('b', {}, E.WEEKDAYS[i]),
        el('div', { class: 'row tight' }, field('IN', r.in), field('OUT', r.out), field('Break from', r.bs), field('to', r.be), field('Nominal', r.nom))) };
    });
    const f = {
      cutoff: dateInput(s.cutoff), allow: durInput(s.freeAllowanceMin), day: durInput(s.dayMin),
      vpy: el('input', { type: 'text', inputmode: 'decimal', value: String(s.vacationPerYear) }),
      vsy: el('input', { type: 'text', inputmode: 'numeric', value: String(s.vacationStartYear) }),
      vop: el('input', { type: 'text', inputmode: 'decimal', value: String(s.vacationOpening) }),
      start: dateInput(s.startDate), bk: el('input', { type: 'text', inputmode: 'numeric', value: String(s.backupDays) }),
      lw: durInput(s.legalWeekMin), lf: durInput(s.legalFreeYearMin), lc: durInput(s.legalCapYearMin),
    };
    const err = el('div', { class: 'err' });
    const save = () => {
      const n = (i) => { const v = parseFloat(i.value.replace(',', '.')); i.classList.toggle('bad', !isFinite(v) || v < 0); return isFinite(v) && v >= 0 ? v : undefined; };
      const schedule = [];
      for (const { i, r } of sch) {
        const a = readTime(r.in), b = readTime(r.out), c = readTime(r.bs), d = readTime(r.be), nm = readDur(r.nom);
        if ([a, b, c, d].includes(undefined) || nm === undefined || nm < 0) { err.textContent = `${E.WEEKDAYS[i]}: check the times and nominal hours.`; return; }
        schedule.push({ in: a, out: b, breaks: c && d ? [[c, d]] : [], nominalMin: nm });
      }
      const cut = readDate(f.cutoff, true), st = readDate(f.start, true);
      const al = readDur(f.allow), dy = readDur(f.day), lw = readDur(f.lw), lf = readDur(f.lf), lc = readDur(f.lc);
      const vpy = n(f.vpy), vsy = n(f.vsy), vop = n(f.vop), bk = n(f.bk);
      if (cut === undefined || st === undefined || [al, dy, lw, lf, lc].includes(undefined) || [vpy, vsy, vop, bk].includes(undefined) || !dy) {
        err.textContent = 'Some values are invalid (highlighted).'; return;
      }
      Object.assign(s, { schedule, cutoff: cut, startDate: st, freeAllowanceMin: al, dayMin: dy, legalWeekMin: lw, legalFreeYearMin: lf, legalCapYearMin: lc, vacationPerYear: vpy, vacationStartYear: Math.round(vsy), vacationOpening: vop, backupDays: Math.max(1, Math.round(bk)) });
      saveSettings(); err.textContent = ''; toast('Settings saved'); render();
    };
    return [
      topbar(navBtn('‹', () => go({ more: null }), 'Back'), 'Settings'),
      el('p', { class: 'muted' }, 'Default week used to pre-fill days. Planned days are grey until you confirm them.'),
      ...sch.map((x) => x.node),
      el('div', { class: 'card' }, el('h3', {}, 'Rules'),
        field('Überstunden allowance per week (h:mm)', f.allow),
        field('Legacy cutoff: weeks starting before this date use the old rule (empty = never)', f.cutoff),
        field('Length of one day (h:mm), for hours → days', f.day),
        field('Planning starts on (empty = never pre-fill)', f.start)),
      el('div', { class: 'card' }, el('h3', {}, 'Vacation'),
        field('Days per year', f.vpy), field('First year counted', f.vsy), field('Days carried in at the first year', f.vop)),
      el('div', { class: 'card' }, el('h3', {}, 'Legal info limits (ArG)'),
        field('Weekly maximum (h:mm)', f.lw), field('Yearly surcharge-free Überzeit', f.lf), field('Yearly Überzeit cap', f.lc)),
      el('div', { class: 'card' }, el('h3', {}, 'Backup'), field('Remind me after this many days without export', f.bk)),
      err,
      el('div', { class: 'btns' }, el('button', { class: 'btn primary', onclick: save }, 'Save settings')),
    ];
  }

  /* ---------- holidays ---------- */
  function viewHolidays() {
    const y = UI.holYear, s = S.settings;
    const custom = !!(s.holidays && s.holidays[y]);
    const list = E.holidaysFor(s, y);
    const override = () => { if (!s.holidays) s.holidays = {}; if (!s.holidays[y]) s.holidays[y] = clone(E.zhHolidays(y)); return s.holidays[y]; };
    const dI = dateInput(''), nI = el('input', { type: 'text', placeholder: 'Name', autocomplete: 'off' }), hI = el('input', { type: 'checkbox' });
    const err = el('div', { class: 'err' });
    return [
      topbar(navBtn('‹', () => go({ more: null }), 'Back'), 'Holidays ' + y, custom ? 'edited' : 'Zurich calendar',
        [navBtn('−', () => go({ holYear: y - 1 }), 'Previous year'), navBtn('+', () => go({ holYear: y + 1 }), 'Next year')]),
      el('div', { class: 'card' },
        list.map((h) => el('div', { class: 'kv' }, el('span', { class: 'lbl' }, h.date + ' ' + E.WEEKDAYS[E.dow(h.date)], el('small', {}, h.name + (h.half ? ' · half day' : ''))),
          el('button', { class: 'btn small danger', onclick: () => { const o = override(); o.splice(o.findIndex((x) => x.date === h.date), 1); saveSettings(); render(); } }, 'Remove'))),
        !list.length ? el('p', { class: 'muted' }, 'No holidays in this year.') : null),
      el('div', { class: 'card' }, el('h3', {}, 'Add holiday'), field('Date', dI), field('Name', nI),
        el('label', { class: 'f row' }, hI, el('span', { style: 'margin:0' }, 'Half day (afternoon)')), err,
        el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => {
          const d = readDate(dI);
          if (!d || +d.slice(0, 4) !== y) { err.textContent = `Enter a date in ${y}, like ${y}-12-24.`; return; }
          if (!nI.value.trim()) { err.textContent = 'Please enter a name.'; return; }
          const o = override();
          if (o.some((x) => x.date === d)) { err.textContent = 'That date already exists.'; return; }
          o.push({ date: d, name: nI.value.trim(), half: hI.checked || undefined }); o.sort((a, b) => (a.date < b.date ? -1 : 1));
          saveSettings(); render();
        } }, 'Add'),
        custom ? el('button', { class: 'btn danger', onclick: async () => { if (await confirmBox(`Discard your edits and restore the generated calendar for ${y}?`, 'Restore', 'danger')) { delete s.holidays[y]; saveSettings(); render(); } } }, 'Restore generated calendar') : null)),
    ];
  }

  /* ---------- sync: export / import ---------- */
  const exportName = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_worktime.json`; };
  const exportObject = () => ({ app: 'wl', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, days: S.days, deleted: S.deleted, adjustments: S.adjustments });
  function markExport() { META.lastExportAt = new Date().toISOString(); persistMeta(); render(); }
  async function doExport(share) {
    const name = exportName(), text = JSON.stringify(exportObject(), null, 1);
    if (share && navigator.canShare && navigator.share) {
      for (const type of ['application/json', 'text/plain']) {
        const file = new File([text], name, { type });
        if (!navigator.canShare({ files: [file] })) continue;
        try { await navigator.share({ files: [file], title: name }); markExport(); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
    }
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    document.body.append(a); a.click(); a.remove();
    markExport(); toast('Saved ' + name);
  }
  async function handleFile(f, replace) {
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { toast('That file is not valid JSON'); return; }
    if (!data || data.app !== 'wl' || typeof data.days !== 'object') { toast('That is not a backup file from this app'); return; }
    await previewImport(E.normalize(data), replace, f.name);
  }
  function pickFile(replace) {
    const inp = el('input', { type: 'file', accept: '.json,application/json,text/plain' });
    inp.addEventListener('change', () => { if (inp.files[0]) handleFile(inp.files[0], replace); });
    inp.click();
  }
  async function previewImport(inc, replace, name) {
    const dates = Object.keys(inc.days).sort();
    const info = el('div', {}, kvText('File', name), kvText('Days in file', `${dates.length}${dates.length ? ` (${dates[0]} … ${dates[dates.length - 1]})` : ''}`),
      kvText('Adjustments in file', String(inc.adjustments.filter((a) => !a.deleted).length)));
    let apply;
    if (replace) {
      info.append(el('p', { class: 'neg' }, `This replaces everything on this device (${Object.keys(S.days).length} days).`));
      apply = () => inc;
    } else {
      const { state, stats } = E.merge(S, inc);
      info.append(kvText('New days', String(stats.added)), kvText('Updated days (file is newer)', String(stats.updated)), kvText('Removed days', String(stats.removed)),
        kvText('New / updated adjustments', `${stats.adjAdded} / ${stats.adjUpdated}`), kvText('Settings from file', stats.settings ? 'yes (file is newer)' : 'no, keeping this device'));
      apply = () => state;
    }
    modal(replace ? 'Replace all data' : 'Import and merge', info, [{ label: 'Cancel' }, { label: replace ? 'Replace' : 'Merge', kind: replace ? 'danger' : 'primary', fn: async () => {
      await store.set('prev', S);
      S = apply(); persist(); render(); toast('Imported', { label: 'Undo', fn: undoImport });
    } }]);
  }
  async function undoImport() {
    const prev = await store.get('prev');
    if (!prev) { toast('Nothing to undo'); return; }
    S = E.normalize(prev); persist(); render(); toast('Previous data restored');
  }
  function viewSync() {
    const n = Object.keys(S.days).length, ds = Object.keys(S.days).sort();
    return [
      topbar(navBtn('‹', () => go({ more: null }), 'Back'), 'Backup & sync'),
      el('div', { class: 'card' }, el('h3', {}, 'Export'),
        kvText('Last export', META.lastExportAt ? localStamp(META.lastExportAt) : 'never', META.lastExportAt ? '' : 'warn'),
        kvText('File name', exportName()),
        el('div', { class: 'btns' },
          el('button', { class: 'btn primary', onclick: () => doExport(true) }, 'Share / save file'),
          el('button', { class: 'btn', onclick: () => doExport(false) }, 'Download')),
        el('p', { class: 'muted' }, 'Send the file to yourself (Drive, Slack, email) and import it on the other device. The date in the name is the day you export.')),
      el('div', { class: 'card' }, el('h3', {}, 'Import'),
        el('p', { class: 'muted' }, 'Merging keeps the newest edit of every day, so the order of syncs does not matter. A day you deleted stays deleted unless it was edited afterwards elsewhere.'),
        el('div', { class: 'btns' }, el('button', { class: 'btn primary', onclick: () => pickFile(false) }, 'Import and merge…'),
          el('button', { class: 'btn danger', onclick: () => pickFile(true) }, 'Replace all data…'),
          el('button', { class: 'btn', onclick: () => undoImport() }, 'Undo last import'))),
      el('div', { class: 'card' }, el('h3', {}, 'This device'), kvText('Days stored', String(n)), n ? kvText('Range', `${ds[0]} … ${ds[n - 1]}`) : null,
        kvText('Adjustments', String(S.adjustments.filter((a) => !a.deleted).length))),
    ];
  }

  /* ---------- more ---------- */
  function viewMore(C, today) {
    if (UI.more === 'adj') return viewAdjustments(C);
    if (UI.more === 'settings') return viewSettings();
    if (UI.more === 'holidays') return viewHolidays();
    if (UI.more === 'sync') return viewSync();
    const item = (label, sub, key) => el('button', { class: 'btn', onclick: () => go({ more: key }) }, el('span', {}, label, el('small', { style: 'display:block' }, sub)), el('span', {}, '›'));
    return [
      topbar(null, 'More'), ...banners(today),
      el('div', { class: 'menu' },
        item('Backup & sync', META.lastExportAt ? 'last export ' + localStamp(META.lastExportAt) : 'no export yet', 'sync'),
        item('Adjustments', 'manual ± hours', 'adj'),
        item('Settings', 'schedule, rules, vacation', 'settings'),
        item('Holidays', 'Zurich calendar, editable', 'holidays')),
      el('div', { class: 'card' }, el('h3', {}, 'About'), kvText('Version', VERSION),
        el('p', { class: 'muted' }, 'Everything is stored on this device only. Use Backup & sync to move data between devices.'),
        el('div', { class: 'btns' }, el('button', { class: 'btn danger small', onclick: async () => {
          if (await confirmBox('Delete ALL data on this device? Export a backup first.', 'Delete everything', 'danger')) {
            await store.set('prev', S); S = E.emptyState(); persist(); render(); toast('Deleted', { label: 'Undo', fn: undoImport });
          }
        } }, 'Delete all data'))),
    ];
  }

  /* ---------- render ---------- */
  function render() {
    const y = window.scrollY, C = E.compute(S), today = E.todayStr();
    const views = { week: viewWeek, month: viewMonth, year: viewYear, totals: viewTotals, more: viewMore };
    $app.replaceChildren(...views[UI.tab](C, today).filter(Boolean), tabs(C, today));
    window.scrollTo(0, y);
  }

  /* ---------- boot ---------- */
  async function boot() {
    try {
      const st = await store.get('state');
      if (st) S = E.normalize(st);
      const m = await store.get('meta');
      if (m) META = m;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) { /* start empty */ }
    render();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !document.querySelector('.backdrop')) render(); });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const had = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast('Updated to a new version', { label: 'Reload', fn: () => location.reload() }); });
    }
  }
  window.__wl = { get state() { return S; }, render, UI, E, handleFile, doExport };
  boot();
})();
