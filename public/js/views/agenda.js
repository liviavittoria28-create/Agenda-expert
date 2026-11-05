// Agenda — visões dia, semana, mês e ano (CSU08, RF16–RF18, RF20)
import { api } from '../api.js';
import { I } from '../icons.js';
import {
  state, esc, money, cap, MONTHS, MONTHS_SHORT, DOW_SHORT, parseD, addDays, addMonths, startOfWeek, daysInMonth,
  fmtDayLong, fmtDayShort, toMin, nowMinBR, statusBadge, go, qs, empty,
} from '../ui.js';
import { openAppointmentForm, openAppointmentDetail, openBlockForm } from './appointment.js';

const VIEWS = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['ano', 'Ano']];
const ACTIVE = (a) => a.status !== 'cancelada' && a.status !== 'faltou';

export async function renderAgenda(main, ctx) {
  const view = VIEWS.some(([k]) => k === ctx.query.v) ? ctx.query.v : 'mes';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.d || '') ? ctx.query.d : state.today;
  const link = (v, date) => `#/agenda${qs({ v, d: date })}`;

  let title, eyebrow, prev, next;
  const x = parseD(d);
  if (view === 'ano') {
    eyebrow = 'Visão anual'; title = `${x.getUTCFullYear()}`;
    prev = `${x.getUTCFullYear() - 1}-01-01`; next = `${x.getUTCFullYear() + 1}-01-01`;
  } else if (view === 'mes') {
    eyebrow = `${x.getUTCFullYear()}`; title = cap(MONTHS[x.getUTCMonth()]);
    prev = addMonths(d, -1); next = addMonths(d, 1);
  } else if (view === 'semana') {
    const ws = startOfWeek(d), we = addDays(ws, 6);
    eyebrow = 'Semana'; title = `${fmtDayShort(ws)} – ${fmtDayShort(we)}`;
    prev = addDays(d, -7); next = addDays(d, 7);
  } else {
    eyebrow = d === state.today ? 'Hoje' : cap(['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][x.getUTCDay()]);
    title = `${x.getUTCDate()} de ${MONTHS[x.getUTCMonth()]}`;
    prev = addDays(d, -1); next = addDays(d, 1);
  }

  main.innerHTML = `
    <div class="page">
      <header class="top">
        <div><div class="top__eyebrow">${eyebrow}</div><h1>${esc(title)}</h1></div>
        <div class="top__actions">
          <button class="icon-btn" data-go="${link(view, prev)}" aria-label="Anterior">${I.left}</button>
          <button class="icon-btn" data-go="${link(view, next)}" aria-label="Próximo">${I.right}</button>
        </div>
      </header>
      <div class="cal-head">
        <div class="seg" role="tablist">${VIEWS.map(([k, l]) => `<button role="tab" class="${k === view ? 'is-on' : ''}" data-go="${link(k, d)}">${l}</button>`).join('')}</div>
        <div class="cal-nav">
          ${(view === 'ano' ? d.slice(0, 4) !== state.today.slice(0, 4) : view === 'mes' ? d.slice(0, 7) !== state.today.slice(0, 7) : view === 'semana' ? startOfWeek(d) !== startOfWeek(state.today) : d !== state.today) ? `<button class="btn btn--ghost btn--sm" data-go="${link(view, state.today)}">Hoje</button>` : ''}
          <button class="icon-btn" data-block aria-label="Bloquear agenda" title="Bloquear agenda">${I.lock}</button>
        </div>
      </div>
      <div data-body><div class="spinner"></div></div>
    </div>
    ${view !== 'ano' ? `<button class="fab" data-new aria-label="Novo agendamento">${I.plus}</button>` : ''}`;

  main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  main.querySelector('[data-block]').onclick = () => openBlockForm({ date: d });
  const sel = { date: d };
  main.querySelector('[data-new]')?.addEventListener('click', () => openAppointmentForm({ date: sel.date < state.today ? state.today : sel.date }));

  const body = main.querySelector('[data-body]');
  enableSwipe(body, () => go(link(view, next)), () => go(link(view, prev)));

  if (view === 'ano') return renderYear(body, d, ctx);
  let from, to;
  if (view === 'mes') { const first = d.slice(0, 8) + '01'; from = startOfWeek(first); to = addDays(from, 41); }
  else if (view === 'semana') { from = startOfWeek(d); to = addDays(from, 6); }
  else { from = to = d; }
  const data = await api.get(`/api/appointments?from=${from}&to=${to}`);
  if (!ctx.isCurrent()) return;
  const byDay = groupByDay(data.appointments);
  const blocksFor = (date) => data.blocks.filter((b) => b.start_date <= date && b.end_date >= date);

  if (view === 'mes') {
    const select = (day) => {
      sel.date = day;
      renderMonth(body, day, from, byDay, blocksFor, link, select);
      bindItems(body, data);
    };
    return select(d);
  }
  else if (view === 'semana') renderWeek(body, d, from, byDay, blocksFor, link);
  else renderDay(body, d, byDay[d] || [], blocksFor(d));
  bindItems(body, data);
}

function groupByDay(list) {
  const m = {};
  for (const a of list) (m[a.date] ||= []).push(a);
  return m;
}

function bindItems(body, data) {
  body.querySelectorAll('[data-appt]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    openAppointmentDetail(data.appointments.find((a) => a.id === Number(b.dataset.appt)));
  }));
  body.querySelectorAll('[data-blk]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    openBlockForm({ block: data.blocks.find((x) => x.id === Number(b.dataset.blk)) });
  }));
}

// ---------------------------------------------------------------- Mês
function renderMonth(body, d, from, byDay, blocksFor, link, onSelect) {
  const month = d.slice(0, 7);
  const cells = [];
  const lastDay = `${month}-${String(daysInMonth(+d.slice(0, 4), +d.slice(5, 7))).padStart(2, '0')}`;
  const weeks = Math.ceil((parseD(lastDay) - parseD(from)) / 864e5 / 7 + 0.01);
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(from, i);
    const list = byDay[day] || [];
    const bl = blocksFor(day);
    const full = bl.some((b) => b.all_day);
    const cls = ['day', day.slice(0, 7) !== month && 'is-out', day === state.today && 'is-today', day === d && 'is-sel', full && 'is-blocked'].filter(Boolean).join(' ');
    const dots = list.slice(0, 4).map((a) => `<span class="dot st-${a.status}" style="background:var(--c)"></span>`).join('');
    cells.push(`<button class="${cls}" data-day="${day}" aria-label="${fmtDayLong(day)}${list.length ? `, ${list.length} atendimento(s)` : ''}${full ? ', bloqueado' : ''}">
      <span class="day__n">${+day.slice(8)}</span>
      ${full && !list.length ? '<span class="day__bl">Bloq.</span>' : `<span class="day__dots">${dots}${list.length > 4 ? '<span class="day__more">+</span>' : ''}</span>`}
    </button>`);
  }
  const list = byDay[d] || [];
  const bl = blocksFor(d);
  const active = list.filter(ACTIVE);
  body.innerHTML = `
    <div class="card month">
      <div class="month__dow">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="month__grid">${cells.join('')}</div>
      <div class="legend">
        <span><span class="dot st-agendada" style="background:var(--c)"></span>Agendada</span>
        <span><span class="dot st-confirmada" style="background:var(--c)"></span>Confirmada</span>
        <span><span class="dot st-concluida" style="background:var(--c)"></span>Concluída</span>
        <span><span class="dot st-cancelada" style="background:var(--c)"></span>Cancelada</span>
        <span><span class="dot st-faltou" style="background:var(--c)"></span>Faltou</span>
        <span><i class="hatch"></i>Bloqueio</span>
      </div>
    </div>
    <div class="section-title"><b>${fmtDayLong(d)}</b><span>${active.length ? `${active.length} · ${money(active.reduce((s, a) => s + a.total_cents, 0))}` : ''}</span></div>
    ${dayList(list, bl, d)}`;
  body.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => {
    const day = b.dataset.day;
    if (day.slice(0, 7) !== month) return go(link('mes', day));
    history.replaceState(null, '', link('mes', day));
    onSelect(day);
  }));
  body.querySelector('[data-add]')?.addEventListener('click', () => openAppointmentForm({ date: d }));
}

function dayList(list, blocks, d) {
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  const html = [
    ...blocks.map((b) => `
      <button class="block-card hatch" data-blk="${b.id}">${I.lock}<div class="grow"><b>Bloqueio · ${esc(b.reason)}</b><span>${b.all_day ? 'Dia inteiro' : `${b.start_time} – ${b.end_time}`}${b.start_date !== b.end_date ? ` · até ${fmtDayShort(b.end_date)}` : ''}</span></div></button>`),
    ...sorted.map(apptCard),
  ];
  if (!html.length)
    return `<div class="card">${empty(I.calendar, 'Dia livre', 'Nenhum atendimento marcado.')}${d >= state.today ? `<div style="padding:0 20px 20px;text-align:center"><button class="btn btn--ghost btn--sm" data-add>${I.plus}Agendar neste dia</button></div>` : ''}</div>`;
  return `<div class="list">${html.join('')}</div>`;
}

const apptCard = (a) => `
  <button class="appt st-${a.status} ${ACTIVE(a) ? '' : 'is-off'}" data-appt="${a.id}">
    <div class="appt__time"><b>${a.start}</b><span>${a.end}</span></div>
    <div class="appt__main">
      <div class="appt__name">${esc(a.client_name)}</div>
      <div class="appt__proc">${esc(a.procedures.map((p) => p.name).join(' + '))}</div>
      <div class="row gap-sm">${statusBadge(a.status)}${a.anamnese !== 'ok' ? '<span class="badge badge--warn">Anamnese pendente</span>' : ''}${a.wa?.reply === 'reschedule' ? '<span class="badge st-cancelada">Pediu remarcar</span>' : a.wa?.reply === 'confirm' ? '<span class="badge badge--ok">Confirmou no WhatsApp</span>' : ''}</div>
    </div>
    <div class="item__end small muted" style="font-weight:700">${money(a.total_cents)}</div>
  </button>`;

// ---------------------------------------------------------------- Semana
function renderWeek(body, d, from, byDay, blocksFor, link) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  body.innerHTML = `
    <div class="week-strip">${days.map((day) => {
      const list = byDay[day] || [];
      const full = blocksFor(day).some((b) => b.all_day);
      return `<button class="wd ${day === state.today ? 'is-today' : ''} ${day === d ? 'is-sel' : ''} ${full ? 'is-blocked' : ''}" data-go="${link('dia', day)}">
        <small>${DOW_SHORT[parseD(day).getUTCDay()]}</small><b>${+day.slice(8)}</b>
        <span class="day__dots">${list.slice(0, 3).map((a) => `<span class="dot st-${a.status}" style="background:${day === d ? '#fff' : 'var(--c)'}"></span>`).join('')}</span></button>`;
    }).join('')}</div>
    ${days.map((day) => {
      const list = byDay[day] || [];
      const bl = blocksFor(day);
      const active = list.filter(ACTIVE);
      return `<div class="week-day-title"><b>${fmtDayLong(day)}</b><span>${list.length ? `${list.length} atend.` : bl.some((b) => b.all_day) ? 'Bloqueado' : 'Livre'}</span></div>
        ${list.length || bl.length ? dayList(list, bl, day) : `<p class="small muted" style="margin:0 0 6px">Sem atendimentos.</p>`}`;
    }).join('')}`;
  body.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
}

// ---------------------------------------------------------------- Dia
function renderDay(body, d, list, blocks) {
  const PX = 64; // px por hora
  const open = toMin(state.settings.open_time || '08:00'), close = toMin(state.settings.close_time || '20:00');
  let startH = Math.floor(open / 60), endH = Math.ceil(close / 60);
  for (const a of list) { startH = Math.min(startH, Math.floor(toMin(a.start) / 60)); endH = Math.max(endH, Math.ceil(toMin(a.end) / 60)); }
  const y = (min) => ((min - startH * 60) / 60) * PX;
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const fullBlock = blocks.find((b) => b.all_day);
  const active = list.filter(ACTIVE);

  // colunas para sobreposições (cancelados podem coincidir com novos)
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  const cols = [];
  const place = sorted.map((a) => {
    let c = cols.findIndex((end) => end <= toMin(a.start));
    if (c < 0) { c = cols.length; cols.push(0); }
    cols[c] = toMin(a.end);
    return { a, c };
  });
  const ncol = Math.max(1, cols.length);

  body.innerHTML = `
    ${active.length ? `<div class="today-strip"><div><b>${active.length}</b><small>atendimento${active.length > 1 ? 's' : ''}</small></div><span class="sep"></span><div><b>${money(active.reduce((s, a) => s + a.total_cents, 0))}</b><small>previsto</small></div></div>` : ''}
    ${blocks.length ? `<div class="list" style="margin-bottom:14px">${blocks.map((b) => `<button class="block-card hatch" data-blk="${b.id}">${I.lock}<div class="grow"><b>Bloqueio · ${esc(b.reason)}</b><span>${b.all_day ? 'Dia inteiro' : `${b.start_time} – ${b.end_time}`}</span></div></button>`).join('')}</div>` : ''}
    <div class="card" style="padding:14px 12px 14px 8px">
      <div class="tl" style="height:${hours.length * PX}px">
        ${hours.map((h) => `<div class="tl__hour"><i>${String(h).padStart(2, '0')}:00</i>${fullBlock ? '' : `<button data-slot="${String(h).padStart(2, '0')}:00" aria-label="Agendar às ${h}h"></button>`}</div>`).join('')}
        ${blocks.map((b) => {
          const s = b.all_day ? startH * 60 : toMin(b.start_time), e = b.all_day ? endH * 60 : toMin(b.end_time);
          return `<div class="tl__block hatch" style="top:${y(Math.max(s, startH * 60))}px;height:${y(Math.min(e, endH * 60)) - y(Math.max(s, startH * 60))}px">Bloqueio · ${esc(b.reason)}</div>`;
        }).join('')}
        ${place.map(({ a, c }) => {
          const top = y(toMin(a.start)), h = Math.max(26, y(toMin(a.end)) - top - 2);
          const w = 100 / ncol;
          return `<button class="tl__ev st-${a.status} ${ACTIVE(a) ? '' : 'is-off'}" data-appt="${a.id}" style="top:${top + 1}px;height:${h}px;left:calc(${c * w}% + 6px);right:auto;width:calc(${w}% - 10px)">
            <b>${a.start} · ${esc(a.client_name)}</b><span>${esc(a.procedures.map((p) => p.name).join(' + '))} · ${esc(statusLabel(a.status))}</span></button>`;
        }).join('')}
        ${d === state.today && nowMinBR() >= startH * 60 && nowMinBR() <= endH * 60 ? `<div class="tl__now" style="top:${y(nowMinBR())}px"></div>` : ''}
      </div>
    </div>
    <p class="small muted" style="text-align:center;margin-top:14px">Toque em um horário livre para agendar.</p>`;
  body.querySelectorAll('[data-slot]').forEach((b) => (b.onclick = () => openAppointmentForm({ date: d, start: b.dataset.slot })));
}
const statusLabel = (s) => ({ agendada: 'Agendada', confirmada: 'Confirmada', concluida: 'Concluída', cancelada: 'Cancelada', faltou: 'Faltou' })[s];

// ---------------------------------------------------------------- Ano
async function renderYear(body, d, ctx) {
  const y = d.slice(0, 4);
  const data = await api.get(`/api/appointments/year/${y}`);
  if (!ctx.isCurrent()) return;
  const max = Math.max(1, ...data.months.map((m) => m.count));
  const total = data.months.reduce((s, m) => s + m.count, 0);
  body.innerHTML = `
    <div class="year">${data.months.map((m) => {
      const key = `${y}-${String(m.month).padStart(2, '0')}`;
      const cur = key === state.today.slice(0, 7);
      const allBlocked = m.blocked_days >= m.days;
      return `<button class="ym ${cur ? 'is-current' : ''} ${allBlocked ? 'hatch' : ''}" data-go="#/agenda?v=mes&d=${key}-01" aria-label="${MONTHS[m.month - 1]}: ${m.count} atendimentos">
        ${m.blocked_days ? `<span class="ym__bl" title="${m.blocked_days} dia(s) bloqueado(s)">${I.lock}${m.blocked_days}</span>` : ''}
        <small>${MONTHS_SHORT[m.month - 1]}</small>
        <b>${m.count}</b><span>atendimento${m.count === 1 ? '' : 's'}</span>
        <div class="ym__bar"><i style="width:${(m.count / max) * 100}%"></i></div>
      </button>`;
    }).join('')}</div>
    <p class="small muted" style="text-align:center;margin-top:18px">${total} atendimentos em ${y} (sem cancelados e faltas). Toque em um mês para abrir.</p>`;
  body.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
}

// ---------------------------------------------------------------- Gestos
function enableSwipe(el, onLeft, onRight) {
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', (e) => { if (e.target.closest('.tl')) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) (dx < 0 ? onLeft : onRight)();
  }, { passive: true });
}
