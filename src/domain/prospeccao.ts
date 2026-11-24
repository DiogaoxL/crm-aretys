// Criação de lista: converte as linhas geradas da base da Receita (colunas de COLUNAS_CSV e
// COLUNAS_GOOGLE em src/server/prospeccao) em leads do CRM. Regras puras, sem rede nem banco.
import { numeroBR } from './csv';
import type { Lead } from './types';

export type LinhaLista = Record<string, string>;

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI',
  'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

export const PORTES: [string, string][] = [['01', 'ME'], ['03', 'EPP'], ['05', 'Demais']];

export const STATUS_GOOGLE_LABEL: Record<string, string> = {
  confirmado: 'Confirmado', provavel: 'Provável', nao_encontrado: 'Não encontrado',
  fechado: 'Fechado', nao_verificado: 'Não verificado',
};

const googleOk = (l: LinhaLista) => l.google_status === 'confirmado' || l.google_status === 'provavel';

/** Linha da lista → dados de lead do CRM (para repo.importarLeads). */
export function linhaParaLeadCrm(l: LinhaLista, segmento: string, nomeLista: string): Partial<Lead> {
  // Telefone da Receita; se ele for de contabilidade e o Google achou outro, usa o do Google.
  const telefone = l.telefone_contabilidade === 'sim' && googleOk(l) && l.google_telefone
    ? l.google_telefone
    : l.telefone_principal;
  return {
    nome_empresa: (l.nome_fantasia || l.razao_social || '').trim(),
    telefone,
    site: googleOk(l) ? l.google_site ?? '' : '',
    cnpj: l.cnpj,
    capital_social: numeroBR(l.capital_social ?? ''),
    segmento,
    cidade: l.municipio,
    decisor_nome: l.decisor ?? '',
    origem: `receita:${nomeLista}`,
    dados_receita: l,
  };
}

/** Rótulos dos dados da Receita exibidos na ficha do lead. */
export const CAMPOS_RECEITA: [string, string][] = [
  ['razao_social', 'Razão social'], ['score', 'Score da lista'], ['motivos', 'Por que entrou'],
  ['tipo_telefone', 'Tipo de telefone'], ['telefone_contabilidade', 'Telefone de contabilidade'],
  ['outros_telefones', 'Outros telefones'], ['email', 'E-mail'], ['email_tipo', 'Tipo de e-mail'],
  ['cnae_descricao', 'Atividade (CNAE)'], ['endereco', 'Endereço'], ['numero', 'Número'], ['bairro', 'Bairro'],
  ['cep', 'CEP'], ['uf', 'UF'], ['data_inicio_atividade', 'Início da atividade'], ['porte_empresa', 'Porte'],
  ['simples', 'Simples'], ['matriz', 'Matriz'], ['qtd_socios', 'Sócios'],
  ['google_status', 'Google'], ['google_nome', 'Nome no Google'], ['google_categoria', 'Categoria no Google'],
  ['google_nota', 'Nota no Google'], ['google_avaliacoes', 'Avaliações'], ['google_maps', 'Google Maps'],
];
