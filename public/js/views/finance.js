// Financeiro — CSU09, CSU10, RF21–RF27
import { api } from '../api.js';
import { I } from '../icons.js';
import {
  state, esc, money, fmtDate, fmtMonth, fmtDayShort, centsToInput, parseMoney, openSheet, confirmDialog, toast,
  toastError, markInvalid, busy, rerender, go, qs, empty, addMonths,
} from '../ui.js';

async function meta() {
  if (!state.financeMeta) state.financeMeta = await api.get('/api/finance/meta');
  return state.financeMeta;
}

export async function renderFinance(main, ctx) {
  const m = /^\d{4}-\d{2}$/.test(ctx.query.m || '') ? ctx.query.m : state.today.slice(0, 7);
  const f = { type: ctx.query.tipo || '', category: ctx.query.cat || '', method: ctx.query.forma || '' };
  const [M, data] = await Promise.all([meta(), api.get(`/api/transactions${qs({ month: m, type: f.type, category: f.category, method: f.method })}`)]);
  if (!ctx.isCurrent()) return;
  const link = (o) => `#/financeiro${qs({ m, tipo: f.type, cat: f.category, forma: f.method, ...o })}`;
  const s = data.summary;
  const tot = s.income_cents + s.expense_cents;
  const cats = [...new Set([...M.categories.in, ...M.categories.out])];
  const maxCat = Math.max(1, ...data.by_category.map((c) => c.amount_cents));
  const filtered = f.type || f.category || f.method;

  main.innerHTML = `
    <div class="page">
      <header class="top">
        <div><div class="top__eyebrow">Financeiro</div><h1>${esc(fmtMonth(m).slice(0, -5))} <em>${m.slice(0, 4)}</em></h1></div>
        <div class="top__actions no-print">
          <button class="icon-btn" data-go="${link({ m: addMonths(m + '-01', -1).slice(0, 7) })}" aria-label="Mês anterior">${I.left}</button>
          <button class="icon-btn" data-go="${link({ m: addMonths(m + '-01', 1).slice(0, 7) })}" aria-label="Próximo mês">${I.right}</button>
        </div>
      </header>
      <div class="print-only"><p class="muted">${esc(state.settings.studio_name || '')} · Resumo financeiro de ${esc(fmtMonth(m))}</p></div>

      <section class="fin-hero">
        <small>Saldo do mês</small>
        <div class="big ${s.balance_cents < 0 ? 'neg' : ''}">${money(s.balance_cents)}</div>
        <div class="fin-split">
          <div><small>Entradas</small><b class="in">${money(s.income_cents)}</b></div>
          <div><small>Saídas</small><b class="out">${money(s.expense_cents)}</b></div>
        </div>
        ${tot ? `<div class="fin-bar"><i style="width:${(s.income_cents / tot) * 100}%"></i><i style="width:${(s.expense_cents / tot) * 100}%"></i></div>` : ''}
      </section>

      <div class="row mt no-print" style="gap:8px">
        <a class="btn btn--ghost btn--sm grow" href="/api/transactions/export?month=${m}" download>${I.download}Planilha</a>
        <button class="btn btn--ghost btn--sm grow" data-print>${I.print}PDF</button>
      </div>

      ${data.by_category.length ? `
        <div class="section-title">Por categoria</div>
        <div class="card cat-bars">${data.by_category.slice(0, 8).map((c) => `
          <div class="cat-bar"><div class="row between"><span>${esc(c.category)}</span><span class="tx-amt ${c.type}">${c.type === 'out' ? '−' : '+'} ${money(c.amount_cents)}</span></div>
          <div class="cat-bar__track"><i style="width:${(c.amount_cents / maxCat) * 100}%;background:${c.type === 'in' ? 'var(--in)' : 'var(--out)'};opacity:.75"></i></div></div>`).join('')}
        </div>` : ''}

      <div class="section-title"><b>Movimentações</b><span>${data.items.length}</span></div>
      <div class="no-print">
        <div class="scroll-x" style="margin-bottom:10px">
          ${[['', 'Todas'], ['in', 'Entradas'], ['out', 'Saídas']].map(([k, l]) => `<button class="chip ${f.type === k ? 'is-on' : ''}" data-go="${link({ tipo: k })}">${l}</button>`).join('')}
        </div>
        <div class="grid-2" style="margin-bottom:14px">
          <select class="select" data-filter="cat" aria-label="Categoria"><option value="">Todas as categorias</option>${cats.map((c) => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select class="select" data-filter="forma" aria-label="Forma de pagamento"><option value="">Todas as formas</option>${M.methods.map((c) => `<option ${c === f.method ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </div>
      </div>
      ${data.items.length ? `<div class="list">${data.items.map((t) => `
        <button class="item" data-tx="${t.id}">
          <span class="tx-ico ${t.type}">${t.type === 'in' ? I.arrowDown : I.arrowUp}</span>
          <div class="item__main"><div class="item__title">${esc(t.description || t.category)}</div>
            <div class="item__sub">${esc(t.category)}${t.method ? ` · ${esc(t.method)}` : ''} · ${fmtDayShort(t.date)}</div></div>
          <span class="tx-amt ${t.type}">${t.type === 'in' ? '+' : '−'} ${money(t.amount_cents)}</span>
        </button>`).join('')}</div>`
        : `<div class="card">${empty(I.wallet, filtered ? 'Nada com esses filtros' : 'Sem movimentações', filtered ? 'Ajuste os filtros acima.' : 'Toque em + para lançar uma entrada ou saída.')}</div>`}
    </div>
    <button class="fab" data-new aria-label="Nova movimentação">${I.plus}</button>`;

  main.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  main.querySelectorAll('[data-filter]').forEach((s) => (s.onchange = () => go(link({ [s.dataset.filter]: s.value }))));
  main.querySelector('[data-print]').onclick = () => window.print();
  main.querySelector('[data-new]').onclick = () => openTxForm({ prefill: { date: m === state.today.slice(0, 7) ? state.today : `${m}-01` } });
  main.querySelectorAll('[data-tx]').forEach((b) => (b.onclick = () => openTxForm({ tx: data.items.find((t) => t.id === Number(b.dataset.tx)) })));
}

export async function openTxForm({ tx, prefill = {} } = {}) {
  const M = await meta();
  const editing = !!tx;
  const v = { type: 'in', amount_cents: null, date: state.today, category: '', method: 'Pix', description: '', ...prefill, ...(tx || {}) };
  const catOptions = (type, cur) => M.categories[type].map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const { el, close } = openSheet({
    title: editing ? 'Editar movimentação' : prefill.appointment_id ? 'Registrar entrada' : 'Nova movimentação',
    body: `
      <form novalidate>
        <div class="seg seg--full" style="margin-bottom:18px" data-field="type">
          <button type="button" data-type="in" class="${v.type === 'in' ? 'is-on' : ''}">Entrada</button>
          <button type="button" data-type="out" class="${v.type === 'out' ? 'is-on' : ''}">Saída</button>
        </div>
        ${v.client_name || prefill.appointment_id ? `<div class="alert alert--info">${I.info}<div>Valor pré-preenchido a partir do atendimento. Ajuste se necessário antes de salvar.</div></div>` : ''}
        <label class="field" data-field="amount"><span>Valor (R$)</span>
          <input class="input" name="amount" inputmode="decimal" value="${centsToInput(v.amount_cents)}" placeholder="0,00" style="font-size:28px;font-family:var(--serif);min-height:60px" ${editing || prefill.amount_cents ? '' : 'autofocus'}></label>
        <div class="grid-2">
          <label class="field" data-field="date"><span>Data</span><input class="input" type="date" name="date" value="${esc(v.date)}"></label>
          <label class="field" data-field="method"><span>Forma</span><select class="select" name="method">${M.methods.map((x) => `<option ${x === v.method ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        </div>
        <label class="field" data-field="category"><span>Categoria</span><select class="select" name="category">${catOptions(v.type, v.category)}</select></label>
        <label class="field"><span>Descrição</span><input class="input" name="description" value="${esc(v.description || '')}" placeholder="Ex.: compra de cola para cílios"></label>
        ${v.client_name ? `<p class="small muted">Cliente: ${esc(v.client_name)}</p>` : ''}
        ${editing ? `<button type="button" class="btn btn--danger btn--block btn--sm mt" data-del>${I.trash}Excluir movimentação</button>` : ''}
      </form>`,
    foot: `<button class="btn btn--ghost" data-cancel>Cancelar</button><button class="btn btn--gold" data-save>Salvar</button>`,
  });
  const form = el.querySelector('form');
  let type = v.type;
  el.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => {
    type = b.dataset.type;
    el.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('is-on', x === b));
    form.category.innerHTML = catOptions(type, '');
  }));
  el.querySelector('[data-cancel]').onclick = () => close();
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Excluir movimentação?', message: `${type === 'in' ? 'Entrada' : 'Saída'} de ${money(v.amount_cents)} em ${fmtDate(v.date)}.`, ok: 'Excluir', danger: true }))) return;
    try { await api.del(`/api/transactions/${tx.id}`); close(); toast('Movimentação excluída'); rerender(); } catch (e) { toastError(e); }
  });
  el.querySelector('[data-save]').onclick = (ev) => busy(ev.currentTarget, async () => {
    const amount = parseMoney(form.amount.value);
    const bad = [];
    if (!Number.isFinite(amount) || amount <= 0) bad.push('amount');
    if (!form.date.value) bad.push('date');
    if (!form.category.value) bad.push('category');
    if (bad.length) { markInvalid(form, bad); toast('Informe um valor maior que zero, data e categoria.', { error: true }); return; }
    const body = {
      type, amount_cents: amount, date: form.date.value, category: form.category.value, method: form.method.value,
      description: form.description.value, client_id: v.client_id || null, appointment_id: v.appointment_id || null,
    };
    try {
      editing ? await api.put(`/api/transactions/${tx.id}`, body) : await api.post('/api/transactions', body);
      close();
      toast(type === 'in' ? 'Entrada registrada' : 'Saída registrada');
      rerender();
    } catch (e) { if (e.data?.fields) markInvalid(form, e.data.fields); toastError(e); }
  });
}
