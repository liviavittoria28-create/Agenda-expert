// Folhas de agendamento, status e bloqueio — CSU05, CSU06, CSU07
import { api } from '../api.js';
import { I } from '../icons.js';
import {
  state, esc, money, fmtDate, fmtDayLong, fmtDuration, toMin, fromMin, statusBadge, STATUS, initials,
  openSheet, confirmDialog, toast, toastError, markInvalid, busy, rerender, go, waLink, waMessage, checkbox, nowMinBR,
} from '../ui.js';
import { openClientForm } from './clients.js';
import { openTxForm } from './finance.js';

// só faz sentido pedir confirmação de atendimentos que ainda vão acontecer
const ACTIVE_ST = ['agendada', 'confirmada'];

export async function loadProcedures(force = false) {
  if (!state.procedures || force) state.procedures = await api.get('/api/procedures');
  return state.procedures;
}

// ---------------------------------------------------------------- Novo / editar agendamento
export async function openAppointmentForm({ date, start, appointment, client } = {}) {
  const procs = await loadProcedures(true);
  const editing = !!appointment;
  const sel = new Set(editing ? appointment.procedures.map((p) => p.procedure_id) : []);
  // procedimentos do atendimento que foram desativados continuam visíveis na edição
  const extra = editing ? appointment.procedures.filter((p) => !procs.some((x) => x.id === p.procedure_id)).map((p) => ({ id: p.procedure_id, name: p.name, price_cents: p.price_cents, duration_min: p.duration_min })) : [];
  const allProcs = [...procs, ...extra];
  let chosen = client || (editing ? { id: appointment.client_id, name: appointment.client_name, phone: appointment.client_phone, anamnese: appointment.anamnese } : null);
  const defStart = start || (editing ? appointment.start : suggestStart(date));

  const sheet = openSheet({
    title: editing ? 'Reagendar' : 'Novo agendamento',
    body: `
      <form novalidate autocomplete="off">
        <div class="field" data-field="client"><span>Cliente</span><div data-client></div></div>
        <div class="field" data-field="procedures"><span>Procedimento(s)</span>
          <div class="proc-pick">${allProcs.map((p) => `
            <button type="button" class="proc-opt ${sel.has(p.id) ? 'is-on' : ''}" data-proc="${p.id}">
              <span class="box">${I.check}</span>
              <span class="proc-opt__name">${esc(p.name)}</span>
              <span class="proc-opt__meta">${money(p.price_cents)}<br><span class="muted">${fmtDuration(p.duration_min)}</span></span>
            </button>`).join('')}
          </div>
        </div>
        <div class="grid-2">
          <label class="field" data-field="date"><span>Data</span><input class="input" type="date" name="date" value="${esc(editing ? appointment.date : date || state.today)}" required></label>
          <label class="field" data-field="start"><span>Início</span><input class="input" type="time" name="start" step="300" value="${esc(defStart)}" required></label>
        </div>
        <div data-summary></div>
        <div data-warnings></div>
        <label class="field"><span>Observações</span><textarea class="textarea" name="notes" placeholder="Opcional">${esc(editing ? appointment.notes || '' : '')}</textarea></label>
      </form>`,
    foot: `<button class="btn btn--ghost" data-cancel>Cancelar</button><button class="btn btn--gold" data-save>${editing ? 'Salvar alterações' : 'Salvar agendamento'}</button>`,
  });
  const { el, close } = sheet;
  const form = el.querySelector('form');
  const clientBox = el.querySelector('[data-client]');
  const summary = el.querySelector('[data-summary]');
  const warnBox = el.querySelector('[data-warnings]');
  let lastCheck = null;

  const renderClientBox = () => {
    if (chosen) {
      clientBox.innerHTML = `
        <div class="picked"><span class="avatar">${esc(initials(chosen.name))}</span>
          <div class="grow"><div class="item__title">${esc(chosen.name)}</div><div class="item__sub">${esc(chosen.phone || '')}</div></div>
          <button type="button" class="btn btn--ghost btn--sm" data-change>Trocar</button></div>`;
      clientBox.querySelector('[data-change]').onclick = () => { chosen = null; renderClientBox(); check(); };
      return;
    }
    clientBox.innerHTML = `
      <div class="search">${I.search}<input class="input" type="search" placeholder="Buscar por nome ou telefone" data-q autofocus></div>
      <div class="results" data-results></div>`;
    const q = clientBox.querySelector('[data-q]');
    const res = clientBox.querySelector('[data-results]');
    let t;
    const search = async () => {
      const term = q.value.trim();
      const list = await api.get('/api/clients?q=' + encodeURIComponent(term)).catch(() => []);
      res.innerHTML =
        list.slice(0, 8).map((c) => `
          <button type="button" data-id="${c.id}"><span class="avatar" style="width:34px;height:34px;font-size:15px">${esc(initials(c.name))}</span>
            <span class="grow"><b style="font-size:14.5px">${esc(c.name)}</b><br><span class="small muted">${esc(c.phone)}${c.anamnese !== 'ok' ? ' · anamnese pendente' : ''}</span></span></button>`).join('') +
        `<button type="button" data-new style="color:var(--gold-deep);font-weight:700">${I.plus.replace('<svg', '<svg style="width:18px;height:18px"')} Cadastrar ${term ? `“${esc(term)}”` : 'nova cliente'}</button>`;
      res.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => { chosen = list.find((c) => c.id === Number(b.dataset.id)); renderClientBox(); check(); }));
      res.querySelector('[data-new]').onclick = () =>
        openClientForm({
          prefill: /\d{4,}/.test(term) ? { phone: term } : { name: term },
          afterSave: (c) => { chosen = c; renderClientBox(); check(); },
          offerAnamnese: false,
        });
    };
    q.oninput = () => { clearTimeout(t); t = setTimeout(search, 180); };
    search();
  };
  renderClientBox();

  el.querySelectorAll('[data-proc]').forEach((b) => (b.onclick = () => {
    const id = Number(b.dataset.proc);
    sel.has(id) ? sel.delete(id) : sel.add(id);
    b.classList.toggle('is-on', sel.has(id));
    check();
  }));
  form.date.onchange = check;
  form.start.onchange = check;
  form.start.oninput = check;

  function payload() {
    return { id: editing ? appointment.id : undefined, client_id: chosen?.id, procedure_ids: [...sel], date: form.date.value, start: form.start.value, notes: form.notes.value };
  }

  let seq = 0;
  async function check() {
    const p = payload();
    const chosenProcs = allProcs.filter((x) => sel.has(x.id));
    const dur = chosenProcs.reduce((s, x) => s + x.duration_min, 0);
    const total = chosenProcs.reduce((s, x) => s + x.price_cents, 0);
    if (!dur || !p.start) { summary.innerHTML = ''; warnBox.innerHTML = ''; return; }
    const end = fromMin(Math.min(toMin(p.start) + dur, 24 * 60 - 1));
    summary.innerHTML = `
      <div class="summary-line">
        <div><small>Término previsto</small><b>${end}</b></div>
        <div style="text-align:center"><small>Duração</small><b>${fmtDuration(dur)}</b></div>
        <div style="text-align:right"><small>Valor</small><b>${money(total)}</b></div>
      </div>`;
    if (!p.client_id || !p.date) { warnBox.innerHTML = ''; return; }
    const my = ++seq;
    try {
      const r = await api.post('/api/appointments/check', p);
      if (my !== seq) return;
      lastCheck = r;
      warnBox.innerHTML =
        (r.conflict ? `<div class="alert alert--danger">${I.alert}<div>${esc(r.conflict.message)}${r.next_free ? `<br><button type="button" class="btn btn--sm" data-next>Usar ${r.next_free.date !== p.date ? fmtDate(r.next_free.date) + ' às ' : ''}${r.next_free.start}</button>` : ''}</div></div>` : '') +
        r.warnings.map((w) => `<div class="alert">${I.info}<div>${esc(w.message)}</div></div>`).join('');
      const nb = warnBox.querySelector('[data-next]');
      if (nb) nb.onclick = () => { form.date.value = r.next_free.date; form.start.value = r.next_free.start; check(); };
    } catch (e) {
      if (my === seq) warnBox.innerHTML = e.status === 400 ? '' : `<div class="alert alert--danger">${I.alert}<div>${esc(e.message)}</div></div>`;
    }
  }
  check();

  el.querySelector('[data-cancel]').onclick = () => close();
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    const p = payload();
    const missing = [];
    if (!p.client_id) missing.push('client');
    if (!p.procedure_ids.length) missing.push('procedures');
    if (!p.date) missing.push('date');
    if (!p.start) missing.push('start');
    if (missing.length) { markInvalid(form, missing); toast('Preencha cliente, procedimento, data e horário.', { error: true }); return; }
    try {
      const saved = editing ? await api.put(`/api/appointments/${appointment.id}`, p) : await api.post('/api/appointments', p);
      close();
      toast(editing ? 'Agendamento atualizado' : 'Agendamento criado');
      rerender();
      return saved;
    } catch (e) {
      if (e.data?.code === 'conflict') { check(); toast(e.message, { error: true }); }
      else if (e.data?.fields) { markInvalid(form, e.data.fields); toastError(e); }
      else toastError(e);
    }
  });
}

function suggestStart(date) {
  const open = state.settings.open_time || '08:00';
  if (date && date === state.today) {
    const m = Math.ceil((nowMinBR() + 15) / 30) * 30;
    if (m > toMin(open) && m < toMin(state.settings.close_time || '20:00')) return fromMin(m);
  }
  return open;
}

// ---------------------------------------------------------------- Detalhe / status
export async function openAppointmentDetail(idOrAppt) {
  const a = typeof idOrAppt === 'object' ? idOrAppt : await api.get(`/api/appointments/${idOrAppt}`);
  let status = a.status;
  const procNames = a.procedures.map((p) => p.name).join(' + ');
  const sheet = openSheet({
    title: 'Atendimento',
    body: `
      <div class="detail-hero">
        ${statusBadge(a.status)}
        <h3>${esc(a.client_name)}</h3>
        <div class="muted">${esc(procNames)}</div>
      </div>
      <dl class="card kv">
        <dt>Data</dt><dd>${fmtDayLong(a.date)}</dd>
        <dt>Horário</dt><dd>${a.start} – ${a.end} <span class="muted small">· ${fmtDuration(a.duration_min)}</span></dd>
        <dt>Valor</dt><dd>${money(a.total_cents)}</dd>
        ${a.wa ? `<dt>WhatsApp</dt><dd>${a.wa.reply === 'confirm' ? 'Cliente confirmou ✅' : a.wa.reply === 'reschedule' ? '<span style="color:var(--out)">Pediu para remarcar</span>' : a.wa.status === 'sent' ? 'Confirmação enviada, aguardando resposta' : `Falhou: ${esc(a.wa.error || '')}`}</dd>` : ''}
        ${a.notes ? `<dt>Obs.</dt><dd style="font-weight:500">${esc(a.notes)}</dd>` : ''}
        ${a.status === 'cancelada' && a.cancel_reason ? `<dt>Motivo</dt><dd style="font-weight:500">${esc(a.cancel_reason)}</dd>` : ''}
      </dl>
      ${a.anamnese !== 'ok' ? `<div class="alert mt">${I.clipboard}<div>Anamnese ${a.anamnese === 'rascunho' ? 'em rascunho (termo não aceito)' : 'pendente'}.<br><button class="btn btn--sm btn--gold" data-anam>Preencher anamnese</button></div></div>` : ''}
      <div class="label mt-lg">Status</div>
      <div class="status-grid">
        ${Object.entries(STATUS).map(([k, v]) => `<button type="button" class="status-opt st-${k} ${k === status ? 'is-on' : ''}" data-st="${k}"><span class="dot"></span>${v.label}</button>`).join('')}
      </div>
      <label class="field mt" data-field="cancel_reason" ${status === 'cancelada' ? '' : 'hidden'}><span>Motivo do cancelamento</span>
        <textarea class="textarea" name="cancel_reason" placeholder="Ex.: cliente com imprevisto, remarcar para semana que vem">${esc(a.cancel_reason || '')}</textarea></label>
      <div data-fin ${status === 'concluida' && !a.transaction_id ? '' : 'hidden'}>${checkbox('register_tx', 'Registrar entrada financeira ao concluir', true)}</div>
      ${a.transaction_id ? `<p class="small muted mt">${I.check.replace('<svg', '<svg style="width:14px;height:14px;display:inline;vertical-align:-2px;color:var(--in)"')} Entrada financeira já registrada.</p>` : ''}
      <div class="quick">
        <button type="button" data-edit>${I.repeat}Reagendar</button>
        <a href="#/clientes/${a.client_id}" data-client>${I.user}Ficha</a>
        <a href="${esc(waLink(a.client_phone, ACTIVE_ST.includes(a.status) ? waMessage(state.settings.whatsapp_template, a) : ''))}" target="_blank" rel="noopener">${I.whatsapp}${ACTIVE_ST.includes(a.status) ? 'Confirmar' : 'WhatsApp'}</a>
      </div>
      <button type="button" class="btn btn--danger btn--block btn--sm mt" data-del>${I.trash}Excluir agendamento</button>`,
    foot: `<button class="btn btn--gold" data-save>Salvar</button>`,
  });
  const { el, close } = sheet;
  const reasonField = el.querySelector('[data-field="cancel_reason"]');
  const fin = el.querySelector('[data-fin]');
  el.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => {
    status = b.dataset.st;
    el.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('is-on', x === b));
    reasonField.hidden = status !== 'cancelada';
    fin.hidden = !(status === 'concluida' && !a.transaction_id);
    if (status === 'cancelada') reasonField.querySelector('textarea').focus();
  }));
  el.querySelector('[data-anam]')?.addEventListener('click', async () => {
    const { openAnamnese } = await import('./clients.js');
    close();
    openAnamnese(a.client_id);
  });
  el.querySelector('[data-edit]').onclick = () => { close(); openAppointmentForm({ appointment: a }); };
  el.querySelector('[data-client]').onclick = () => close();
  el.querySelector('[data-del]').onclick = async () => {
    const ok = await confirmDialog({ title: 'Excluir agendamento?', message: 'Para manter o histórico, prefira marcar como Cancelada. A exclusão não pode ser desfeita.', ok: 'Excluir', danger: true });
    if (!ok) return;
    try { await api.del(`/api/appointments/${a.id}`); close(); toast('Agendamento excluído'); rerender(); } catch (e) { toastError(e); }
  };
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    const reason = reasonField.querySelector('textarea').value.trim();
    if (status === 'cancelada' && !reason) { markInvalid(el, ['cancel_reason']); toast('Informe o motivo do cancelamento.', { error: true }); return; }
    const wantsTx = status === 'concluida' && !a.transaction_id && el.querySelector('[name="register_tx"]')?.checked;
    try {
      if (status !== a.status || (status === 'cancelada' && reason !== a.cancel_reason)) {
        await api.patch(`/api/appointments/${a.id}/status`, { status, cancel_reason: reason });
        toast(`Status: ${STATUS[status].label}`);
      }
      close();
      rerender();
      if (wantsTx) {
        // RF22 / RN09 — entrada pré-preenchida, editável antes de salvar
        openTxForm({
          prefill: {
            type: 'in', amount_cents: a.total_cents, date: a.date, category: 'Atendimento',
            description: `${procNames} — ${a.client_name}`, client_id: a.client_id, appointment_id: a.id,
          },
        });
      }
    } catch (e) { toastError(e); }
  });
}

// ---------------------------------------------------------------- Bloqueio de agenda
export function openBlockForm({ block, date } = {}) {
  const editing = !!block;
  const b = block || { reason: '', start_date: date || state.today, end_date: date || state.today, all_day: true, start_time: '12:00', end_time: '14:00' };
  const { el, close } = openSheet({
    title: editing ? 'Editar bloqueio' : 'Bloquear agenda',
    body: `
      <form novalidate>
        <label class="field" data-field="reason"><span>Motivo</span><input class="input" name="reason" value="${esc(b.reason)}" placeholder="Ex.: viagem, folga, curso" autofocus></label>
        <div class="card" style="padding:0 16px;margin-bottom:16px">
          <label class="check"><span class="check__label">Dia inteiro</span><span class="switch"><input type="checkbox" name="all_day" ${b.all_day ? 'checked' : ''}><span></span></span></label>
        </div>
        <div class="grid-2">
          <label class="field" data-field="start_date"><span>De</span><input class="input" type="date" name="start_date" value="${esc(b.start_date)}"></label>
          <label class="field" data-field="end_date"><span>Até</span><input class="input" type="date" name="end_date" value="${esc(b.end_date)}"></label>
        </div>
        <div class="grid-2" data-times ${b.all_day ? 'hidden' : ''}>
          <label class="field" data-field="start_time"><span>Das</span><input class="input" type="time" name="start_time" value="${esc(b.start_time || '12:00')}"></label>
          <label class="field" data-field="end_time"><span>Às</span><input class="input" type="time" name="end_time" value="${esc(b.end_time || '14:00')}"></label>
        </div>
        <p class="small muted" data-hint></p>
        <div data-conflicts></div>
      </form>`,
    foot: `${editing ? `<button class="btn btn--danger" data-remove>Remover</button>` : ''}<button class="btn btn--gold" data-save>Salvar bloqueio</button>`,
  });
  const form = el.querySelector('form');
  const times = el.querySelector('[data-times]');
  const hint = el.querySelector('[data-hint]');
  const setHint = () => {
    hint.textContent = form.all_day.checked
      ? 'Horários bloqueados não podem receber agendamentos.'
      : 'O intervalo de horário é bloqueado em cada dia do período.';
  };
  setHint();
  form.all_day.onchange = () => { times.hidden = form.all_day.checked; setHint(); };
  form.start_date.onchange = () => { if (form.end_date.value < form.start_date.value) form.end_date.value = form.start_date.value; };

  const save = async (confirm = false) => {
    const body = {
      reason: form.reason.value, all_day: form.all_day.checked, start_date: form.start_date.value,
      end_date: form.end_date.value || form.start_date.value, start_time: form.start_time.value, end_time: form.end_time.value, confirm,
    };
    try {
      editing ? await api.put(`/api/blocks/${block.id}`, body) : await api.post('/api/blocks', body);
      close();
      toast('Agenda bloqueada');
      rerender();
    } catch (e) {
      if (e.data?.code === 'appointments_in_block') {
        const box = el.querySelector('[data-conflicts]');
        box.innerHTML = `
          <div class="alert alert--danger">${I.alert}<div><b>Há ${e.data.appointments.length} atendimento(s) neste período.</b><br>Reagende ou cancele, ou confirme para manter e bloquear o restante.</div></div>
          <div class="list">${e.data.appointments.map((a) => `<div class="item"><div class="item__main"><div class="item__title">${esc(a.client_name)}</div><div class="item__sub">${fmtDate(a.date)} · ${a.start}–${a.end} · ${esc(a.procedures.map((p) => p.name).join(', '))}</div></div>${statusBadge(a.status)}</div>`).join('')}</div>
          <button type="button" class="btn btn--block mt" data-force>Manter atendimentos e bloquear</button>`;
        box.querySelector('[data-force]').onclick = (ev) => busy(ev.currentTarget, () => save(true));
        box.scrollIntoView({ behavior: 'smooth' });
      } else {
        if (e.data?.fields) markInvalid(form, e.data.fields);
        toastError(e);
      }
    }
  };
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, () => save(false));
  el.querySelector('[data-remove]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Remover bloqueio?', message: 'O período volta a ficar livre para agendamentos.', ok: 'Remover', danger: true });
    if (!ok) return;
    try { await api.del(`/api/blocks/${block.id}`); close(); toast('Bloqueio removido'); rerender(); } catch (e) { toastError(e); }
  });
}
