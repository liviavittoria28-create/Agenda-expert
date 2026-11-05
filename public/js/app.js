// Agenda Expert — inicialização, sessão e rotas
import { api, setUnauthorizedHandler } from './api.js';
import { I } from './icons.js';
import { state, parseHash, closeAllSheets, esc } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderAgenda } from './views/agenda.js';
import { renderClients, renderClient } from './views/clients.js';
import { renderProcedures } from './views/procedures.js';
import { renderFinance } from './views/finance.js';
import { renderMore, renderBlocks, renderStock, renderSettings } from './views/more.js';

const root = document.getElementById('root');

const TABS = [
  { id: 'agenda', label: 'Agenda', icon: I.calendar },
  { id: 'clientes', label: 'Clientes', icon: I.users },
  { id: 'procedimentos', label: 'Procedimentos', icon: I.sparkle },
  { id: 'financeiro', label: 'Financeiro', icon: I.wallet },
  { id: 'mais', label: 'Mais', icon: I.more },
];

setUnauthorizedHandler(() => {
  if (!state.user) return;
  state.user = null;
  closeAllSheets();
  showLogin();
});

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    const me = await api.get('/api/me');
    Object.assign(state, { user: me.user, settings: me.settings, today: me.today });
    showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  renderLogin(root, async (me) => {
    Object.assign(state, { user: me.user, settings: me.settings, today: me.today });
    if (!location.hash || location.hash === '#/') location.hash = '#/agenda';
    showApp();
  });
}

function showApp() {
  root.innerHTML = `
    <div class="app">
      <nav class="nav" aria-label="Navegação principal">
        <div class="nav__brand"><b>Agenda <em>Expert</em></b><span>${esc(state.settings.studio_name || '')}</span></div>
        ${TABS.map((t) => `<a href="#/${t.id}" data-tab="${t.id}">${t.icon}<span>${t.label}</span></a>`).join('')}
      </nav>
      <main class="main" id="main"></main>
    </div>`;
  route();
}

let renderSeq = 0;
async function route() {
  if (!state.user) return;
  const main = document.getElementById('main');
  if (!main) return;
  const { parts, query } = parseHash();
  const tab = parts[0] || 'agenda';
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('is-active', a.dataset.tab === tab));
  const seq = ++renderSeq;
  const ctx = { parts, query, isCurrent: () => seq === renderSeq };
  try {
    if (tab === 'agenda') await renderAgenda(main, ctx);
    else if (tab === 'clientes' && parts[1]) await renderClient(main, ctx);
    else if (tab === 'clientes') await renderClients(main, ctx);
    else if (tab === 'procedimentos') await renderProcedures(main, ctx);
    else if (tab === 'financeiro') await renderFinance(main, ctx);
    else if (tab === 'mais' && parts[1] === 'bloqueios') await renderBlocks(main, ctx);
    else if (tab === 'mais' && parts[1] === 'estoque') await renderStock(main, ctx);
    else if (tab === 'mais' && parts[1] === 'ajustes') await renderSettings(main, ctx);
    else if (tab === 'mais') await renderMore(main, ctx);
    else location.hash = '#/agenda';
  } catch (e) {
    if (e?.status === 401) return;
    console.error(e);
    main.innerHTML = `<div class="page"><div class="empty">${I.alert}<b>Não foi possível carregar</b><p>${esc(e.message || '')}</p></div></div>`;
  }
}

let lastPath = '';
window.addEventListener('hashchange', () => {
  closeAllSheets();
  const path = location.hash.split('?')[0];
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  route();
});
window.addEventListener('ae:render', route);
boot();
