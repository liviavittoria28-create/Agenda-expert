// Tela de acesso — CSU01
import { api } from '../api.js';
import { I } from '../icons.js';

export function renderLogin(root, onSuccess) {
  root.innerHTML = `
    <div class="login">
      <form class="login__box" novalidate>
        <div class="login__brand">
          <div class="login__mark">${I.sparkle.replace('stroke-width="1.6"', 'stroke-width="1"')}</div>
          <h1>Agenda <em>Expert</em></h1>
          <p>Esther Lino · Bio Estética</p>
        </div>
        <label class="field"><span>E-mail</span>
          <input class="input" type="email" name="email" autocomplete="username" inputmode="email" required autofocus placeholder="seu@email.com"></label>
        <label class="field"><span>Senha</span>
          <input class="input" type="password" name="password" autocomplete="current-password" required placeholder="••••••••"></label>
        <div class="login__err" role="alert"></div>
        <button class="btn btn--block" type="submit">Entrar</button>
        <p class="login__foot">${I.lock.replace('<svg', '<svg style="width:12px;height:12px;display:inline;vertical-align:-1px;margin-right:4px"')}Acesso exclusivo da profissional</p>
      </form>
    </div>`;
  const form = root.querySelector('form');
  const err = root.querySelector('.login__err');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) { err.textContent = 'Informe e-mail e senha.'; return; }
    const btn = form.querySelector('button');
    btn.disabled = true;
    err.textContent = '';
    try {
      await api.post('/api/login', { email, password });
      const me = await api.get('/api/me');
      onSuccess(me);
    } catch (ex) {
      err.textContent = ex.message;
      form.password.select();
    } finally {
      btn.disabled = false;
    }
  });
}
