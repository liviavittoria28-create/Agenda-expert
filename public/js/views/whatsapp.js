// Mais → WhatsApp: conexão, robô de confirmação e mensagens
import { api } from '../api.js';
import { I } from '../icons.js';
import { state, esc, waMessage, fmtDayLong, maskPhone, toast, toastError, busy, rerender, confirmDialog, empty } from '../ui.js';
import { openAppointmentDetail } from './appointment.js';

export const waLabel = (wa) =>
  !wa ? 'Robô de confirmação' : wa.status === 'connected' ? `Conectado${wa.me?.number ? ` · +${wa.me.number}` : ''}` : wa.status === 'qr' || wa.status === 'connecting' ? 'Conectando…' : 'Desconectado — toque para conectar';

const time = (iso) => (iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');

function waChip(a) {
  const w = a.wa;
  if (w?.reply === 'confirm') return '<span class="badge badge--ok"><span class="dot"></span>Confirmou pelo WhatsApp</span>';
  if (w?.reply === 'reschedule') return '<span class="badge st-cancelada"><span class="dot"></span>Pediu para remarcar</span>';
  if (w?.status === 'sent') return `<span class="badge st-agendada"><span class="dot"></span>Enviada ${time(w.sent_at)}</span>`;
  if (w?.status === 'failed') return `<span class="badge st-cancelada" title="${esc(w.error || '')}"><span class="dot"></span>Falhou</span>`;
  if (a.status === 'confirmada') return '<span class="badge st-confirmada"><span class="dot"></span>Já confirmada</span>';
  if (a.status === 'agendada') return '<span class="badge badge--muted"><span class="dot"></span>Aguardando envio</span>';
  return `<span class="badge st-${a.status}"><span class="dot"></span>${a.status === 'concluida' ? 'Concluída' : a.status === 'cancelada' ? 'Cancelada' : 'Faltou'}</span>`;
}

export async function renderWhatsApp(main, ctx) {
  const [wa, s] = await Promise.all([api.get('/api/whatsapp'), api.get('/api/settings')]);
  if (!ctx.isCurrent()) return;
  const connected = wa.status === 'connected';
  const pending = wa.appointments.filter((a) => a.status === 'agendada' && (!a.wa || a.wa.status === 'failed'));

  let conn;
  if (connected) {
    conn = `
      <div class="wa-conn">
        <span class="wa-dot is-on"></span>
        <div class="grow"><b>WhatsApp conectado</b><span>${wa.me?.number ? `+${esc(wa.me.number)}` : ''}${wa.me?.name ? ` · ${esc(wa.me.name)}` : ''}</span></div>
        <button class="btn btn--ghost btn--sm" data-logout>Desconectar</button>
      </div>
      ${wa.sending ? `<div class="alert alert--info mt">${I.clock}<div>Enviando confirmações com pausas entre cada mensagem…</div></div>` : ''}`;
  } else if (wa.status === 'qr' || wa.status === 'connecting') {
    conn = wa.pairing
      ? `<div class="wa-pair">
          <div class="label">Seu código</div>
          <div class="wa-code">${esc(wa.pairing)}</div>
          <ol class="wa-steps">
            <li>Toque na notificação do WhatsApp que chegou no celular, <b>ou</b> abra o WhatsApp → <b>Configurações</b> → <b>Aparelhos conectados</b> → <b>Conectar aparelho</b>.</li>
            <li>Escolha <b>Conectar com número de telefone</b>.</li>
            <li>Digite o código acima.</li>
          </ol>
          <button class="btn btn--ghost btn--sm" data-cancel>Cancelar</button>
        </div>`
      : wa.qr
        ? `<div class="wa-qr-wrap">
            <div class="wa-qr">${wa.qr}</div>
            <ol class="wa-steps">
              <li>No celular do estúdio, abra o <b>WhatsApp</b>.</li>
              <li>Vá em <b>Configurações</b> → <b>Aparelhos conectados</b> → <b>Conectar aparelho</b>.</li>
              <li>Aponte a câmera para este código.</li>
            </ol>
          </div>
          <div class="row mt" style="gap:8px;flex-wrap:wrap">
            <button class="btn btn--ghost btn--sm" data-pair>No próprio celular? Usar número</button>
            <button class="btn btn--ghost btn--sm" data-cancel>Cancelar</button>
          </div>`
        : `<div class="row" style="gap:12px"><div class="spinner" style="margin:0"></div><span class="muted">Iniciando conexão…</span></div>`;
  } else {
    conn = `
      <div class="wa-hero">
        <span class="wa-hero__ico">${I.whatsapp}</span>
        <b>Conecte o WhatsApp do estúdio</b>
        <p>O app passa a enviar a mensagem de confirmação sozinho e entende quando a cliente responde <b>1</b> (confirmo) ou <b>2</b> (remarcar).</p>
        ${wa.error ? `<div class="alert alert--danger" style="text-align:left">${I.alert}<div>${esc(wa.error)}</div></div>` : ''}
        <div class="row" style="gap:8px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn--gold" data-connect>${I.whatsapp}Conectar com QR code</button>
          <button class="btn btn--ghost" data-pair>Conectar com número</button>
        </div>
        <p class="small muted" style="margin-top:12px">Use o QR code se abrir o app no computador. No próprio iPhone, use “Conectar com número”.</p>
      </div>`;
  }

  const sample = { client_name: 'Maria Silva', date: state.today, start: '14:00', end: '15:00', total_cents: 18000, procedures: [{ name: 'Lash lifting' }] };

  main.innerHTML = `
    <div class="page">
      <header class="top" style="padding-bottom:0"><a class="back" href="#/mais">${I.left}Mais</a></header>
      <header class="top"><div><div class="top__eyebrow">Robô de confirmação</div><h1>WhatsApp</h1></div></header>

      <section class="card" style="padding:20px">${conn}</section>

      <div class="section-title"><b>Confirmações</b><span>${esc(fmtDayLong(wa.target_date))}</span></div>
      ${wa.appointments.length ? `<div class="list">${wa.appointments.map((a) => `
        <div class="item">
          <button class="item__main" data-appt="${a.id}" style="text-align:left">
            <div class="item__title">${a.start} · ${esc(a.client_name)}</div>
            <div class="item__sub">${esc(a.procedures.map((p) => p.name).join(' + '))}</div>
            <div style="margin-top:6px">${waChip(a)}</div>
          </button>
          ${connected && ['agendada', 'confirmada'].includes(a.status) && !a.wa?.reply ? `<button class="btn btn--ghost btn--sm" data-send="${a.id}">${a.wa?.status === 'sent' ? 'Reenviar' : 'Enviar'}</button>` : ''}
        </div>`).join('')}</div>
        ${connected && pending.length ? `<button class="btn btn--block mt" data-send-all>${I.whatsapp}Enviar ${pending.length} confirmação(ões) agora</button>` : ''}`
        : `<div class="card">${empty(I.calendar, 'Nenhum atendimento', 'Não há atendimentos neste dia.')}</div>`}

      <div class="section-title">Envio automático</div>
      <form class="card" style="padding:4px 18px 18px" data-auto>
        <label class="check"><span class="check__label"><b>Enviar confirmações sozinho</b><br><span class="small muted">Só para atendimentos “Agendada”, uma vez cada.</span></span>
          <span class="switch"><input type="checkbox" name="wa_auto" ${s.wa_auto === '1' ? 'checked' : ''}><span></span></span></label>
        <div class="grid-2 mt">
          <label class="field"><span>Quando</span><select class="select" name="wa_mode">
            <option value="same_day" ${s.wa_mode !== 'day_before' ? 'selected' : ''}>No dia</option>
            <option value="day_before" ${s.wa_mode === 'day_before' ? 'selected' : ''}>Na véspera</option></select></label>
          <label class="field"><span>A partir das</span><input class="input" type="time" name="wa_time" value="${esc(s.wa_time || '08:00')}"></label>
        </div>
        <button class="btn btn--gold btn--block" type="submit">Salvar envio automático</button>
      </form>

      <div class="section-title">Mensagens</div>
      <form data-msgs>
        <label class="field"><span>Mensagem de confirmação</span><textarea class="textarea" name="whatsapp_template" style="min-height:220px">${esc(s.whatsapp_template || '')}</textarea></label>
        <label class="field"><span>Instruções de resposta (vão no fim)</span><textarea class="textarea" name="wa_footer" style="min-height:90px">${esc(s.wa_footer || '')}</textarea>
          <small>O robô entende <b>1</b>, “confirmo”, “sim”… e <b>2</b>, “remarcar”, “não posso”… Outras mensagens ficam para você responder.</small></label>
        <label class="field"><span>Resposta quando a cliente confirma</span><textarea class="textarea" name="wa_reply_confirm">${esc(s.wa_reply_confirm || '')}</textarea>
          <small>O atendimento muda sozinho para <b>Confirmada</b>.</small></label>
        <label class="field"><span>Resposta quando pede para remarcar</span><textarea class="textarea" name="wa_reply_reschedule">${esc(s.wa_reply_reschedule || '')}</textarea>
          <small>O atendimento ganha o aviso <b>Pediu para remarcar</b> na agenda.</small></label>
        <p class="small muted">Campos: <b>[nome]</b>, <b>[data]</b>, <b>[horário]</b>, <b>[procedimento]</b>, <b>[valor]</b>. *Asteriscos* deixam em negrito.</p>
        <div class="label">Prévia</div>
        <div class="wa-bubble" data-preview></div>
        <button class="btn btn--gold btn--block mt" type="submit">Salvar mensagens</button>
      </form>

      <div class="alert mt-lg">${I.info}<div><b>Bom saber:</b> a conexão usa o WhatsApp Web de forma não oficial e gratuita. O WhatsApp pode restringir números que mandam muitas mensagens para quem não tem o contato salvo. Para reduzir o risco, o robô envia uma mensagem por vez com pausas, só para clientes cadastradas e no máximo ${40} por rodada. Salve o número do estúdio na agenda das clientes, se possível.</div></div>
    </div>`;

  // prévia ao vivo
  const msgs = main.querySelector('[data-msgs]');
  const preview = () => {
    const body = waMessage(msgs.whatsapp_template.value, sample).trim();
    const foot = waMessage(msgs.wa_footer.value, sample).trim();
    msgs.querySelector('[data-preview]').innerHTML = esc(foot ? `${body}\n\n${foot}` : body).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  };
  msgs.oninput = preview;
  preview();

  const saveSettings = (form, body, msg) => busy(form.querySelector('[type=submit]'), async () => {
    try { state.settings = await api.put('/api/settings', body); toast(msg); } catch (e) { toastError(e); }
  });
  msgs.onsubmit = (e) => {
    e.preventDefault();
    saveSettings(msgs, { whatsapp_template: msgs.whatsapp_template.value, wa_footer: msgs.wa_footer.value, wa_reply_confirm: msgs.wa_reply_confirm.value, wa_reply_reschedule: msgs.wa_reply_reschedule.value }, 'Mensagens salvas');
  };
  const auto = main.querySelector('[data-auto]');
  auto.onsubmit = (e) => {
    e.preventDefault();
    saveSettings(auto, { wa_auto: auto.wa_auto.checked ? '1' : '0', wa_mode: auto.wa_mode.value, wa_time: auto.wa_time.value }, auto.wa_auto.checked ? 'Envio automático ligado' : 'Envio automático desligado')
      .then(() => rerender());
  };

  // conexão
  const act = (sel, fn) => main.querySelector(sel)?.addEventListener('click', (ev) => busy(ev.currentTarget, fn));
  act('[data-connect]', async () => { try { await api.post('/api/whatsapp/connect'); rerender(); } catch (e) { toastError(e); } });
  main.querySelectorAll('[data-pair]').forEach((b) => b.addEventListener('click', () => askNumber()));
  act('[data-cancel]', async () => { await api.post('/api/whatsapp/logout').catch(() => {}); rerender(); });
  act('[data-logout]', async () => {
    if (!(await confirmDialog({ title: 'Desconectar o WhatsApp?', message: 'O robô para de enviar e responder. Você pode conectar de novo quando quiser.', ok: 'Desconectar', danger: true }))) return;
    await api.post('/api/whatsapp/logout');
    toast('WhatsApp desconectado');
    rerender();
  });
  act('[data-send-all]', async () => {
    try { const r = await api.post('/api/whatsapp/send', {}); toast(`Enviando ${r.queued} mensagem(ns) com pausas`); rerender(); } catch (e) { toastError(e); }
  });
  main.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    try { await api.post('/api/whatsapp/send', { appointment_id: Number(b.dataset.send) }); toast('Mensagem enviada'); rerender(); } catch (e) { toastError(e); }
  })));
  main.querySelectorAll('[data-appt]').forEach((b) => (b.onclick = () => openAppointmentDetail(Number(b.dataset.appt))));

  // atualiza sozinho enquanto conecta / envia
  const interval = wa.status === 'qr' || wa.status === 'connecting' || wa.sending ? 2500 : 20000;
  const timer = setInterval(async () => {
    if (!ctx.isCurrent() || !document.body.contains(main.querySelector('[data-msgs]'))) return clearInterval(timer);
    if (document.querySelector('.sheet') || document.activeElement?.closest('form')) return; // não atrapalha quem está editando
    const now = await api.get('/api/whatsapp').catch(() => null);
    if (now && (now.status !== wa.status || now.qr !== wa.qr || now.pairing !== wa.pairing || now.sending !== wa.sending || JSON.stringify(now.appointments.map((a) => [a.status, a.wa])) !== JSON.stringify(wa.appointments.map((a) => [a.status, a.wa])))) {
      clearInterval(timer);
      rerender();
    }
  }, interval);
}

async function askNumber() {
  const { openSheet } = await import('../ui.js');
  const { el, close } = openSheet({
    title: 'Conectar com número',
    body: `
      <p class="muted" style="margin-top:0">Informe o número do WhatsApp do estúdio. Vamos gerar um código para você digitar no próprio celular.</p>
      <label class="field"><span>WhatsApp do estúdio</span><input class="input" type="tel" inputmode="tel" name="phone" placeholder="(11) 99999-0000" autofocus></label>`,
    foot: `<button class="btn btn--gold btn--block" data-go>Gerar código</button>`,
  });
  const input = el.querySelector('[name=phone]');
  input.oninput = () => (input.value = maskPhone(input.value));
  el.querySelector('[data-go]').onclick = (ev) => busy(ev.currentTarget, async () => {
    try {
      await api.post('/api/whatsapp/connect', { phone: input.value });
      close();
      rerender();
    } catch (e) { toastError(e); }
  });
}
