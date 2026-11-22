import Papa from 'papaparse';
import { OPCOES_DIAGNOSTICO, ETAPA_LABEL, TIPO_LABEL, RESULTADO_LABEL } from './constants';
import { formatarTelefone, isoParaInputLocal } from './format';
import type { Atividade, Lead } from './types';

export interface CampoImportacao {
  campo: keyof Lead;
  label: string;
  obrigatorio?: boolean;
  sinonimos: string[];
}

export const CAMPOS_IMPORTACAO: CampoImportacao[] = [
  { campo: 'nome_empresa', label: 'Nome da empresa', obrigatorio: true, sinonimos: ['nome_empresa', 'empresa', 'nome', 'razao_social', 'nome_fantasia', 'company'] },
  { campo: 'telefone', label: 'Telefone', obrigatorio: true, sinonimos: ['telefone', 'fone', 'tel', 'celular', 'whatsapp', 'phone'] },
  { campo: 'site', label: 'Site', obrigatorio: true, sinonimos: ['site', 'website', 'url', 'dominio', 'web'] },
  { campo: 'cnpj', label: 'CNPJ', sinonimos: ['cnpj'] },
  { campo: 'capital_social', label: 'Capital social', sinonimos: ['capital_social', 'capital'] },
  { campo: 'segmento', label: 'Segmento', sinonimos: ['segmento', 'setor', 'nicho', 'ramo', 'categoria'] },
  { campo: 'cidade', label: 'Cidade', sinonimos: ['cidade', 'municipio', 'city'] },
  { campo: 'decisor_nome', label: 'Decisor: nome', sinonimos: ['decisor_nome', 'decisor', 'contato', 'responsavel'] },
  { campo: 'decisor_cargo', label: 'Decisor: cargo', sinonimos: ['decisor_cargo', 'cargo'] },
  { campo: 'decisor_email', label: 'Decisor: e-mail', sinonimos: ['decisor_email', 'email', 'e_mail'] },
  { campo: 'decisor_telefone', label: 'Decisor: telefone', sinonimos: ['decisor_telefone', 'telefone_decisor'] },
  { campo: 'google_ads', label: 'Google Ads', sinonimos: ['google_ads', 'googleads'] },
  { campo: 'meta_ads', label: 'Meta Ads', sinonimos: ['meta_ads', 'metaads', 'facebook_ads'] },
  { campo: 'site_qualidade', label: 'Qualidade do site', sinonimos: ['site_qualidade', 'qualidade_site'] },
  { campo: 'social', label: 'Redes sociais', sinonimos: ['social', 'redes_sociais', 'instagram'] },
  { campo: 'gmn_cadastro', label: 'Google Meu Negócio', sinonimos: ['gmn_cadastro', 'gmn', 'google_meu_negocio'] },
  { campo: 'aparece_busca_local', label: 'Aparece na busca local', sinonimos: ['aparece_busca_local', 'busca_local'] },
  { campo: 'observacoes_diagnostico', label: 'Observações do diagnóstico', sinonimos: ['observacoes_diagnostico', 'observacoes', 'obs'] },
  { campo: 'temperatura', label: 'Temperatura', sinonimos: ['temperatura'] },
  { campo: 'origem', label: 'Origem', sinonimos: ['origem', 'fonte', 'source'] },
];

export function chave(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Sugere a coluna do CSV para cada campo, pelo nome do cabeçalho. */
export function sugerirMapeamento(cabecalhos: string[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  const usados = new Set<string>();
  for (const c of CAMPOS_IMPORTACAO) {
    const achado = cabecalhos.find((h) => !usados.has(h) && c.sinonimos.includes(chave(h)));
    if (achado) { mapa[c.campo] = achado; usados.add(achado); }
  }
  return mapa;
}

function valorEnum(campo: keyof typeof OPCOES_DIAGNOSTICO, bruto: string): string | undefined {
  const k = chave(bruto);
  if (!k) return undefined;
  for (const [id, label] of OPCOES_DIAGNOSTICO[campo]) {
    if (k === id || k === chave(label)) return id;
  }
  return undefined;
}

export function numeroBR(bruto: string): number | null {
  let s = String(bruto ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/** Converte uma linha do CSV em dados de lead usando o mapeamento campo -> coluna. */
export function linhaParaLead(linha: Record<string, string>, mapa: Record<string, string>): Partial<Lead> {
  const out: Record<string, unknown> = {};
  for (const c of CAMPOS_IMPORTACAO) {
    const col = mapa[c.campo];
    if (!col) continue;
    const v = String(linha[col] ?? '').trim();
    if (!v) continue;
    if (c.campo === 'capital_social') out.capital_social = numeroBR(v);
    else if (c.campo in OPCOES_DIAGNOSTICO) {
      const e = valorEnum(c.campo as keyof typeof OPCOES_DIAGNOSTICO, v);
      if (e) out[c.campo] = e;
    } else if (c.campo === 'temperatura') {
      const t = chave(v);
      if (['frio', 'morno', 'quente'].includes(t)) out.temperatura = t;
    } else out[c.campo] = v;
  }
  return out as Partial<Lead>;
}

export function lerCsv(arquivo: File): Promise<{ cabecalhos: string[]; linhas: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(arquivo, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (r) => resolve({ cabecalhos: r.meta.fields ?? [], linhas: r.data }),
      error: reject,
    });
  });
}

export function gerarCsv(linhas: Record<string, unknown>[], colunas?: string[]): string {
  // BOM para o Excel abrir acentos corretamente
  return '﻿' + Papa.unparse(linhas, { columns: colunas, delimiter: ';' });
}

export function baixarArquivo(nome: string, conteudo: string, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvModelo(): string {
  const colunas = CAMPOS_IMPORTACAO.map((c) => c.campo as string);
  const exemplo: Record<string, string> = {
    nome_empresa: 'Clínica Sorriso Exemplo', telefone: '(11) 98765-4321', site: 'clinicasorrisoexemplo.com.br',
    cnpj: '12.345.678/0001-90', capital_social: '150000', segmento: 'Odontologia', cidade: 'São Paulo',
    decisor_nome: 'Ana Souza', decisor_cargo: 'Sócia', decisor_email: 'ana@exemplo.com.br', decisor_telefone: '',
    google_ads: 'nao_anuncia', meta_ads: 'fraco', site_qualidade: 'ruim_ou_institucional', social: 'abandonado',
    gmn_cadastro: 'incompleto', aparece_busca_local: 'nao', observacoes_diagnostico: 'Instagram sem posts desde março',
    temperatura: 'frio', origem: 'lista_google_maps',
  };
  return gerarCsv([exemplo], colunas);
}

export function csvLeads(leads: Lead[]): string {
  return gerarCsv(leads.map((l) => ({
    id: l.id, nome_empresa: l.nome_empresa, telefone: formatarTelefone(l.telefone), site: l.site, cnpj: l.cnpj,
    capital_social: l.capital_social ?? '', segmento: l.segmento, cidade: l.cidade, fit: l.fit,
    decisor_nome: l.decisor_nome, decisor_cargo: l.decisor_cargo, decisor_email: l.decisor_email,
    decisor_telefone: l.decisor_telefone, google_ads: l.google_ads, meta_ads: l.meta_ads,
    site_qualidade: l.site_qualidade, social: l.social, gmn_cadastro: l.gmn_cadastro,
    aparece_busca_local: l.aparece_busca_local, observacoes_diagnostico: l.observacoes_diagnostico,
    score: l.score, maior_lacuna: l.maior_lacuna ?? '', temperatura: l.temperatura,
    etapa: ETAPA_LABEL[l.etapa_pipeline] ?? l.etapa_pipeline, proxima_acao: l.proxima_acao,
    proxima_acao_data: isoParaInputLocal(l.proxima_acao_data).replace('T', ' '),
    ultimo_contato: isoParaInputLocal(l.ultimo_contato_data).replace('T', ' '), tentativas: l.tentativas,
    motivo_perda: l.motivo_perda ?? '', motivo_perda_texto: l.motivo_perda_texto ?? '', origem: l.origem,
    criado_em: isoParaInputLocal(l.criado_em).replace('T', ' '),
  })));
}

export function csvAtividades(atividades: Atividade[], leads: Lead[]): string {
  const nomes = new Map(leads.map((l) => [l.id, l.nome_empresa]));
  return gerarCsv(atividades.map((a) => ({
    id: a.id, lead_id: a.lead_id, empresa: nomes.get(a.lead_id) ?? '', tipo: TIPO_LABEL[a.tipo],
    data_hora: isoParaInputLocal(a.data_hora).replace('T', ' '), resultado: RESULTADO_LABEL[a.resultado], comentario: a.comentario,
  })));
}
