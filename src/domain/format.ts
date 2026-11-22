// Telefone, site e datas (fuso America/Sao_Paulo).

export const TZ = 'America/Sao_Paulo';
// O Brasil não adota horário de verão desde 2019: São Paulo é UTC-03:00 o ano todo.
const OFFSET = '-03:00';

/** Somente dígitos, com DDI 55. */
export function normalizarTelefone(raw: string | undefined | null): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  d = d.replace(/^00/, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  d = d.replace(/^0+/, ''); // 011 9xxxx -> 11 9xxxx
  if (d.length === 10 || d.length === 11) return '55' + d;
  if (d.startsWith('55')) return d;
  return '55' + d;
}

export function formatarTelefone(norm: string | undefined | null): string {
  const d = String(norm ?? '');
  if (!d) return '';
  const m13 = d.match(/^55(\d{2})(\d{5})(\d{4})$/);
  if (m13) return `+55 (${m13[1]}) ${m13[2]}-${m13[3]}`;
  const m12 = d.match(/^55(\d{2})(\d{4})(\d{4})$/);
  if (m12) return `+55 (${m12[1]}) ${m12[2]}-${m12[3]}`;
  return '+' + d;
}

export function dominioDoSite(site: string | undefined | null): string {
  let s = String(site ?? '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/?#]/)[0];
  return s.replace(/:\d+$/, '');
}

export function urlDoSite(site: string): string {
  if (!site) return '';
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

// ---------- Datas ----------

const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDataCurta = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtPartes = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function partes(d: Date) {
  const p = Object.fromEntries(fmtPartes.formatToParts(d).map((x) => [x.type, x.value]));
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, min: p.minute };
}

/** "YYYY-MM-DD" do dia em São Paulo. */
export function diaSP(iso: string | Date): string {
  const p = partes(typeof iso === 'string' ? new Date(iso) : iso);
  return `${p.ano}-${p.mes}-${p.dia}`;
}

export function hojeSP(): string {
  return diaSP(new Date());
}

/** Valor para <input type="datetime-local"> no horário de São Paulo. */
export function isoParaInputLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = partes(new Date(iso));
  return `${p.ano}-${p.mes}-${p.dia}T${p.hora}:${p.min}`;
}

/** Converte valor de input datetime-local (interpretado em São Paulo) para ISO UTC. */
export function inputLocalParaIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v.length === 16 ? v + ':00' : v}${OFFSET}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Início do dia (00:00 em SP) de um "YYYY-MM-DD", em ISO UTC. */
export function inicioDiaIso(dia: string): string {
  return new Date(`${dia}T00:00:00${OFFSET}`).toISOString();
}
export function fimDiaIso(dia: string): string {
  return new Date(new Date(`${dia}T00:00:00${OFFSET}`).getTime() + 86400000 - 1).toISOString();
}

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00${OFFSET}`);
  d.setUTCDate(d.getUTCDate() + n);
  return diaSP(d);
}

/** ISO de um dia SP (YYYY-MM-DD) num horário (HH:mm). */
export function diaHoraIso(dia: string, hora = '09:00'): string {
  return new Date(`${dia}T${hora}:00${OFFSET}`).toISOString();
}

export function formatarData(iso: string | null | undefined): string {
  return iso ? fmtData.format(new Date(iso)) : '—';
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${fmtData.format(d)} ${fmtHora.format(d)}`;
}

/** Data relativa curta: "hoje 14:00", "amanhã 09:00", "ontem", "12/05 10:00". */
export function formatarRelativo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const dia = diaSP(d);
  const hoje = hojeSP();
  const hora = fmtHora.format(d);
  if (dia === hoje) return `hoje ${hora}`;
  if (dia === somarDias(hoje, 1)) return `amanhã ${hora}`;
  if (dia === somarDias(hoje, -1)) return `ontem ${hora}`;
  return `${fmtDataCurta.format(d)} ${hora}`;
}

export function diasEntre(diaA: string, diaB: string): number {
  return Math.round((new Date(`${diaB}T12:00:00Z`).getTime() - new Date(`${diaA}T12:00:00Z`).getTime()) / 86400000);
}

export function vencida(iso: string | null | undefined): boolean {
  return !!iso && new Date(iso).getTime() < Date.now();
}

export function formatarMoeda(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarPct(v: number | null): string {
  return v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function agoraIso(): string {
  return new Date().toISOString();
}
