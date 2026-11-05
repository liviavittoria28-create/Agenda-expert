// Catálogo de procedimentos — CSU04
import { api } from '../api.js';
import { I } from '../icons.js';
import { state, esc, money, fmtDuration, centsToInput, parseMoney, openSheet, toast, toastError, markInvalid, busy, rerender, empty } from '../ui.js';

export async function renderProcedures(main, ctx) {
  const list = await api.get('/api/procedures?all=1');
  if (!ctx.isCurrent()) return;
  state.procedures = list.filter((p) => p.active);
  const active = list.filter((p) => p.active), inactive = list.filter((p) => !p.active);
  const card = (p, i) => `
    <button class="proc ${p.active ? '' : 'is-dim'}" data-id="${p.id}">
      <span class="proc__n">${p.active ? String(i + 1).padStart(2, '0') : '—'}</span>
      <div class="proc__main"><div class="proc__name">${esc(p.name)}</div>${p.description ? `<div class="proc__desc">${esc(p.description)}</div>` : ''}</div>
      <div class="proc__price"><b>${money(p.price_cents)}</b><span>${fmtDuration(p.duration_min)}</span></div>
    </button>`;
  main.innerHTML = `
    <div class="page">
      <header class="top">
        <div><div class="top__eyebrow">Catálogo</div><h1>Procedimentos</h1></div>
        <div class="top__actions"><button class="icon-btn icon-btn--solid" data-new aria-label="Novo procedimento">${I.plus}</button></div>
      </header>
      ${active.length ? `<div class="list">${active.map(card).join('')}</div>` : empty(I.sparkle, 'Catálogo vazio', 'Cadastre o primeiro procedimento.')}
      ${inactive.length ? `<div class="section-title">Desativados</div><div class="list">${inactive.map(card).join('')}</div>` : ''}
      <p class="small muted mt-lg" style="text-align:center">Alterar valores ou durações não modifica atendimentos já agendados.</p>
    </div>`;
  main.querySelector('[data-new]').onclick = () => openProcedureForm();
  main.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => openProcedureForm(list.find((p) => p.id === Number(b.dataset.id)))));
}

function openProcedureForm(p) {
  const editing = !!p;
  const v = p || { name: '', description: '', price_cents: null, duration_min: 60, active: true };
  const { el, close } = openSheet({
    title: editing ? 'Editar procedimento' : 'Novo procedimento',
    body: `
      <form novalidate>
        <label class="field" data-field="name"><span>Nome</span><input class="input" name="name" value="${esc(v.name)}" ${editing ? '' : 'autofocus'}></label>
        <label class="field"><span>Descrição</span><textarea class="textarea" name="description">${esc(v.description || '')}</textarea></label>
        <div class="grid-2">
          <label class="field" data-field="price"><span>Valor (R$)</span><input class="input" name="price" inputmode="decimal" value="${centsToInput(v.price_cents)}" placeholder="0,00"></label>
          <label class="field" data-field="duration_min"><span>Duração (min)</span><input class="input" name="duration_min" type="number" inputmode="numeric" min="5" step="5" value="${v.duration_min}"></label>
        </div>
        ${editing ? `<div class="card" style="padding:0 16px"><label class="check"><span class="check__label">Ativo para novos agendamentos</span><span class="switch"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}><span></span></span></label></div>
        <p class="small muted">Desativar oculta o procedimento das novas marcações e preserva o histórico.</p>` : ''}
      </form>`,
    foot: `<button class="btn btn--ghost" data-cancel>Cancelar</button><button class="btn btn--gold" data-save>Salvar</button>`,
  });
  const form = el.querySelector('form');
  el.querySelector('[data-cancel]').onclick = () => close();
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    const price = parseMoney(form.price.value);
    const dur = Number(form.duration_min.value);
    const bad = [];
    if (!form.name.value.trim()) bad.push('name');
    if (!Number.isFinite(price) || price < 0) bad.push('price');
    if (!Number.isInteger(dur) || dur <= 0) bad.push('duration_min');
    if (bad.length) { markInvalid(form, bad); toast('Valor deve ser ≥ 0 e duração maior que zero.', { error: true }); return; }
    const body = { name: form.name.value, description: form.description.value, price_cents: price, duration_min: dur, active: form.active ? form.active.checked : true };
    try {
      editing ? await api.put(`/api/procedures/${p.id}`, body) : await api.post('/api/procedures', body);
      close();
      toast('Procedimento salvo');
      rerender();
    } catch (e) { if (e.data?.fields) markInvalid(form, e.data.fields); toastError(e); }
  });
}
