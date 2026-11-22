/**
 * Migração de dados entre versões do app.
 *
 * Dois caminhos levam dados de uma versão antiga para a nova:
 *  1) Arquivo de backup (exportar na versão antiga → importar na nova): `prepararBackup`
 *     converte o JSON passo a passo (formato 1 → 2 → ... → atual) e depois normaliza cada registro.
 *  2) Mesmo navegador e mesma porta: o IndexedDB já tem os dados. O schema do Dexie
 *     (src/db/schema.ts) faz as migrações de estrutura, e `normalizarBancoLocal` (repo.ts)
 *     roda a mesma normalização quando a versão do app muda.
 *
 * COMO EVOLUIR (para cada melhoria futura):
 *  - Campo novo com valor padrão: adicione o padrão em `leadVazio()` (domain/lead.ts) ou em
 *    CONFIG_PADRAO. A normalização preenche os registros antigos sozinha. Não precisa mudar o formato.
 *  - Campo renomeado, valor de enum trocado ou estrutura alterada: aumente FORMATO_BACKUP
 *    (domain/versao.ts) e adicione aqui `MIGRACOES[n]` convertendo o formato n para n+1.
 *    Se a mudança também afeta índices do IndexedDB, adicione `this.version(N+1)` em schema.ts.
 */
import { CONFIG_PADRAO, ETAPAS, OPCOES_DIAGNOSTICO, RESULTADO_LABEL, STATUS_REUNIAO_LABEL, TEMP_LABEL, TIPO_LABEL } from '../domain/constants';
import { derivarLead, leadVazio } from '../domain/lead';
import { FORMATO_BACKUP, APP_VERSAO, compararVersao } from '../domain/versao';
import type { Atividade, Backup, Config, Lead, Reuniao, Venda } from '../domain/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bruto = any;

/** MIGRACOES[n] converte um backup do formato n para o formato n+1. */
const MIGRACOES: Record<number, (b: Bruto) => Bruto> = {
  // Formato 1 (app 0.1.0) → 2: adiciona versão do app, contagens e preferências.
  1: (b) => ({
    ...b,
    versao: 2,
    app_versao: b.app_versao ?? '0.1.0',
    contagens: undefined, // backups do formato 1 não tinham contagens
    preferencias: b.preferencias ?? {},
  }),
};

export interface OrigemBackup { formato: number; app_versao: string; exportado_em?: string }

export type ResultadoPreparo =
  | { ok: true; backup: Backup; origem: OrigemBackup; avisos: string[] }
  | { ok: false; erro: string };

/** Valida, converte para o formato atual e normaliza um backup lido de arquivo. */
export function prepararBackup(raw: unknown): ResultadoPreparo {
  const b = raw as Bruto;
  if (!b || typeof b !== 'object' || b.app !== 'crm-prospeccao' || !Array.isArray(b.leads)) {
    return { ok: false, erro: 'O arquivo não é um backup deste CRM.' };
  }
  const formato = Number(b.versao) || 1;
  const origem: OrigemBackup = { formato, app_versao: b.app_versao ?? '0.1.0', exportado_em: b.exportado_em };
  if (formato > FORMATO_BACKUP) {
    return {
      ok: false,
      erro: `Este backup foi gerado por uma versão mais nova do app (${origem.app_versao}, formato ${formato}). `
        + `Esta versão é ${APP_VERSAO} (formato ${FORMATO_BACKUP}). Use a versão mais nova para importar.`,
    };
  }
  const avisos: string[] = [];
  if (compararVersao(origem.app_versao, APP_VERSAO) > 0) {
    avisos.push(`O backup é de uma versão mais nova (${origem.app_versao}). Campos desconhecidos serão mantidos, mas podem não aparecer na tela.`);
  }

  // Integridade: o arquivo informa quantos registros deveria ter
  if (b.contagens) {
    for (const k of ['leads', 'atividades', 'reunioes', 'vendas'] as const) {
      const esperado = b.contagens[k];
      const real = Array.isArray(b[k]) ? b[k].length : 0;
      if (esperado != null && esperado !== real) avisos.push(`Arquivo possivelmente incompleto: ${k} esperado ${esperado}, encontrado ${real}.`);
    }
  }

  let atual: Bruto = { ...b, versao: formato };
  for (let v = formato; v < FORMATO_BACKUP; v++) {
    const passo = MIGRACOES[v];
    if (!passo) return { ok: false, erro: `Falta a migração do formato ${v} para ${v + 1}.` };
    atual = passo(atual);
  }

  const n = normalizarConteudo(atual, avisos);
  return { ok: true, backup: n, origem, avisos };
}

/** Garante que todo registro tenha os campos e valores esperados pela versão atual. */
function normalizarConteudo(b: Bruto, avisos: string[]): Backup {
  const config = normalizarConfig((b.configuracoes ?? []).find((c: Bruto) => c?.chave === 'app'));
  const leads: Lead[] = [];
  const ids = new Set<number>();
  let leadsInvalidos = 0;
  for (const l of b.leads as Bruto[]) {
    if (!l || typeof l !== 'object' || typeof l.id !== 'number') { leadsInvalidos++; continue; }
    leads.push(normalizarLead(l, config.limite_fit_forte));
    ids.add(l.id);
  }
  if (leadsInvalidos) avisos.push(`${leadsInvalidos} lead(s) sem identificador foram ignorados.`);

  const filtrar = <T extends { lead_id: number }>(arr: Bruto[] | undefined, nome: string, fn: (x: Bruto) => T): T[] => {
    const out: T[] = [];
    let orfaos = 0;
    for (const x of arr ?? []) {
      if (!x || !ids.has(x.lead_id)) { orfaos++; continue; }
      out.push(fn(x));
    }
    if (orfaos) avisos.push(`${orfaos} ${nome} sem lead correspondente foram ignorados.`);
    return out;
  };

  const atividades = filtrar<Atividade>(b.atividades, 'atividade(s)', (a) => ({
    ...a,
    tipo: a.tipo in TIPO_LABEL ? a.tipo : 'outro',
    resultado: a.resultado in RESULTADO_LABEL ? a.resultado : 'sem_resposta',
    comentario: a.comentario ?? '',
  }));
  const reunioes = filtrar<Reuniao>(b.reunioes, 'reunião(ões)', (r) => ({
    ...r,
    status: r.status in STATUS_REUNIAO_LABEL ? r.status : 'marcada',
    observacoes: r.observacoes ?? '',
    criado_em: r.criado_em ?? r.data_hora,
  }));
  const vendas = filtrar<Venda>(b.vendas, 'venda(s)', (v) => ({ ...v, valor: v.valor ?? null, observacoes: v.observacoes ?? '' }));

  return {
    app: 'crm-prospeccao',
    versao: FORMATO_BACKUP,
    app_versao: b.app_versao,
    exportado_em: b.exportado_em,
    contagens: { leads: leads.length, atividades: atividades.length, reunioes: reunioes.length, vendas: vendas.length },
    leads, atividades, reunioes, vendas,
    configuracoes: [config],
    preferencias: b.preferencias ?? {},
  };
}

const ENUMS_LEAD: Record<string, readonly string[]> = {
  ...Object.fromEntries(Object.entries(OPCOES_DIAGNOSTICO).map(([k, v]) => [k, v.map((x) => x[0])])),
  temperatura: Object.keys(TEMP_LABEL),
  etapa_pipeline: ETAPAS.map((e) => e.id),
  fit: ['forte', 'incerto'],
  cadencia_status: ['ativa', 'pausada', 'concluida'],
};

/** Preenche campos ausentes com os padrões atuais, corrige valores inválidos e recalcula derivados. */
export function normalizarLead(l: Bruto, limiteFit: number): Lead {
  const base = leadVazio();
  const out: Bruto = { ...base, ...l };
  for (const [campo, validos] of Object.entries(ENUMS_LEAD)) {
    if (!validos.includes(out[campo])) out[campo] = (base as Bruto)[campo];
  }
  for (const campo of ['tentativas', 'cadencia_dia', 'cadencia_tentativa'] as const) {
    out[campo] = Number(out[campo]) || 0;
  }
  out.fit_manual = !!out.fit_manual;
  return derivarLead(out as Lead, limiteFit);
}

export function normalizarConfig(c: Bruto): Config {
  const cfg: Config = {
    ...CONFIG_PADRAO,
    ...(c ?? {}),
    chave: 'app',
    metas: { ...CONFIG_PADRAO.metas, ...(c?.metas ?? {}) },
  };
  const etapasValidas = new Set(ETAPAS.map((e) => e.id));
  cfg.etapas_visiveis = (Array.isArray(cfg.etapas_visiveis) ? cfg.etapas_visiveis : CONFIG_PADRAO.etapas_visiveis)
    .filter((e) => etapasValidas.has(e));
  if (!Array.isArray(cfg.cadencia) || !cfg.cadencia.length) cfg.cadencia = CONFIG_PADRAO.cadencia;
  if (!Array.isArray(cfg.motivos_perda) || !cfg.motivos_perda.length) cfg.motivos_perda = CONFIG_PADRAO.motivos_perda;
  if (!(Number(cfg.limite_fit_forte) > 0)) cfg.limite_fit_forte = CONFIG_PADRAO.limite_fit_forte;
  return cfg;
}
