// Horário de Brasília (sem horário de verão desde 2019: UTC−03:00) — RNF09, RSIS05
export const TZ = 'America/Sao_Paulo';
export const OFFSET = '-03:00';

export function todayBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const stamp = (date, hhmm) => `${date}T${hhmm}:00${OFFSET}`;
export const stampTime = (s) => s.slice(11, 16);

// valida o dia de verdade (rejeita 30/02, 31/04…)
export const isDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
};
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
}
export const weekday = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
export const fmtBR = (date) => date.split('-').reverse().join('/');
