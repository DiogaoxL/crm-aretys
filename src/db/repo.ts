/**
 * Repositório: única camada que conhece o banco. As telas só usam estas funções
 * (e os hooks em ./hooks.ts). Para trocar o IndexedDB por SQLite ou outro banco,
 * reimplemente este módulo mantendo as mesmas assinaturas.
 */
import { db } from './schema';
import { CONFIG_PADRAO, RESULTADOS_CONTATO } from '../domain/constants';
import { agoraIso, diaSP, diasEntre, dominioDoSite, normalizarTelefone } from '../domain/format';
import { derivarLead, leadVazio } from '../domain/lead';
import { APP_VERSAO, FORMATO_BACKUP, compararVersao } from '../domain/versao';
import { normalizarConfig, normalizarLead } from './migracoes';
import type {
  Atividade, Backup, Config, Etapa, Lead, ResultadoAtividade, Reuniao, Temperatura, TipoAtividade, Venda,
} from '../domain/types';

// ---------------- Configurações ----------------

export async function getConfig(): Promise<Config> {
  const c = await db.configuracoes.get('app');
  return { ...CONFIG_PADRAO, ...(c ?? {}), metas: { ...CONFIG_PADRAO.metas, ...(c?.metas ?? {}) } };
}

export async function salvarConfig(patch: Partial<Config>): Promise<void> {
  const atual = await getConfig();
  const nova = { ...atual, ...patch, chave: 'app' as const };
  await db.configuracoes.put(nova);
  if (patch.limite_fit_forte != null && patch.limite_fit_forte !== atual.limite_fit_forte) {
    // Recalcula fit automático de todos os leads
    await db.transaction('rw', db.leads, async () => {
      const leads = await db.leads.toArray();
      for (const l of leads) {
        if (!l.fit_manual) await db.leads.update(l.id!, { fit: derivarLead(l, nova.limite_fit_forte).fit });
      }
    });
  }
}

// ---------------- Leads ----------------

export function listarLeads(): Promise<Lead[]> {
  return db.leads.toArray();
}

export function getLead(id: number): Promise<Lead | undefined> {
  return db.leads.get(id);
}

/** Procura lead existente com o mesmo telefone normalizado ou domínio do site. */
export async function buscarDuplicado(telefone: string, site: string, ignorarId?: number): Promise<Lead | undefined> {
  const tel = normalizarTelefone(telefone);
  const dom = dominioDoSite(site);
  const porTel = tel ? await db.leads.where('telefone').equals(tel).toArray() : [];
  const porDom = dom ? await db.leads.where('dominio').equals(dom).toArray() : [];
  return [...porTel, ...porDom].find((l) => l.id !== ignorarId);
}

export async function criarLead(dados: Partial<Lead>): Promise<number> {
  const config = await getConfig();
  const agora = agoraIso();
  const lead = derivarLead({ ...leadVazio(), ...dados, criado_em: agora, atualizado_em: agora }, config.limite_fit_forte);
  delete lead.id;
  return db.leads.add(lead);
}

export async function atualizarLead(id: number, patch: Partial<Lead>): Promise<Lead> {
  const config = await getConfig();
  const atual = await db.leads.get(id);
  if (!atual) throw new Error('Lead não encontrado');
  const novo = derivarLead({ ...atual, ...patch, id, atualizado_em: agoraIso() }, config.limite_fit_forte);
  await db.leads.put(novo);
  return novo;
}

export async function moverEtapa(id: number, etapa: Etapa, motivo?: string, motivoTexto?: string): Promise<void> {
  if (etapa === 'perdido' && !motivo) throw new Error('Motivo de perda obrigatório');
  const patch: Partial<Lead> = { etapa_pipeline: etapa, atualizado_em: agoraIso() };
  if (etapa === 'perdido') {
    patch.motivo_perda = motivo;
    patch.motivo_perda_texto = motivoTexto ?? '';
    patch.perdido_em = agoraIso();
  }
  await db.leads.update(id, patch);
}

export async function atualizarEmMassa(
  ids: number[],
  patch: { etapa_pipeline?: Etapa; temperatura?: Temperatura; motivo_perda?: string; motivo_perda_texto?: string },
): Promise<void> {
  if (patch.etapa_pipeline === 'perdido' && !patch.motivo_perda) throw new Error('Motivo de perda obrigatório');
  const agora = agoraIso();
  const extra = patch.etapa_pipeline === 'perdido' ? { perdido_em: agora } : {};
  await db.leads.where('id').anyOf(ids).modify({ ...patch, ...extra, atualizado_em: agora });
}

export async function excluirLeads(ids: number[]): Promise<void> {
  await db.transaction('rw', [db.leads, db.atividades, db.reunioes, db.vendas], async () => {
    await db.atividades.where('lead_id').anyOf(ids).delete();
    await db.reunioes.where('lead_id').anyOf(ids).delete();
    await db.vendas.where('lead_id').anyOf(ids).delete();
    await db.leads.bulkDelete(ids);
  });
}

export async function reiniciarCadencia(id: number): Promise<void> {
  await db.leads.update(id, {
    cadencia_status: 'ativa', cadencia_tentativa: 0, cadencia_dia: 0, cadencia_inicio: null, atualizado_em: agoraIso(),
  });
}

export async function pausarCadencia(id: number, pausar: boolean): Promise<void> {
  await db.leads.update(id, { cadencia_status: pausar ? 'pausada' : 'ativa', atualizado_em: agoraIso() });
}

// ---------------- Atividades ----------------

export function atividadesDoLead(leadId: number): Promise<Atividade[]> {
  return db.atividades.where('lead_id').equals(leadId).reverse().sortBy('data_hora');
}

export function listarAtividades(): Promise<Atividade[]> {
  return db.atividades.toArray();
}

export interface RegistroAtividade {
  lead_id: number;
  tipo: TipoAtividade;
  resultado: ResultadoAtividade;
  comentario?: string;
  data_hora?: string;
  proxima_acao?: string;
  proxima_acao_data?: string | null;
  nova_etapa?: Etapa | null;
  motivo_perda?: string;
  motivo_perda_texto?: string;
  temperatura?: Temperatura;
  reuniao_data_hora?: string | null; // cria Reunião quando resultado = reuniao_marcada
}

/** Registra a atividade e atualiza o lead (último contato, tentativas, cadência, etapa) numa transação. */
export async function registrarAtividade(r: RegistroAtividade): Promise<Lead> {
  return db.transaction('rw', [db.leads, db.atividades, db.reunioes], async () => {
    const lead = await db.leads.get(r.lead_id);
    if (!lead) throw new Error('Lead não encontrado');
    const data_hora = r.data_hora ?? agoraIso();
    await db.atividades.add({
      lead_id: r.lead_id, tipo: r.tipo, resultado: r.resultado, comentario: r.comentario ?? '', data_hora,
    });

    const patch: Partial<Lead> = { atualizado_em: agoraIso() };
    if (!lead.ultimo_contato_data || data_hora > lead.ultimo_contato_data) patch.ultimo_contato_data = data_hora;
    if (r.tipo === 'ligacao') patch.tentativas = (lead.tentativas ?? 0) + 1;

    // Cadência
    if (lead.cadencia_status === 'ativa') {
      const inicio = lead.cadencia_inicio ?? data_hora;
      patch.cadencia_inicio = inicio;
      patch.cadencia_dia = diasEntre(diaSP(inicio), diaSP(data_hora)) + 1;
      if (RESULTADOS_CONTATO.includes(r.resultado)) patch.cadencia_status = 'concluida';
      else patch.cadencia_tentativa = (lead.cadencia_tentativa ?? 0) + 1;
    }

    if (r.proxima_acao !== undefined) patch.proxima_acao = r.proxima_acao;
    if (r.proxima_acao_data !== undefined) patch.proxima_acao_data = r.proxima_acao_data;
    if (r.temperatura) patch.temperatura = r.temperatura;
    if (r.nova_etapa) {
      if (r.nova_etapa === 'perdido' && !r.motivo_perda) throw new Error('Motivo de perda obrigatório');
      patch.etapa_pipeline = r.nova_etapa;
      if (r.nova_etapa === 'perdido') {
        patch.motivo_perda = r.motivo_perda;
        patch.motivo_perda_texto = r.motivo_perda_texto ?? '';
        patch.perdido_em = data_hora;
      }
    }
    if (r.resultado === 'reuniao_marcada' && r.reuniao_data_hora) {
      await db.reunioes.add({
        lead_id: r.lead_id, data_hora: r.reuniao_data_hora, status: 'marcada', observacoes: r.comentario ?? '', criado_em: data_hora,
      });
    }
    await db.leads.update(r.lead_id, patch);
    return { ...lead, ...patch };
  });
}

export async function excluirAtividade(id: number): Promise<void> {
  await db.atividades.delete(id);
}

// ---------------- Reuniões ----------------

export function reunioesDoLead(leadId: number): Promise<Reuniao[]> {
  return db.reunioes.where('lead_id').equals(leadId).reverse().sortBy('data_hora');
}
export function listarReunioes(): Promise<Reuniao[]> {
  return db.reunioes.toArray();
}
export async function criarReuniao(r: Omit<Reuniao, 'id' | 'criado_em'>): Promise<number> {
  return db.reunioes.add({ ...r, criado_em: agoraIso() });
}
export async function atualizarReuniao(id: number, patch: Partial<Reuniao>): Promise<void> {
  await db.reunioes.update(id, patch);
}
export async function excluirReuniao(id: number): Promise<void> {
  await db.reunioes.delete(id);
}

// ---------------- Vendas ----------------

export function vendasDoLead(leadId: number): Promise<Venda[]> {
  return db.vendas.where('lead_id').equals(leadId).toArray();
}
export function listarVendas(): Promise<Venda[]> {
  return db.vendas.toArray();
}
export async function registrarVenda(v: Omit<Venda, 'id'>): Promise<void> {
  await db.transaction('rw', [db.vendas, db.leads], async () => {
    await db.vendas.add(v);
    await db.leads.update(v.lead_id, { etapa_pipeline: 'venda_ganha', temperatura: 'quente', atualizado_em: agoraIso() });
  });
}
export async function excluirVenda(id: number): Promise<void> {
  await db.vendas.delete(id);
}

// ---------------- Importação de leads (CSV) ----------------

export interface RelatorioImportacao {
  importados: number;
  ignorados: { linha: number; motivo: string }[];
  duplicados: { linha: number; empresa: string; motivo: string }[];
}

/** CNPJ só com letras e números (desde jul/2026 o CNPJ pode ser alfanumérico). */
const chaveCnpj = (c?: string) => String(c ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * @param opcoes.exigirSite false para listas da base da Receita, que não informam site.
 */
export async function importarLeads(
  linhas: Partial<Lead>[], origem = 'csv', opcoes: { exigirSite?: boolean } = {},
): Promise<RelatorioImportacao> {
  const exigirSite = opcoes.exigirSite ?? true;
  const config = await getConfig();
  const existentes = await db.leads.toArray();
  const tels = new Set(existentes.map((l) => l.telefone).filter(Boolean));
  const doms = new Set(existentes.map((l) => l.dominio).filter(Boolean));
  const cnpjs = new Set(existentes.map((l) => chaveCnpj(l.cnpj)).filter(Boolean));
  const rel: RelatorioImportacao = { importados: 0, ignorados: [], duplicados: [] };
  const novos: Lead[] = [];
  const agora = agoraIso();

  linhas.forEach((l, i) => {
    const linha = i + 2; // +1 cabeçalho, +1 base 1
    const faltando = [
      !l.nome_empresa?.trim() && 'nome da empresa',
      !normalizarTelefone(l.telefone) && 'telefone',
      exigirSite && !l.site?.trim() && 'site',
    ].filter(Boolean);
    if (faltando.length) {
      rel.ignorados.push({ linha, motivo: `Falta: ${faltando.join(', ')}` });
      return;
    }
    const lead = derivarLead(
      { ...leadVazio(), ...l, origem: l.origem || origem, criado_em: agora, atualizado_em: agora },
      config.limite_fit_forte,
    );
    delete lead.id;
    const cnpj = chaveCnpj(lead.cnpj);
    if (tels.has(lead.telefone) || doms.has(lead.dominio) || (cnpj && cnpjs.has(cnpj))) {
      rel.duplicados.push({
        linha, empresa: lead.nome_empresa,
        motivo: tels.has(lead.telefone) ? 'Telefone já cadastrado'
          : doms.has(lead.dominio) ? 'Domínio do site já cadastrado' : 'CNPJ já cadastrado',
      });
      return;
    }
    tels.add(lead.telefone);
    if (lead.dominio) doms.add(lead.dominio);
    if (cnpj) cnpjs.add(cnpj);
    novos.push(lead);
  });

  await db.leads.bulkAdd(novos);
  rel.importados = novos.length;
  return rel;
}

// ---------------- Backup e migração entre versões ----------------

function lerPreferencias(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('crm-')) out[k] = localStorage.getItem(k) ?? '';
    }
  } catch { /* navegador sem localStorage */ }
  return out;
}

function gravarPreferencias(p: Record<string, string> | undefined) {
  try {
    for (const [k, v] of Object.entries(p ?? {})) if (k.startsWith('crm-')) localStorage.setItem(k, v);
  } catch { /* ignore */ }
}

/** Estado completo da plataforma, no formato atual. */
export async function exportarBackup(): Promise<Backup> {
  const [leads, atividades, reunioes, vendas, configuracoes] = await Promise.all([
    db.leads.toArray(), db.atividades.toArray(), db.reunioes.toArray(), db.vendas.toArray(), db.configuracoes.toArray(),
  ]);
  return {
    app: 'crm-prospeccao',
    versao: FORMATO_BACKUP,
    app_versao: APP_VERSAO,
    exportado_em: agoraIso(),
    contagens: { leads: leads.length, atividades: atividades.length, reunioes: reunioes.length, vendas: vendas.length },
    leads, atividades, reunioes, vendas, configuracoes,
    preferencias: lerPreferencias(),
  };
}

export async function marcarBackupFeito(): Promise<void> {
  await salvarConfig({ ultimo_backup: agoraIso() });
}

/** Valida e converte um JSON de qualquer versão anterior para o formato atual. */
export { prepararBackup } from './migracoes';

export async function contagemAtual() {
  const [leads, atividades, reunioes, vendas] = await Promise.all([
    db.leads.count(), db.atividades.count(), db.reunioes.count(), db.vendas.count(),
  ]);
  return { leads, atividades, reunioes, vendas };
}

/**
 * Restaura um backup já preparado por `prepararBackup`.
 * - substituir: apaga tudo e grava o conteúdo do arquivo (inclusive configurações e preferências).
 *   É o modo indicado para levar os dados de uma versão anterior para a nova.
 * - mesclar: adiciona leads que não existem (por telefone/domínio) com seus históricos; mantém as configurações atuais.
 */
export async function importarBackup(b: Backup, modo: 'substituir' | 'mesclar'): Promise<{ leads: number; ignorados: number }> {
  const r = await db.transaction('rw', [db.leads, db.atividades, db.reunioes, db.vendas, db.configuracoes], async () => {
    if (modo === 'substituir') {
      const ultimoBackup = (await db.configuracoes.get('app'))?.ultimo_backup;
      await Promise.all([db.leads.clear(), db.atividades.clear(), db.reunioes.clear(), db.vendas.clear(), db.configuracoes.clear()]);
      await db.leads.bulkAdd(b.leads);
      await db.atividades.bulkAdd(b.atividades);
      await db.reunioes.bulkAdd(b.reunioes);
      await db.vendas.bulkAdd(b.vendas);
      const cfg = b.configuracoes[0] ?? normalizarConfig(null);
      await db.configuracoes.put({
        ...cfg, chave: 'app', dados_app_versao: APP_VERSAO,
        ultimo_backup: [cfg.ultimo_backup, ultimoBackup, b.exportado_em].filter(Boolean).sort().at(-1) ?? null,
      });
      return { leads: b.leads.length, ignorados: 0 };
    }
    const existentes = await db.leads.toArray();
    const tels = new Set(existentes.map((l) => l.telefone));
    const doms = new Set(existentes.map((l) => l.dominio).filter(Boolean));
    const mapa = new Map<number, number>();
    let ignorados = 0;
    for (const l of b.leads) {
      if (tels.has(l.telefone) || (l.dominio && doms.has(l.dominio))) { ignorados++; continue; }
      const { id: antigo, ...resto } = l;
      const novo = await db.leads.add(resto as Lead);
      if (antigo != null) mapa.set(antigo, novo);
    }
    const remap = <T extends { id?: number; lead_id: number }>(arr: T[]) =>
      arr.filter((x) => mapa.has(x.lead_id)).map(({ id: _id, ...x }) => ({ ...x, lead_id: mapa.get(x.lead_id)! }) as T);
    await db.atividades.bulkAdd(remap(b.atividades));
    await db.reunioes.bulkAdd(remap(b.reunioes));
    await db.vendas.bulkAdd(remap(b.vendas));
    return { leads: mapa.size, ignorados };
  });
  if (modo === 'substituir') gravarPreferencias(b.preferencias);
  return r;
}

/**
 * Atualização "no lugar": quando uma versão nova abre um banco gravado por uma versão anterior
 * (mesmo navegador e porta), preenche campos novos e recalcula os derivados de todos os registros.
 * Retorna a versão anterior quando houve atualização.
 */
export async function normalizarBancoLocal(): Promise<{ de: string | null; para: string } | null> {
  const cfgBruta = await db.configuracoes.get('app');
  const nLeads = await db.leads.count();
  if (cfgBruta?.dados_app_versao === APP_VERSAO) return null;
  const de = cfgBruta?.dados_app_versao ?? (nLeads || cfgBruta ? '0.1.0' : null);
  await db.transaction('rw', [db.leads, db.configuracoes], async () => {
    const cfg = normalizarConfig(cfgBruta);
    const leads = await db.leads.toArray();
    await db.leads.bulkPut(leads.map((l) => normalizarLead(l, cfg.limite_fit_forte)));
    await db.configuracoes.put({ ...cfg, dados_app_versao: APP_VERSAO });
  });
  return de && compararVersao(de, APP_VERSAO) < 0 ? { de, para: APP_VERSAO } : null;
}

export async function apagarTudo(): Promise<void> {
  await db.transaction('rw', [db.leads, db.atividades, db.reunioes, db.vendas, db.configuracoes], async () => {
    await Promise.all([db.leads.clear(), db.atividades.clear(), db.reunioes.clear(), db.vendas.clear(), db.configuracoes.clear()]);
    await db.configuracoes.put({ ...normalizarConfig(null), dados_app_versao: APP_VERSAO });
  });
}

/** Grava um conjunto de dados de exemplo (leads com índices relativos nas relações). */
export async function gravarExemplo(dados: {
  leads: Partial<Lead>[];
  atividades: (Omit<Atividade, 'lead_id'> & { lead: number })[];
  reunioes: (Omit<Reuniao, 'lead_id'> & { lead: number })[];
  vendas: (Omit<Venda, 'lead_id'> & { lead: number })[];
}): Promise<{ importados: number; ignorados: number }> {
  const config = await getConfig();
  return db.transaction('rw', [db.leads, db.atividades, db.reunioes, db.vendas], async () => {
    const ids: (number | null)[] = [];
    let ignorados = 0;
    for (const l of dados.leads) {
      const lead = derivarLead({ ...leadVazio(), ...l } as Lead, config.limite_fit_forte);
      delete lead.id;
      const dup = await db.leads.where('telefone').equals(lead.telefone).first();
      if (dup) { ids.push(null); ignorados++; continue; }
      ids.push(await db.leads.add(lead));
    }
    const ok = <T extends { lead: number }>(x: T) => ids[x.lead] != null;
    await db.atividades.bulkAdd(dados.atividades.filter(ok).map(({ lead, ...a }) => ({ ...a, lead_id: ids[lead]! })));
    await db.reunioes.bulkAdd(dados.reunioes.filter(ok).map(({ lead, ...a }) => ({ ...a, lead_id: ids[lead]! })));
    await db.vendas.bulkAdd(dados.vendas.filter(ok).map(({ lead, ...a }) => ({ ...a, lead_id: ids[lead]! })));
    return { importados: ids.filter((x) => x != null).length, ignorados };
  });
}
