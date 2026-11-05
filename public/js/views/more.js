// Mais: bloqueios, estoque, ajustes, conta, instalação e backup
import { api } from '../api.js';
import { I } from '../icons.js';
import { state, esc, waMessage, fmtDate, openSheet, confirmDialog, toast, toastError, markInvalid, busy, rerender, go, empty, DOW_SHORT } from '../ui.js';
import { openBlockForm } from './appointment.js';
import { waLabel } from './whatsapp.js';

export async function renderMore(main) {
  const [dash, wa] = await Promise.all([api.get('/api/dashboard').catch(() => ({})), api.get('/api/whatsapp').catch(() => null)]);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const mi = (icon, title, sub, attrs) => `<button ${attrs}><span class="mi">${icon}</span><span class="grow">${title}${sub ? `<small>${sub}</small>` : ''}</span><span class="item__chev">${I.right}</span></button>`;
  main.innerHTML = `
    <div class="page">
      <header class="top"><div><div class="top__eyebrow">${esc(state.user?.name || '')}</div><h1>Mais</h1></div></header>
      <div class="card menu">
        ${mi(I.lock, 'Bloqueios de agenda', 'Folgas, viagens e horários indisponíveis', 'data-go="#/mais/bloqueios"')}
        ${mi(I.box, 'Estoque de materiais', dash.low_stock ? `${dash.low_stock} item(ns) abaixo do mínimo` : 'Entradas, saídas e quantidade mínima', 'data-go="#/mais/estoque"')}
        ${mi(I.whatsapp, 'WhatsApp', waLabel(wa), 'data-go="#/mais/whatsapp"')}
        ${mi(I.settings, 'Ajustes', 'Horário de atendimento, termo e acesso', 'data-go="#/mais/ajustes"')}
      </div>
      <div class="section-title">Aplicativo</div>
      <div class="card menu">
        ${standalone ? '' : mi(I.install, 'Instalar no iPhone', 'Adicionar à Tela de Início', 'data-install')}
        ${mi(I.download, 'Baixar cópia de segurança', 'Arquivo com todos os dados (guarde em local seguro)', 'data-backup')}
        ${mi(I.logout, 'Sair', state.user?.email || '', 'data-logout')}
      </div>
      <p class="small muted mt-lg" style="text-align:center">${esc(state.settings.studio_name || '')}<br>${esc(state.settings.studio_address || '')}<br><span style="opacity:.7">Agenda Expert · v1.0</span></p>
    </div>`;
  main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  main.querySelector('[data-install]')?.addEventListener('click', showInstall);
  main.querySelector('[data-backup]').onclick = () => { location.href = '/api/backup'; };
  main.querySelector('[data-logout]').onclick = async () => {
    if (!(await confirmDialog({ title: 'Sair do aplicativo?', ok: 'Sair' }))) return;
    await api.post('/api/logout').catch(() => {});
    navigator.serviceWorker?.controller?.postMessage('logout');
    location.replace('/');
  };
}

function showInstall() {
  openSheet({
    title: 'Instalar no iPhone',
    body: `
      <ol style="padding-left:20px;line-height:1.9;margin:0">
        <li>Abra este endereço no <b>Safari</b>.</li>
        <li>Toque no botão <b>Compartilhar</b> (quadrado com seta para cima).</li>
        <li>Escolha <b>Adicionar à Tela de Início</b>.</li>
        <li>Confirme em <b>Adicionar</b>.</li>
      </ol>
      <p class="muted small mt">O Agenda Expert ganha ícone próprio e abre em tela cheia, como um app — sem App Store.</p>`,
  });
}

// ---------------------------------------------------------------- Bloqueios
export async function renderBlocks(main, ctx) {
  const past = ctx.query.passados === '1';
  const list = await api.get(`/api/blocks${past ? '?from=2000-01-01' : ''}`);
  if (!ctx.isCurrent()) return;
  main.innerHTML = `
    <div class="page">
      <header class="top" style="padding-bottom:0"><a class="back" href="#/mais">${I.left}Mais</a></header>
      <header class="top"><div><div class="top__eyebrow">Agenda</div><h1>Bloqueios</h1></div>
        <div class="top__actions"><button class="icon-btn icon-btn--solid" data-new aria-label="Novo bloqueio">${I.plus}</button></div></header>
      <div class="seg" style="margin-bottom:16px"><button class="${past ? '' : 'is-on'}" data-go="#/mais/bloqueios">Próximos</button><button class="${past ? 'is-on' : ''}" data-go="#/mais/bloqueios?passados=1">Todos</button></div>
      ${list.length ? `<div class="list">${list.slice().sort((a, b) => (past ? b.start_date.localeCompare(a.start_date) : a.start_date.localeCompare(b.start_date))).map((b) => `
        <button class="block-card hatch" data-id="${b.id}">${I.lock}<div class="grow"><b>${esc(b.reason)}</b>
          <span>${fmtDate(b.start_date)}${b.end_date !== b.start_date ? ` a ${fmtDate(b.end_date)}` : ''} · ${b.all_day ? 'dia inteiro' : `${b.start_time}–${b.end_time}`}</span></div><span class="item__chev">${I.right}</span></button>`).join('')}</div>`
        : `<div class="card">${empty(I.lock, 'Nenhum bloqueio', 'Bloqueie dias de folga, viagens ou horários indisponíveis.')}</div>`}
    </div>`;
  main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  main.querySelector('[data-new]').onclick = () => openBlockForm();
  main.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => openBlockForm({ block: list.find((x) => x.id === Number(b.dataset.id)) })));
}

// ---------------------------------------------------------------- Estoque (RF28 — desejável)
const qty = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
export async function renderStock(main, ctx) {
  const items = await api.get('/api/stock');
  if (!ctx.isCurrent()) return;
  main.innerHTML = `
    <div class="page">
      <header class="top" style="padding-bottom:0"><a class="back" href="#/mais">${I.left}Mais</a></header>
      <header class="top"><div><div class="top__eyebrow">Materiais</div><h1>Estoque</h1></div>
        <div class="top__actions"><button class="icon-btn icon-btn--solid" data-new aria-label="Novo item">${I.plus}</button></div></header>
      ${items.length ? `<div class="list">${items.map((it) => {
        const low = it.min_quantity > 0 && it.quantity <= it.min_quantity;
        return `<div class="item">
          <div class="item__main"><div class="item__title">${esc(it.name)}</div>
            <div class="item__sub">${low ? '<span class="badge badge--warn">Abaixo do mínimo</span> ' : ''}mín. ${qty(it.min_quantity)} ${esc(it.unit)}</div></div>
          <div class="item__end"><div class="stock-qty">${qty(it.quantity)}</div><div class="small muted">${esc(it.unit)}</div></div>
          <div class="row" style="gap:6px">
            <button class="icon-btn" data-move="out" data-id="${it.id}" aria-label="Saída">${I.arrowUp}</button>
            <button class="icon-btn" data-move="in" data-id="${it.id}" aria-label="Entrada">${I.arrowDown}</button>
            <button class="icon-btn icon-btn--plain" data-edit="${it.id}" aria-label="Editar">${I.edit}</button>
          </div></div>`;
      }).join('')}</div>`
        : `<div class="card">${empty(I.box, 'Nenhum item', 'Cadastre materiais como cola, fios, pigmentos e descartáveis.')}</div>`}
    </div>`;
  main.querySelector('[data-new]').onclick = () => itemForm();
  main.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => itemForm(items.find((x) => x.id === Number(b.dataset.edit)))));
  main.querySelectorAll('[data-move]').forEach((b) => (b.onclick = () => moveForm(items.find((x) => x.id === Number(b.dataset.id)), b.dataset.move)));
}

function itemForm(it) {
  const editing = !!it;
  const v = it || { name: '', unit: 'un', quantity: 0, min_quantity: 0 };
  const { el, close } = openSheet({
    title: editing ? 'Editar item' : 'Novo item',
    body: `<form novalidate>
      <label class="field" data-field="name"><span>Nome</span><input class="input" name="name" value="${esc(v.name)}" autofocus></label>
      <div class="grid-2">
        <label class="field"><span>Unidade</span><input class="input" name="unit" value="${esc(v.unit)}" placeholder="un, ml, caixa"></label>
        <label class="field" data-field="min_quantity"><span>Qtd. mínima</span><input class="input" name="min_quantity" inputmode="decimal" value="${qty(v.min_quantity)}"></label>
      </div>
      ${editing ? '' : `<label class="field"><span>Quantidade inicial</span><input class="input" name="quantity" inputmode="decimal" value="0"></label>`}
      ${editing ? `<button type="button" class="btn btn--danger btn--block btn--sm" data-archive>Remover item</button>` : ''}
    </form>`,
    foot: `<button class="btn btn--ghost" data-cancel>Cancelar</button><button class="btn btn--gold" data-save>Salvar</button>`,
  });
  const form = el.querySelector('form');
  el.querySelector('[data-cancel]').onclick = () => close();
  el.querySelector('[data-archive]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Remover item?', ok: 'Remover', danger: true }))) return;
    try { await api.put(`/api/stock/${it.id}`, { ...it, active: false }); close(); rerender(); } catch (e) { toastError(e); }
  });
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    const body = { name: form.name.value, unit: form.unit.value, min_quantity: form.min_quantity.value, quantity: form.quantity?.value };
    try { editing ? await api.put(`/api/stock/${it.id}`, body) : await api.post('/api/stock', body); close(); toast('Item salvo'); rerender(); }
    catch (e) { if (e.data?.fields) markInvalid(form, e.data.fields); toastError(e); }
  });
}

function moveForm(it, type) {
  const { el, close } = openSheet({
    title: type === 'in' ? 'Entrada de material' : 'Saída de material',
    body: `<form novalidate>
      <p class="muted" style="margin-top:0"><b style="color:var(--ink)">${esc(it.name)}</b> · atual: ${qty(it.quantity)} ${esc(it.unit)}</p>
      <label class="field" data-field="quantity"><span>Quantidade (${esc(it.unit)})</span><input class="input" name="quantity" inputmode="decimal" autofocus></label>
      <label class="field"><span>Observação</span><input class="input" name="note" placeholder="Opcional"></label>
    </form>`,
    foot: `<button class="btn btn--gold btn--block" data-save>Registrar ${type === 'in' ? 'entrada' : 'saída'}</button>`,
  });
  const form = el.querySelector('form');
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    try { await api.post(`/api/stock/${it.id}/move`, { type, quantity: form.quantity.value, note: form.note.value }); close(); toast('Estoque atualizado'); rerender(); }
    catch (e) { if (e.data?.fields) markInvalid(form, e.data.fields); toastError(e); }
  });
}

// ---------------------------------------------------------------- Ajustes
export async function renderSettings(main, ctx) {
  const s = await api.get('/api/settings');
  if (!ctx.isCurrent()) return;
  const days = String(s.work_days || '').split(',').filter(Boolean).map(Number);
  main.innerHTML = `
    <div class="page">
      <header class="top" style="padding-bottom:0"><a class="back" href="#/mais">${I.left}Mais</a></header>
      <header class="top"><div><div class="top__eyebrow">Configurações</div><h1>Ajustes</h1></div></header>
      <form data-hours novalidate>
        <div class="section-title" style="margin-top:4px">Atendimento</div>
        <div class="grid-2">
          <label class="field"><span>Abre às</span><input class="input" type="time" name="open_time" value="${esc(s.open_time)}"></label>
          <label class="field"><span>Fecha às</span><input class="input" type="time" name="close_time" value="${esc(s.close_time)}"></label>
        </div>
        <div class="label">Dias de atendimento</div>
        <div class="chips" style="margin-bottom:16px">${DOW_SHORT.map((d, i) => `<button type="button" class="chip ${days.includes(i) ? 'is-on' : ''}" data-dow="${i}">${d}</button>`).join('')}</div>
        <label class="field"><span>Intervalo entre atendimentos (min)</span><input class="input" type="number" min="0" step="5" name="gap_min" value="${esc(s.gap_min)}">
          <small>Tempo reservado entre um atendimento e outro (limpeza, preparo).</small></label>
        <label class="field"><span>Texto do termo de consentimento</span><textarea class="textarea" name="consent_text" style="min-height:160px">${esc(s.consent_text)}</textarea></label>
        <button class="btn btn--gold btn--block" type="submit">Salvar ajustes</button>
      </form>
      <div class="section-title">Acesso</div>
      <div class="card kv"><dt>E-mail</dt><dd>${esc(state.user.email)}</dd></div>
      <p class="small muted">O e-mail e a senha de acesso são definidos nas variáveis do servidor (<b>ADMIN_EMAIL</b> e <b>ADMIN_PASSWORD</b>). Para trocar, altere-as na hospedagem e reinicie o app.</p>
    </div>`;
  const hours = main.querySelector('[data-hours]');
  hours.querySelectorAll('[data-dow]').forEach((b) => (b.onclick = () => b.classList.toggle('is-on')));
  hours.onsubmit = async (e) => {
    e.preventDefault();
    const btn = hours.querySelector('[type=submit]');
    await busy(btn, async () => {
      const work_days = [...hours.querySelectorAll('[data-dow].is-on')].map((b) => b.dataset.dow).join(',');
      try {
        state.settings = await api.put('/api/settings', {
          open_time: hours.open_time.value, close_time: hours.close_time.value, gap_min: hours.gap_min.value || '0',
          consent_text: hours.consent_text.value, work_days,
        });
        toast('Ajustes salvos');
      } catch (err) { toastError(err); }
    });
  };
}
