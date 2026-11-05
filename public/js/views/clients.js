// Clientes e anamnese — CSU02, CSU03, RF26
import { api } from '../api.js';
import { I } from '../icons.js';
import {
  state, esc, money, fmtDate, fmtDayShort, initials, maskPhone, waLink, waMessage, statusBadge, openSheet, confirmDialog,
  toast, toastError, markInvalid, busy, rerender, go, formData, empty, parseD, MONTHS_SHORT,
} from '../ui.js';
import { openAppointmentForm, openAppointmentDetail } from './appointment.js';

const anamBadge = (s) =>
  s === 'ok' ? '<span class="badge badge--ok"><span class="dot"></span>Anamnese ok</span>'
    : `<span class="badge badge--warn"><span class="dot"></span>Anamnese ${s === 'rascunho' ? 'rascunho' : 'pendente'}</span>`;
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export async function renderClients(main, ctx) {
  const inactive = ctx.query.inativas === '1';
  main.innerHTML = `
    <div class="page">
      <header class="top">
        <div><div class="top__eyebrow">Cadastro</div><h1>Clientes</h1></div>
        <div class="top__actions"><button class="icon-btn icon-btn--solid" data-new aria-label="Nova cliente">${I.plus}</button></div>
      </header>
      <div class="search">${I.search}<input class="input" type="search" placeholder="Buscar por nome ou telefone" data-q value="${esc(ctx.query.q || '')}"></div>
      <div class="row between mt">
        <span class="small muted" data-count></span>
        <label class="row small muted" style="cursor:pointer">Mostrar inativas <span class="switch" style="transform:scale(.8)"><input type="checkbox" data-inactive ${inactive ? 'checked' : ''}><span></span></span></label>
      </div>
      <div data-list><div class="spinner"></div></div>
    </div>`;
  const q = main.querySelector('[data-q]');
  const listEl = main.querySelector('[data-list]');
  main.querySelector('[data-new]').onclick = () => openClientForm({ afterSave: (c) => go(`#/clientes/${c.id}`) });
  main.querySelector('[data-inactive]').onchange = (e) => go(`#/clientes${e.target.checked ? '?inativas=1' : ''}`);

  let seq = 0;
  const load = async () => {
    const my = ++seq;
    const list = await api.get(`/api/clients?q=${encodeURIComponent(q.value.trim())}${inactive ? '&inactive=1' : ''}`);
    if (my !== seq || !ctx.isCurrent()) return;
    main.querySelector('[data-count]').textContent = `${list.length} cliente${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      listEl.innerHTML = q.value ? empty(I.search, 'Nenhum resultado', 'Tente outro nome ou telefone.') : empty(I.users, 'Nenhuma cliente ainda', 'Toque em + para cadastrar a primeira.');
      return;
    }
    let letter = '';
    listEl.innerHTML = list.map((c) => {
      const l = norm(c.name[0] || '#');
      const head = !q.value && l !== letter ? `<div class="alpha">${(letter = l)}</div>` : '';
      return `${head}<a class="item ${c.active ? '' : 'is-dim'}" href="#/clientes/${c.id}" style="margin-bottom:8px">
        <span class="avatar">${esc(initials(c.name))}</span>
        <div class="item__main"><div class="item__title">${esc(c.name)}</div><div class="item__sub">${esc(c.phone)}${c.active ? '' : ' · inativa'}</div></div>
        ${c.anamnese === 'ok' ? '' : '<span class="badge badge--warn">Anamnese</span>'}
        <span class="item__chev">${I.right}</span></a>`;
    }).join('');
  };
  let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(load, 160); };
  await load();
}

export async function renderClient(main, ctx) {
  const c = await api.get(`/api/clients/${ctx.parts[1]}`);
  if (!ctx.isCurrent()) return;
  const done = c.history.filter((a) => a.status === 'concluida');
  const upcoming = c.history.filter((a) => a.date >= state.today && ['agendada', 'confirmada'].includes(a.status)).reverse();
  const missed = c.history.filter((a) => a.status === 'faltou').length;
  const age = c.birth_date ? Math.floor((parseD(state.today) - parseD(c.birth_date)) / (365.25 * 864e5)) : null;

  main.innerHTML = `
    <div class="page">
      <header class="top" style="padding-bottom:0">
        <a class="back" href="#/clientes">${I.left}Clientes</a>
        <div class="top__actions"><button class="icon-btn" data-edit aria-label="Editar">${I.edit}</button></div>
      </header>
      <div class="profile">
        <span class="avatar">${esc(initials(c.name))}</span>
        <h2>${esc(c.name)}</h2>
        <div class="row" style="justify-content:center;gap:8px">${anamBadge(c.anamnese)}${c.active ? '' : '<span class="badge badge--muted">Inativa</span>'}</div>
      </div>
      <div class="quick">
        <button data-book>${I.calendar}Agendar</button>
        <button data-anam>${I.clipboard}Anamnese</button>
        <a href="${esc(waLink(c.phone, upcoming[0] ? waMessage(state.settings.whatsapp_template, upcoming[0]) : ''))}" target="_blank" rel="noopener">${I.whatsapp}${upcoming[0] ? 'Confirmar' : 'WhatsApp'}</a>
      </div>
      <div class="card stats mt">
        <div><b>${done.length}</b><span>Concluídos</span></div>
        <div><b>${missed}</b><span>Faltas</span></div>
        <div><b>${money(c.spent_cents).replace(',00', '')}</b><span>Total pago</span></div>
      </div>
      <div class="section-title">Contato</div>
      <dl class="card kv">
        <dt>Telefone</dt><dd><a href="tel:${esc(c.phone.replace(/\D/g, ''))}">${esc(c.phone)}</a></dd>
        ${c.email ? `<dt>E-mail</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>` : ''}
        ${c.birth_date ? `<dt>Nascimento</dt><dd>${fmtDate(c.birth_date)} <span class="muted small">· ${age} anos</span></dd>` : ''}
        ${c.notes ? `<dt>Obs.</dt><dd style="font-weight:500">${esc(c.notes)}</dd>` : ''}
        <dt>Cliente desde</dt><dd>${fmtDate(c.created_at.slice(0, 10))}</dd>
      </dl>
      ${upcoming.length ? `<div class="section-title">Próximos</div><div class="list">${upcoming.map(histItem).join('')}</div>` : ''}
      <div class="section-title">Histórico de atendimentos</div>
      ${c.history.length ? `<div class="list">${c.history.filter((a) => !upcoming.includes(a)).map(histItem).join('') || '<p class="small muted">Nenhum atendimento passado.</p>'}</div>` : `<div class="card">${empty(I.clock, 'Sem histórico', 'Os atendimentos desta cliente aparecerão aqui.')}</div>`}
      <div class="mt-lg row" style="gap:10px">
        <button class="btn btn--ghost btn--sm grow" data-active>${c.active ? 'Inativar cliente' : 'Reativar cliente'}</button>
        ${c.can_delete ? `<button class="btn btn--danger btn--sm grow" data-del>Excluir</button>` : ''}
      </div>
      ${!c.can_delete ? '<p class="small muted" style="text-align:center">Clientes com histórico não podem ser excluídas — apenas inativadas.</p>' : ''}
    </div>`;

  main.querySelector('[data-edit]').onclick = () => openClientForm({ client: c, afterSave: () => rerender() });
  main.querySelector('[data-book]').onclick = () => {
    if (!c.active) return toast('Reative a cliente para agendar.', { error: true });
    openAppointmentForm({ date: state.today, client: c });
  };
  main.querySelector('[data-anam]').onclick = () => openAnamnese(c.id, c);
  main.querySelectorAll('[data-appt]').forEach((b) => (b.onclick = () => openAppointmentDetail(c.history.find((a) => a.id === Number(b.dataset.appt)))));
  main.querySelector('[data-active]').onclick = async () => {
    if (c.active && !(await confirmDialog({ title: 'Inativar cliente?', message: 'Ela deixa de aparecer na busca, mas o histórico é preservado. Você pode reativar quando quiser.', ok: 'Inativar' }))) return;
    try { await api.post(`/api/clients/${c.id}/active`, { active: !c.active }); toast(c.active ? 'Cliente inativada' : 'Cliente reativada'); rerender(); } catch (e) { toastError(e); }
  };
  main.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Excluir cliente?', message: 'O cadastro e a anamnese serão apagados definitivamente.', ok: 'Excluir', danger: true }))) return;
    try { await api.del(`/api/clients/${c.id}`); toast('Cliente excluída'); go('#/clientes'); } catch (e) { toastError(e); }
  });
}

const histItem = (a) => {
  const d = parseD(a.date);
  return `<button class="item" data-appt="${a.id}">
    <div style="width:44px;text-align:center;flex:none"><div class="serif" style="font-size:24px;line-height:1">${d.getUTCDate()}</div><div class="small muted" style="font-weight:700">${MONTHS_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}</div></div>
    <div class="item__main"><div class="item__title">${esc(a.procedures.map((p) => p.name).join(' + '))}</div><div class="item__sub">${a.start}–${a.end} · ${money(a.total_cents)}${a.cancel_reason ? ` · ${esc(a.cancel_reason)}` : ''}</div></div>
    ${statusBadge(a.status)}</button>`;
};

// ---------------------------------------------------------------- Formulário de cliente
export function openClientForm({ client, prefill = {}, afterSave, offerAnamnese = true } = {}) {
  const c = client || prefill;
  const editing = !!client;
  const { el, close } = openSheet({
    title: editing ? 'Editar cliente' : 'Nova cliente',
    body: `
      <form novalidate autocomplete="off">
        <label class="field" data-field="name"><span>Nome completo *</span><input class="input" name="name" value="${esc(c.name || '')}" autocapitalize="words" ${editing ? '' : 'autofocus'}></label>
        <label class="field" data-field="phone"><span>Telefone / WhatsApp *</span><input class="input" name="phone" type="tel" inputmode="tel" value="${esc(c.phone ? maskPhone(c.phone) : '')}" placeholder="(11) 99999-0000"></label>
        <div data-dup></div>
        <div class="grid-2">
          <label class="field" data-field="birth_date"><span>Nascimento</span><input class="input" name="birth_date" type="date" value="${esc(c.birth_date || '')}"></label>
          <label class="field" data-field="email"><span>E-mail</span><input class="input" name="email" type="email" inputmode="email" value="${esc(c.email || '')}" placeholder="opcional"></label>
        </div>
        <label class="field"><span>Observações</span><textarea class="textarea" name="notes" placeholder="Preferências, indicação, etc.">${esc(c.notes || '')}</textarea></label>
        <p class="small muted">${I.shield.replace('<svg', '<svg style="width:14px;height:14px;display:inline;vertical-align:-2px;margin-right:4px"')}Dados pessoais protegidos conforme a LGPD — acesso exclusivo da profissional.</p>
      </form>`,
    foot: `<button class="btn btn--ghost" data-cancel>Cancelar</button><button class="btn btn--gold" data-save>Salvar</button>`,
  });
  const form = el.querySelector('form');
  form.phone.oninput = () => { form.phone.value = maskPhone(form.phone.value); };
  el.querySelector('[data-cancel]').onclick = () => close();
  const save = async (allowDuplicate = false) => {
    const body = { ...formData(form), allow_duplicate: allowDuplicate };
    const missing = [];
    if (!body.name.trim()) missing.push('name');
    if (body.phone.replace(/\D/g, '').length < 10) missing.push('phone');
    if (missing.length) { markInvalid(form, missing); toast('Preencha nome e telefone.', { error: true }); return; }
    try {
      const saved = editing ? await api.put(`/api/clients/${client.id}`, body) : await api.post('/api/clients', body);
      close();
      toast(editing ? 'Cadastro atualizado' : 'Cliente cadastrada');
      afterSave?.(saved);
      if (!editing && offerAnamnese) {
        const ok = await confirmDialog({ title: 'Preencher anamnese agora?', message: 'A anamnese deve ser preenchida antes do primeiro procedimento.', ok: 'Preencher', cancel: 'Depois' });
        if (ok) openAnamnese(saved.id, saved);
      }
    } catch (e) {
      if (e.data?.code === 'duplicate_phone') {
        const box = el.querySelector('[data-dup]');
        box.innerHTML = `<div class="alert">${I.info}<div>${esc(e.message)}<div class="row mt" style="gap:8px;margin-top:10px">
          <a class="btn btn--sm" href="#/clientes/${e.data.existing_id}">Abrir cadastro</a>
          <button type="button" class="btn btn--ghost btn--sm" data-force>Salvar mesmo assim</button></div></div></div>`;
        box.querySelector('[data-force]').onclick = () => save(true);
        box.querySelector('a').onclick = () => close();
      } else {
        if (e.data?.fields) markInvalid(form, e.data.fields);
        toastError(e);
      }
    }
  };
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, () => save(false));
}

// ---------------------------------------------------------------- Anamnese
const YN = [
  ['gestante', 'Gestante ou lactante?'],
  ['diabetes', 'Diabetes'],
  ['hipertensao', 'Hipertensão'],
  ['tireoide', 'Problemas de tireoide'],
  ['herpes', 'Herpes labial'],
  ['lentes', 'Usa lentes de contato'],
  ['cirurgia_ocular', 'Cirurgia ocular recente'],
  ['queloide', 'Histórico de queloide'],
  ['acido', 'Uso de ácidos / isotretinoína'],
  ['sensibilidade', 'Pele sensível ou dermatite'],
];
const DETAIL = [
  ['alergias', 'Alergias', 'Quais? (cosméticos, cola, látex, medicamentos…)'],
  ['medicamentos', 'Usa medicamentos?', 'Quais e com que frequência?'],
  ['outras_condicoes', 'Outras condições de saúde', 'Descreva'],
];

export async function openAnamnese(clientId, client) {
  const c = client?.anamnese_data !== undefined ? client : await api.get(`/api/clients/${clientId}`);
  const a = c.anamnese_data || {};
  const yn = (k, label) => `
    <div class="anam-q"><span>${label}</span>
      <div class="yn">
        <label><input type="radio" name="${k}" value="sim" ${a[k] === 'sim' ? 'checked' : ''}><span>Sim</span></label>
        <label><input type="radio" name="${k}" value="nao" ${a[k] === 'nao' ? 'checked' : ''}><span>Não</span></label>
      </div></div>`;
  const { el, close } = openSheet({
    title: 'Anamnese',
    wide: true,
    body: `
      <form novalidate>
        <p class="muted" style="margin:0 0 14px"><b style="color:var(--ink)">${esc(c.name)}</b>${a.filled_at ? ` · preenchida em ${fmtDate(a.filled_at)}` : a.updated_at ? ' · rascunho' : ''}</p>
        <div class="card anam-group">
          <h4>Saúde</h4>
          ${DETAIL.map(([k, label, ph]) => `
            <div class="anam-q"><span>${label}</span>
              <div class="yn"><label><input type="radio" name="${k}" value="sim" ${a[k] === 'sim' ? 'checked' : ''}><span>Sim</span></label><label><input type="radio" name="${k}" value="nao" ${a[k] === 'nao' ? 'checked' : ''}><span>Não</span></label></div></div>
            <div class="anam-detail" data-detail="${k}" ${a[k] === 'sim' ? '' : 'hidden'}><input class="input" name="${k}_detalhe" value="${esc(a[k + '_detalhe'] || '')}" placeholder="${ph}"></div>`).join('')}
          ${YN.map(([k, l]) => yn(k, l)).join('')}
        </div>
        <label class="field"><span>Observações</span><textarea class="textarea" name="observacoes" placeholder="Procedimentos anteriores, reações, cuidados especiais…">${esc(a.observacoes || '')}</textarea></label>
        <div class="label">Termo de consentimento</div>
        <div class="consent">${esc(state.settings.consent_text || '')}</div>
        <div class="card" style="padding:0 16px;margin-top:12px">
          <label class="check"><span class="check__label"><b>Termo de consentimento aceito</b><br><span class="small muted">A data de hoje será registrada.</span></span><input type="checkbox" name="consent" ${a.consent ? 'checked' : ''}><span class="box">${I.check}</span></label>
        </div>
      </form>`,
    foot: `<button class="btn btn--gold btn--block" data-save>Salvar anamnese</button>`,
  });
  const form = el.querySelector('form');
  DETAIL.forEach(([k]) => form.querySelectorAll(`[name="${k}"]`).forEach((r) => (r.onchange = () => {
    el.querySelector(`[data-detail="${k}"]`).hidden = form.querySelector(`[name="${k}"]:checked`)?.value !== 'sim';
  })));
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    const data = formData(form);
    if (!data.consent) {
      const ok = await confirmDialog({ title: 'Termo não aceito', message: 'A anamnese será salva como rascunho e a cliente continuará com “anamnese pendente”.', ok: 'Salvar rascunho' });
      if (!ok) return;
    }
    try {
      await api.put(`/api/clients/${c.id}/anamnese`, data);
      close();
      toast(data.consent ? 'Anamnese salva' : 'Rascunho salvo');
      rerender();
    } catch (e) { toastError(e); }
  });
}
