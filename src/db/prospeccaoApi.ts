/**
 * Cliente da API local de criação de lista (src/server/prospeccao/vite-plugin.ts).
 * Fala só com o próprio servidor do app (mesma origem, localhost:5173).
 */
import type { LinhaLista } from '../domain/prospeccao';

const BASE = '/api/prospeccao/';

/** Item do catálogo: um CNAE da base (tipo "cnae", com a contagem de empresas) ou um nicho (CNAE + filtro por nome). */
export interface Segmento {
  slug: string;
  nome: string;
  tipo: 'cnae' | 'nicho';
  area: string;
  grupo?: string;
  codigo?: string;
  empresas?: number;
}

export interface StatusBase {
  arquivo: string;
  existe: boolean;
  carregado: boolean;
  /** Há dados, mas a última carga não terminou (interrompida). */
  incompleta?: boolean;
  aberto: boolean;
  estabelecimentos: number;
  google: boolean;
  serper: boolean;
  mes?: string;
  uso: Record<string, { usado: number; limite: number }> | null;
  /** Mês da Receita carregado (AAAA-MM) e UFs carregadas ("todas" ou "PR,SC"). */
  competencia: string | null;
  ufsCarregadas?: string | null;
  atualizacao: Atualizacao | null;
}

export interface Atualizacao {
  rodando: boolean;
  inicio: string;
  fase: 'verificando' | 'baixando' | 'carregando' | 'limpando' | 'concluido' | 'erro';
  mensagem: string;
  competencia?: string;
  arquivo?: string;
  baixados?: number;
  total?: number;
  /** 0–100 dentro da fase atual. */
  percentual?: number;
  /** 1 = download, 2 = carga. */
  etapa?: number;
  inicioFase?: string;
}

export interface OpcoesLista {
  uf: string;
  municipios?: string[];
  limite?: number;
  incluirSecundarios?: boolean;
  soMatriz?: boolean;
  excluirSimples?: boolean;
  portes?: string[];
  idadeMinAnos?: number;
  exigirDecisor?: boolean;
  esconderContabilidade?: boolean;
  reexibirAposDias?: number;
  filtroNome?: 'auto' | 'sim' | 'nao';
}

export interface ListaGerada {
  nome: string;
  segmento: string;
  encontrados: number;
  cnaes: string[];
  stems: string[];
  colunas: string[];
  linhas: LinhaLista[];
}

export class ServidorIndisponivel extends Error {}

async function chamar<T>(rota: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(BASE + rota, corpo === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
  } catch {
    throw new ServidorIndisponivel('Servidor local fora do ar.');
  }
  const tipo = r.headers.get('content-type') ?? '';
  if (!tipo.includes('json')) throw new ServidorIndisponivel('A criação de lista precisa do app aberto por "npm run dev" ou "npm run preview".');
  const dados = await r.json();
  if (!r.ok) throw new Error(dados.erro ?? `Erro ${r.status}`);
  return dados as T;
}

export const status = () => chamar<StatusBase>('status');
export const segmentos = () => chamar<Segmento[]>('segmentos');
export const gerarLista = (slug: string, o: OpcoesLista) => chamar<ListaGerada>('lista', { slug, ...o });
export const registrar = (lista: string, cnpjs: string[]) => chamar<{ ok: true }>('registrar', { lista, cnpjs });
export const liberarBanco = () => chamar<{ ok: true }>('fechar', {});
/** Baixa o mês mais recente da Receita, carrega e apaga os ZIPs (em segundo plano no servidor local). */
export const atualizarBase = (forcar = false) => chamar<Atualizacao>('atualizar', { forcar });
export const progressoAtualizacao = () => chamar<Atualizacao | null>('atualizacao');

/** Verifica as linhas no Google. O servidor responde em NDJSON: progresso e, por último, o resultado. */
export async function verificarNoGoogle(
  linhas: LinhaLista[],
  o: { provedor: 'google' | 'serper'; detalhes: boolean },
  aoProgredir: (i: number, total: number) => void,
): Promise<{ linhas: LinhaLista[]; erroCota: string | null; colunas: string[] }> {
  const r = await fetch(BASE + 'google', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linhas, ...o }),
  });
  if (!r.body) throw new Error('Resposta vazia do servidor.');
  const leitor = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    resto += value;
    const partes = resto.split('\n');
    resto = partes.pop() ?? '';
    for (const p of partes.filter(Boolean)) {
      const m = JSON.parse(p);
      if (m.tipo === 'progresso') aoProgredir(m.i, m.total);
      else if (m.tipo === 'erro') throw new Error(m.erro);
      else if (m.tipo === 'fim') return { linhas: m.linhas, erroCota: m.erroCota, colunas: m.colunas };
    }
  }
  throw new Error('A verificação terminou sem resultado.');
}
