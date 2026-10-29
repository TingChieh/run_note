// Synthetic wellbeing journal for the browser UI contract tests: in memory, synthetic rows only, no database.
import { randomUUID } from 'node:crypto';

const RATINGS = ['mood', 'anxiety', 'energy', 'focus', 'functioning', 'sleep_quality'];

/** @param {() => Record<string, any>} getUser */
export function createWellbeing(getUser) {
  /** @type {Map<string, any>} */ let entries = new Map();
  /** @type {any[]} */ let doses = [];
  /** @type {any[]} */ let symptoms = [];
  /** @type {any[]} */ let meds = [];
  /** @type {{medication_id: string, pills: number}[]} */ let ledger = [];
  /** @type {any[]} */ let names = [];
  let tick = 0;
  const zone = () => getUser().timezone;
  const day = (/** @type {Date | string} */ value) => new Intl.DateTimeFormat('en-CA', { timeZone: zone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const stamp = () => new Date(Date.now() + ++tick).toISOString();
  const mean = (/** @type {number[]} */ values) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null;
  const addDays = (/** @type {string} */ date, /** @type {number} */ n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const dosesOn = (/** @type {string} */ date) => doses.filter(d => d.entry_date === date).sort((a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at));
  const between = (/** @type {any[]} */ rows, /** @type {string} */ from, /** @type {string} */ to) => rows.filter(r => r.entry_date >= from && r.entry_date <= to);
  const DOSE_FIELDS = new Set(['medication_name', 'medication_id', 'pills', 'dose_amount', 'dose_unit', 'taken_at', 'regimen', 'note']);
  const SYMPTOM_FIELDS = new Set(['entry_date', 'symptom', 'severity', 'onset_at', 'duration_minutes', 'affects_daily_life']);
  /** @param {string} date */
  const view = date => ({ date, today: day(new Date()), timezone: zone(), entry: entries.get(date) ?? null, doses: dosesOn(date), symptoms: symptoms.filter(s => s.entry_date === date) });
  const stats = (/** @type {any[]} */ rows) => {
    const names = [...new Set(rows.map(r => r.symptom))];
    return names.map(name => {
      const items = rows.filter(r => r.symptom === name);
      return { symptom: name, count: items.length, days: new Set(items.map(i => i.entry_date)).size, avg_severity: null, max_severity: null, affects_daily_life_count: items.filter(i => i.affects_daily_life).length };
    }).sort((a, b) => b.count - a.count);
  };
  const preceding = (/** @type {any} */ event, /** @type {any[]} */ all) => {
    if (!event.onset_at) return null;
    const at = Date.parse(event.onset_at);
    const earlier = all.filter(d => Date.parse(d.taken_at) <= at && at - Date.parse(d.taken_at) <= 86400000);
    if (!earlier.length) return null;
    const last = earlier.reduce((a, b) => Date.parse(b.taken_at) > Date.parse(a.taken_at) ? b : a);
    return { medication_name: last.medication_name, minutes_before: Math.floor((at - Date.parse(last.taken_at)) / 60000) };
  };

  /** @returns {Promise<boolean>} */
  async function handle(/** @type {import('node:http').IncomingMessage} */ req, /** @type {URL} */ url, /** @type {import('node:http').ServerResponse} */ res) {
    const json = (/** @type {number} */ status, /** @type {any} */ data, code = 'UI_FIXTURE_ERROR', message = '请求无效') => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ data: status >= 400 ? null : data, error: status >= 400 ? { code, message, details: [] } : null, meta: { request_id: 'ui-fixture' } }));
      return true;
    };
    const path = url.pathname.replace('/api/v1/me/wellbeing', '') || '/';
    const write = req.method !== 'GET';
    if (write && req.headers['x-csrf-token'] !== 'ui-csrf') return json(403, null, 'CSRF_FAILED', '请求来源或CSRF令牌不合法');
    /** @type {any} */ let body = null;
    if (write && req.method !== 'DELETE') { let raw = ''; for await (const chunk of req) raw += chunk; body = JSON.parse(raw || '{}'); }
    const today = day(new Date());
    /** @type {any} */
    let m;

    if ((m = path.match(/^\/days\/(\d{4}-\d{2}-\d{2})$/)) && req.method === 'GET') return json(200, view(m[1]));
    if ((m = path.match(/^\/days\/(\d{4}-\d{2}-\d{2})\/entry$/))) {
      const date = m[1];
      if (req.method === 'PUT') {
        if (date > today) return json(422, null, 'FUTURE_DATE', '不能记录未来的日期');
        const answers = Object.fromEntries([...RATINGS, 'sleep_hours', 'note'].map(k => [k, body[k] ?? null]));
        if (Object.values(answers).every(v => v === null || v === '')) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
        if (RATINGS.some(k => answers[k] !== null && (!Number.isInteger(answers[k]) || answers[k] < 0 || answers[k] > 10))) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
        const existing = entries.get(date);
        if ('based_on' in body && (body.based_on === null ? !!existing : !existing || existing.updated_at !== body.based_on)) return json(409, null, 'ENTRY_CHANGED', '这一天的记录已在其他位置更新，请刷新后再保存');
        const entry = { entry_date: date, ...answers, updated_at: stamp() };
        entries.set(date, entry);
        return json(200, entry);
      }
      if (req.method === 'DELETE') return entries.delete(date) ? json(200, { deleted: true }) : json(404, null, 'RESOURCE_NOT_FOUND', '记录不存在');
    }
    if (path === '/days' && req.method === 'GET') {
      const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '';
      const dates = new Set([...between([...entries.values()], from, to), ...between(doses, from, to), ...between(symptoms, from, to)].map(r => r.entry_date));
      return json(200, [...dates].sort().map(date => ({ date, has_entry: entries.has(date), dose_count: dosesOn(date).length, symptom_count: symptoms.filter(s => s.entry_date === date).length })));
    }
    if (path === '/entries' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 20), offset = Number(url.searchParams.get('offset') ?? 0);
      const all = [...entries.values()].sort((a, b) => b.entry_date.localeCompare(a.entry_date));
      return json(200, { items: all.slice(offset, offset + limit), total: all.length, limit, offset });
    }
    const taken = (/** @type {any} */ med) => doses.filter(d => d.medication_id === med.id && d.pills !== null).reduce((sum, d) => sum + d.pills, 0);
    const medView = (/** @type {any} */ med) => {
      const own = doses.filter(d => d.medication_id === med.id).sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at));
      const moves = ledger.filter(x => x.medication_id === med.id);
      let stock = null;
      if (moves.length) {
        const pills = Math.round((moves.reduce((sum, x) => sum + x.pills, 0) - taken(med)) * 100) / 100;
        const recent = doses.filter(d => d.medication_id === med.id && d.pills !== null && Date.parse(d.taken_at) >= Date.now() - 14 * 86400000).reduce((sum, d) => sum + d.pills, 0);
        const avg = recent / 14;
        const boxes = med.pills_per_box && pills >= 0 ? Math.floor(pills / med.pills_per_box) : null;
        stock = { pills, boxes, loose_pills: boxes === null ? null : Math.round((pills - boxes * med.pills_per_box) * 100) / 100, avg_daily_pills: avg > 0 ? Math.round(avg * 100) / 100 : null, days_left: avg > 0 ? (pills <= 0 ? 0 : Math.round(pills / avg * 10) / 10) : null };
      }
      return { ...med, dose_count: own.length, last_taken_at: own[0]?.taken_at ?? null, stock };
    };
    const newMed = (/** @type {any} */ b) => ({ id: randomUUID(), name: b.name.trim(), count_unit: b.count_unit ?? '颗', pills_per_box: b.pills_per_box ?? null, strength_amount: b.strength_amount ?? null, strength_unit: b.strength_unit ?? null, default_pills: b.default_pills ?? null, regimen: b.regimen ?? 'scheduled', side_effects: [...new Map((b.side_effects ?? []).map((/** @type {string} */ n) => [n.trim().toLowerCase(), n.trim()])).values()] });
    if (path === '/medications' && req.method === 'GET') return json(200, meds.map(medView));
    if (path === '/medications' && req.method === 'POST') {
      const name = body.name?.trim();
      if (!name || (body.strength_amount != null) !== (body.strength_unit != null) || (body.pills_per_box != null && !(body.pills_per_box >= 1))) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
      if (meds.some(m => m.name.toLowerCase() === name.toLowerCase())) return json(409, null, 'MEDICATION_EXISTS', '已经有同名的药物（不区分大小写）');
      const med = newMed(body);
      meds.push(med);
      return json(201, medView(med));
    }
    if ((m = path.match(/^\/medications\/([0-9a-f-]{36})\/stock(\/count)?$/)) && req.method === 'POST') {
      const med = meds.find(x => x.id === m[1]);
      if (!med) return json(404, null, 'RESOURCE_NOT_FOUND', '记录不存在');
      if (body.boxes > 0 && !med.pills_per_box) return json(422, null, 'NO_BOX_SIZE', '先在药物里填写“每盒几颗”，才能按盒数计算');
      const total = (body.boxes ?? 0) * (med.pills_per_box ?? 0) + (body.pills ?? 0);
      if (m[2]) {
        const have = ledger.filter(x => x.medication_id === med.id).reduce((sum, x) => sum + x.pills, 0) - taken(med);
        ledger.push({ medication_id: med.id, pills: total - have });
        if (total - have === 0 && ledger.filter(x => x.medication_id === med.id).length === 1) ledger.push({ medication_id: med.id, pills: 0.0001 });
      } else {
        if (!(total > 0)) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
        ledger.push({ medication_id: med.id, pills: total });
      }
      return json(200, medView(med));
    }
    if ((m = path.match(/^\/medications\/([0-9a-f-]{36})$/))) {
      const med = meds.find(x => x.id === m[1]);
      if (!med) return json(404, null, 'RESOURCE_NOT_FOUND', '记录不存在');
      if (req.method === 'DELETE') { meds = meds.filter(x => x !== med); ledger = ledger.filter(x => x.medication_id !== med.id); doses.forEach(d => { if (d.medication_id === med.id) d.medication_id = null; }); return json(200, { deleted: true }); }
      if (req.method === 'PATCH') {
        if (body.name && meds.some(x => x !== med && x.name.toLowerCase() === body.name.trim().toLowerCase())) return json(409, null, 'MEDICATION_EXISTS', '已经有同名的药物（不区分大小写）');
        Object.assign(med, body, body.name ? { name: body.name.trim() } : {});
        return json(200, medView(med));
      }
    }
    if (path === '/symptom-names' && req.method === 'GET') return json(200, names.map(n => ({ ...n, event_count: symptoms.filter(s => s.symptom.toLowerCase() === n.name.toLowerCase()).length })));
    if (path === '/symptom-names' && req.method === 'POST') {
      const name = body.name?.trim();
      if (!name || [...name].length > 40) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
      if (names.some(n => n.name.toLowerCase() === name.toLowerCase())) return json(409, null, 'SYMPTOM_NAME_EXISTS', '已经有同名的副作用（不区分大小写）');
      const item = { id: randomUUID(), name };
      names.push(item);
      return json(201, { ...item, event_count: 0 });
    }
    if ((m = path.match(/^\/symptom-names\/([0-9a-f-]{36})$/)) && req.method === 'DELETE') {
      const item = names.find(n => n.id === m[1]);
      if (!item) return json(404, null, 'RESOURCE_NOT_FOUND', '记录不存在');
      names = names.filter(n => n !== item);
      return json(200, { deleted: true });
    }
    const resolve = (/** @type {any} */ b) => {
      if (b.medication_id) return meds.find(x => x.id === b.medication_id) ?? null;
      let med = meds.find(x => x.name.toLowerCase() === b.medication_name.trim().toLowerCase());
      if (!med) { med = newMed({ name: b.medication_name, default_pills: b.pills ?? null, regimen: b.regimen }); meds.push(med); }
      return med;
    };
    const makeDose = (/** @type {any} */ med, /** @type {any} */ b, /** @type {string} */ takenAt, /** @type {number | null} */ pills) => ({
      id: randomUUID(), entry_date: day(takenAt), medication_name: med.name, medication_id: med.id, pills,
      dose_amount: b.dose_amount ?? (pills !== null && med.strength_amount !== null ? Math.round(pills * med.strength_amount * 1000) / 1000 : null),
      dose_unit: b.dose_amount != null ? b.dose_unit : (pills !== null && med.strength_amount !== null ? med.strength_unit : null),
      taken_at: new Date(takenAt).toISOString(), regimen: b.regimen ?? med.regimen, note: b.note ?? null
    });
    if (path === '/doses/batch' && req.method === 'POST') {
      const med = meds.find(x => x.id === body.medication_id);
      if (!med) return json(404, null, 'RESOURCE_NOT_FOUND', '记录不存在');
      const pills = body.pills ?? med.default_pills;
      if (pills == null) return json(422, null, 'NO_PILL_COUNT', '请填写每次几颗，或先在药物里设置“每次默认颗数”');
      if (body.end_date > today || body.end_date < body.start_date) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
      let created = 0, existing = 0, future = 0;
      for (let d = body.start_date; d <= body.end_date; d = addDays(d, 1)) for (const t of body.times) {
        const at = new Date(`${d}T${t}:00+08:00`).toISOString();
        if (Date.parse(at) > Date.now() + 600000) future++;
        else if (doses.some(x => x.medication_id === med.id && x.taken_at === at)) existing++;
        else { doses.push(makeDose(med, { note: body.note }, at, pills)); created++; }
      }
      return json(201, { created, skipped_existing: existing, skipped_future: future });
    }
    if (path === '/doses' && req.method === 'POST') {
      if (Object.keys(body).some(key => !DOSE_FIELDS.has(key))) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
      if (!body.medication_name?.trim() || !Number.isFinite(Date.parse(body.taken_at)) || (body.pills == null && body.dose_amount == null) || (body.pills != null && !(body.pills > 0))) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
      if (Date.parse(body.taken_at) > Date.now() + 600000) return json(422, null, 'FUTURE_TIME', '时间不能晚于现在');
      const med = resolve(body);
      if (!med) return json(404, null, 'RESOURCE_NOT_FOUND', '记录不存在');
      const dose = makeDose(med, body, body.taken_at, body.pills ?? null);
      doses.push(dose);
      return json(201, dose);
    }
    if ((m = path.match(/^\/doses\/([0-9a-f-]{36})$/))) {
      const dose = doses.find(d => d.id === m[1]);
      if (!dose) return json(404, null, 'RESOURCE_NOT_FOUND', '记录不存在');
      if (req.method === 'DELETE') { doses = doses.filter(d => d !== dose); return json(200, { deleted: true }); }
      if (req.method === 'PATCH') {
        // Like the real API (extra="forbid"): a field it does not know is refused, so a client that sends one fails here too.
        if (Object.keys(body).some(key => !DOSE_FIELDS.has(key))) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
        Object.assign(dose, body);
        if (body.pills != null && body.dose_amount == null) { const med = meds.find(x => x.id === dose.medication_id); dose.dose_amount = med && med.strength_amount !== null ? Math.round(body.pills * med.strength_amount * 1000) / 1000 : null; dose.dose_unit = dose.dose_amount === null ? null : med.strength_unit; }
        if (body.taken_at) { dose.taken_at = new Date(body.taken_at).toISOString(); dose.entry_date = day(dose.taken_at); }
        return json(200, dose);
      }
    }
    if (path === '/symptoms' && req.method === 'POST') {
      if (Object.keys(body).some(key => !SYMPTOM_FIELDS.has(key))) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
      if (!body.symptom?.trim() || (body.severity != null && (!Number.isInteger(body.severity) || body.severity < 0 || body.severity > 10)) || !/^\d{4}-\d{2}-\d{2}$/.test(body.entry_date ?? '')) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
      const symptom = { id: randomUUID(), entry_date: body.entry_date, symptom: body.symptom.trim(), severity: body.severity ?? null, onset_at: body.onset_at ?? null, duration_minutes: body.duration_minutes ?? null, affects_daily_life: body.affects_daily_life ?? null };
      symptoms.push(symptom);
      if (!names.some(n => n.name.toLowerCase() === symptom.symptom.toLowerCase())) names.push({ id: randomUUID(), name: symptom.symptom });
      return json(201, symptom);
    }
    if ((m = path.match(/^\/symptoms\/([0-9a-f-]{36})$/))) {
      const symptom = symptoms.find(s => s.id === m[1]);
      if (!symptom) return json(404, null, 'RESOURCE_NOT_FOUND', '记录不存在');
      if (req.method === 'DELETE') { symptoms = symptoms.filter(s => s !== symptom); return json(200, { deleted: true }); }
      if (req.method === 'PATCH') { if (Object.keys(body).some(key => !SYMPTOM_FIELDS.has(key))) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法'); Object.assign(symptom, body); return json(200, symptom); }
    }
    if (path === '/trends' && req.method === 'GET') {
      const days = Number(url.searchParams.get('days') ?? 30);
      if (![7, 14, 30].includes(days)) return json(422, null, 'VALIDATION_ERROR', '请求参数不合法');
      const start = addDays(today, -(days - 1));
      const series = Array.from({ length: days }, (_, i) => {
        const date = addDays(start, i), entry = entries.get(date), events = symptoms.filter(s => s.entry_date === date);
        return { date, ...Object.fromEntries(RATINGS.map(k => [k, entry?.[k] ?? null])), sleep_hours: entry?.sleep_hours ?? null, dose_count: dosesOn(date).length, symptom_count: events.length, symptom_max_severity: null };
      });
      return json(200, { days, start, end: today, timezone: zone(), recorded_days: series.filter(p => entries.has(p.date)).length, series, symptoms: stats(between(symptoms, start, today)) });
    }
    if ((path === '/report' || path === '/report.csv') && req.method === 'GET') {
      const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '';
      if (!from || !to || to < from) return json(422, null, 'INVALID_RANGE', '结束日期不能早于开始日期');
      const rows = between([...entries.values()], from, to).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
      if (path === '/report.csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="wellbeing-${url.searchParams.get('kind') ?? 'entries'}-${from}_${to}.csv"`, 'Cache-Control': 'no-store' });
        res.end('﻿日期,开心程度\r\n' + rows.map(r => `${r.entry_date},${r.mood ?? ''}`).join('\r\n') + '\r\n');
        return true;
      }
      const span = [];
      for (let d = from; d <= to; d = addDays(d, 1)) span.push(d);
      const have = new Set(rows.map(r => r.entry_date));
      const missing = span.filter(d => !have.has(d));
      const inRange = between(doses, from, to).sort((a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at));
      const events = between(symptoms, from, to);
      const meds = [...new Set(inRange.map(d => d.medication_name))].map(name => {
        const own = inRange.filter(d => d.medication_name === name);
        /** @type {any[]} */ const timeline = [];
        own.forEach((d, i) => { const before = own[i - 1]; if (!before || before.pills !== d.pills || before.dose_amount !== d.dose_amount || before.dose_unit !== d.dose_unit) timeline.push({ date: d.entry_date, taken_at: d.taken_at, pills: d.pills, dose_amount: d.dose_amount, dose_unit: d.dose_unit, kind: before ? 'changed' : 'first_in_range' }); });
        return { name, total_pills: own.reduce((sum, d) => sum + (d.pills ?? 0), 0), dose_count: own.length, scheduled_count: own.filter(d => d.regimen === 'scheduled').length, as_needed_count: own.filter(d => d.regimen === 'as_needed').length, first_taken_at: own[0].taken_at, last_taken_at: own.at(-1).taken_at, timeline };
      });
      const hours = rows.filter(r => r.sleep_hours !== null).map(r => r.sleep_hours), quality = rows.filter(r => r.sleep_quality !== null).map(r => r.sleep_quality);
      return json(200, {
        start: from, end: to, timezone: zone(), generated_on: today,
        coverage: { days_in_range: span.length, days_with_entry: rows.length, days_without_entry: missing.length, missing_dates: missing, unanswered: Object.fromEntries([...RATINGS, 'sleep_hours'].map(k => [k, rows.filter(r => r[k] === null).length])) },
        ratings: RATINGS.map(key => { const v = rows.map(r => r[key]).filter(x => x !== null); return { key, answered_days: v.length, mean: mean(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, first: v[0] ?? null, last: v.at(-1) ?? null }; }),
        weekly: [], sleep: { answered_days: hours.length, mean_hours: mean(hours), min_hours: hours.length ? Math.min(...hours) : null, max_hours: hours.length ? Math.max(...hours) : null, quality_answered_days: quality.length, mean_quality: mean(quality) },
        medications: meds, doses: inRange, symptoms: stats(events), symptom_events: events.map(e => ({ ...e, preceding_dose: preceding(e, inRange) })),
        notes: rows.filter(r => r.note).map(r => ({ date: r.entry_date, note: r.note }))
      });
    }
    return json(404, null, 'RESOURCE_NOT_FOUND', '资源不存在');
  }
  return { handle, reset() { entries = new Map(); doses = []; symptoms = []; meds = []; names = []; ledger = []; } };
}
