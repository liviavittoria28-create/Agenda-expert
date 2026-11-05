// Regras do robô de confirmação pelo WhatsApp (funções puras, testáveis sem conexão)
import { addDays, fmtBR, weekday } from './time.js';

const DOW = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const norm = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- Telefones
export const digits = (s) => String(s || '').replace(/\D/g, '');

/** Número completo com DDI do Brasil: (11) 99999-0000 → 5511999990000 */
export function fullNumber(phone) {
  let d = digits(phone);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

/**
 * Chave de comparação que ignora o "9" extra dos celulares brasileiros
 * (o WhatsApp às vezes registra 55 11 9999-0000 sem o 9).
 */
export function phoneKey(phone) {
  const d = fullNumber(phone);
  if (d.startsWith('55') && d.length >= 12) return `55${d.slice(2, 4)}${d.slice(-8)}`;
  return d;
}

/** Extrai o número de um identificador do WhatsApp (5511...@s.whatsapp.net) */
export function jidNumber(jid) {
  const m = String(jid || '').match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- Respostas
const RESCHEDULE = /\b(2|remarcar|remarca|reagendar|reagenda|desmarcar|desmarca|cancelar|cancela|cancelo|nao confirmo|nao vou|nao posso|nao consigo|nao poderei|nao vai dar|nao da|outro horario|outro dia|mudar|trocar)\b/;
const CONFIRM = /\b(1|confirmo|confirmado|confirmada|confirmar|confirma|confirmadissimo|sim|ok|okay|certo|combinado|estarei|vou sim|vou|pode confirmar|tudo certo|beleza|blz|perfeito|com certeza)\b/;

/** Interpreta a resposta da cliente: 'confirm', 'reschedule' ou null (não entendeu) */
export function parseReply(text) {
  const t = norm(text);
  if (!t) return null;
  if (t === '1') return 'confirm';
  if (t === '2') return 'reschedule';
  if (RESCHEDULE.test(t)) return 'reschedule';
  if (CONFIRM.test(t)) return 'confirm';
  return null;
}

// ---------------------------------------------------------------- Mensagens
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Troca [nome], [data], [horário], [procedimento] e [valor] pelos dados do atendimento */
export function fillTemplate(template, a) {
  if (!template) return '';
  const values = {
    nome: String(a.client_name || '').trim().split(/\s+/)[0] || '',
    'nome completo': a.client_name || '',
    data: a.date ? `${fmtBR(a.date)} (${DOW[weekday(a.date)]})` : '',
    horario: a.start || '',
    hora: a.start || '',
    termino: a.end || '',
    procedimento: (a.procedures || []).map((p) => p.name).join(' + '),
    valor: a.total_cents != null ? BRL.format(a.total_cents / 100) : '',
  };
  const key = (k) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return template.replace(/\[([^\]]+)\]/g, (m, k) => (key(k) in values ? values[key(k)] : m));
}

/** Mensagem de confirmação completa (texto principal + instruções de resposta) */
export function confirmationMessage(settings, a) {
  const main = fillTemplate(settings.whatsapp_template, a).trim();
  const footer = fillTemplate(settings.wa_footer || '', a).trim();
  return footer ? `${main}\n\n${footer}` : main;
}

// ---------------------------------------------------------------- Agendamento dos envios
/** Data dos atendimentos que recebem confirmação agora ('no dia' ou 'na véspera') */
export const targetDate = (settings, today) => (settings.wa_mode === 'day_before' ? addDays(today, 1) : today);

/**
 * Quais atendimentos devem receber a confirmação neste momento.
 * - só com o envio automático ligado e depois do horário configurado
 * - só "agendada" (quem já confirmou não recebe), ainda não enviados
 * - no envio "no dia", ignora atendimentos que já começaram
 * - ignora atendimentos marcados há menos de 3 horas (a cliente acabou de combinar)
 */
export function dueAppointments({ settings, today, nowMin, nowIso, appointments, sentIds }) {
  if (settings.wa_auto !== '1') return [];
  const [h, m] = String(settings.wa_time || '08:00').split(':').map(Number);
  if (nowMin < h * 60 + m) return [];
  const date = targetDate(settings, today);
  const now = Date.parse(nowIso);
  return appointments.filter((a) => {
    if (a.date !== date || a.status !== 'agendada' || sentIds.has(a.id)) return false;
    if (date === today) {
      const [sh, sm] = a.start.split(':').map(Number);
      if (sh * 60 + sm <= nowMin) return false;
    }
    if (a.created_at && now - Date.parse(a.created_at) < 3 * 3600e3) return false;
    return true;
  });
}

/** Pausa aleatória entre mensagens (parece envio humano e reduz risco de bloqueio) */
export const humanDelay = (min = 8000, max = 18000) => min + Math.floor(Math.random() * (max - min));
