/**
 * Serviço usado pelo CRM (via vite-plugin.ts). Adaptado da seção 3.5 do guia
 * ("sua-aplicacao/src/servicos/prospeccao.ts"):
 *  - o banco abre uma única vez, sob demanda, e pode ser fechado para a carga mensal pela CLI;
 *  - gerar a lista NÃO grava histórico: o histórico é gravado quando os leads entram no CRM
 *    (assim uma prévia não "queima" empresas);
 *  - a chave do Google vem do .env local e nunca vai para o navegador.
 */
import { existsSync } from "node:fs";
import { atualizarReceita, competenciaCarregada, type Progresso } from "./baixar-receita.js";
import { contarEmpresasPorCnae } from "./carregar-receita.js";
import { Banco } from "./db.js";
import { secaoDoCnae } from "./secoes-cnae.js";
import { COLUNAS_CSV, gerarLista, lerSegmentos, linhaCsv, registrarExportacao, type Lead, type OpcoesLista, type Segmento } from "./gerar-lista.js";
import { COLUNAS_GOOGLE, GooglePlaces, Serper, Uso, verificarLista, type LinhaLista, type Sku } from "./verificar-google.js";
import type { StatusGoogle } from "./regras.js";

export interface ConfigServico {
  arquivoDb: string;
  /** Pasta dos dados dentro do projeto (ZIPs temporários e extração). */
  pastaDados: string;
  /** UFs carregadas na atualização automática (vazio = Brasil inteiro). */
  ufs?: string[];
  /** Token do compartilhamento público da Receita (padrão em baixar-receita.ts). */
  tokenReceita?: string;
  arquivoSegmentos?: string;
  googleKey?: string;
  serperKey?: string;
  limites?: Record<Sku, number>;
}

/** Item do seletor de segmentos da tela. */
export interface ItemCatalogo {
  slug: string;
  nome: string;
  tipo: "cnae" | "nicho";
  /** Seção da CNAE ("Q · Saúde humana e serviços sociais") ou AREA_NICHOS. */
  area: string;
  /** Nicho, para os itens de AREA_NICHOS. */
  grupo?: string;
  codigo?: string;
  /** Matrizes ativas sem MEI com esse CNAE principal. */
  empresas?: number;
}
export const AREA_NICHOS = "Nichos (CNAE + filtro por nome)";

/** A última carga terminou? (carregar-receita.ts grava a marca só no fim.) */
async function cargaCompleta(d: Banco): Promise<boolean> {
  await competenciaCarregada(d); // garante a tabela receita_meta
  return Number(await d.valor("SELECT count(*) FROM receita_meta WHERE chave = 'carga_completa'")) > 0;
}

const LIMITES_PADRAO: Record<Sku, number> = { places_pro: 4800, places_enterprise: 950, serper: 800 };

// verificarLista trabalha com linhas de texto (o mesmo formato de um CSV lido)
const paraTexto = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? "" : String(v)])) as Record<string, string>;

export function criarServico(cfg: ConfigServico) {
  let banco: Promise<Banco> | null = null;
  const db = () => (banco ??= Banco.abrir(cfg.arquivoDb));
  const limites = cfg.limites ?? LIMITES_PADRAO;

  // Atualização automática da base (roda em segundo plano; a tela consulta o progresso).
  let atualizacao: (Progresso & { rodando: boolean; inicio: string }) | null = null;

  function atualizar(o: { forcar?: boolean } = {}) {
    if (atualizacao?.rodando) throw new Error("Já existe uma atualização em andamento.");
    atualizacao = { rodando: true, inicio: new Date().toISOString(), fase: "verificando", mensagem: "Iniciando…" };
    (async () => {
      try {
        await atualizarReceita(await db(), {
          pastaDados: cfg.pastaDados, ufs: cfg.ufs, token: cfg.tokenReceita, forcar: o.forcar,
          aoProgredir: (p) => { atualizacao = { ...atualizacao!, ...p, rodando: p.fase !== "concluido" }; },
        });
      } catch (e) {
        console.error("[prospeccao] atualização da base", e);
        atualizacao = { ...atualizacao!, rodando: false, fase: "erro", mensagem: (e as Error).message };
      }
    })();
    return atualizacao;
  }

  /** @param forcar fecha mesmo com atualização em andamento (servidor encerrando/reiniciando). */
  async function fechar(forcar = false) {
    if (atualizacao?.rodando && !forcar) throw new Error("Espere a atualização da base terminar.");
    if (!banco) return;
    const b = banco;
    banco = null;
    (await b).fechar();
  }

  async function status() {
    const base = {
      arquivo: cfg.arquivoDb,
      aberto: banco !== null,
      google: !!cfg.googleKey,
      serper: !!cfg.serperKey,
    };
    // Não abre (nem cria) o arquivo se a carga da Receita ainda não foi feita.
    if (!existsSync(cfg.arquivoDb) && !atualizacao?.rodando) {
      return { ...base, existe: false, carregado: false, estabelecimentos: 0, uso: null, competencia: null, atualizacao };
    }
    const d = await db();
    if (atualizacao?.rodando) {
      // Durante a carga as tabelas da Receita estão sendo recriadas: não consulta.
      return { ...base, aberto: true, existe: true, carregado: false, estabelecimentos: 0, uso: null, competencia: null, atualizacao };
    }
    const temTabela = Number(await d.valor(
      "SELECT count(*) FROM information_schema.tables WHERE table_name = 'estabelecimentos'")) > 0;
    const estabelecimentos = temTabela ? Number(await d.valor("SELECT count(*) FROM estabelecimentos")) : 0;
    const competencia = await competenciaCarregada(d);
    const completa = await cargaCompleta(d);
    const ufsCarregadas = await d.valor<string>("SELECT valor FROM receita_meta WHERE chave = 'ufs'");
    const uso = await Uso.criar(d, limites);
    const consumo = Object.fromEntries(await Promise.all(
      (Object.keys(limites) as Sku[]).map(async (s) => [s, { usado: await uso.usado(s), limite: limites[s] }] as const)));
    return {
      ...base, aberto: true, existe: true, carregado: estabelecimentos > 0 && completa, incompleta: estabelecimentos > 0 && !completa, estabelecimentos, mes: uso.mes, uso: consumo,
      competencia, ufsCarregadas: ufsCarregadas ?? null, atualizacao,
    };
  }

  /**
   * Catálogo de segmentos para a tela:
   *  - um segmento por CNAE da base carregada que tenha empresas (agrupado pela seção da CNAE), com a contagem;
   *  - os nichos de segmentos.json (CNAE + filtro por nome), que separam o que um CNAE sozinho não separa.
   */
  async function segmentos(): Promise<ItemCatalogo[]> {
    const nichos: ItemCatalogo[] = (await lerSegmentos(cfg.arquivoSegmentos)).map((s) => ({
      slug: s.slug, nome: s.nome, tipo: "nicho", area: AREA_NICHOS, grupo: s.nicho ?? "Outros",
    }));
    if (atualizacao?.rodando || !existsSync(cfg.arquivoDb)) return nichos;
    const d = await db();
    if (!(await cargaCompleta(d))) return nichos; // base vazia ou carga interrompida
    const temContagem = Number(await d.valor(
      "SELECT count(*) FROM information_schema.tables WHERE table_name = 'cnae_empresas'")) > 0;
    if (!temContagem) await contarEmpresasPorCnae(d, () => {}); // base carregada antes da 0.7.0
    const linhas = await d.linhas<{ codigo: string; descricao: string; empresas: number }>(
      `SELECT c.codigo, c.descricao, ce.empresas FROM cnaes c JOIN cnae_empresas ce ON ce.codigo = c.codigo
       WHERE ce.empresas > 0 ORDER BY c.descricao`);
    const porCnae: ItemCatalogo[] = linhas.map((c) => {
      const s = secaoDoCnae(c.codigo);
      return {
        slug: `cnae-${c.codigo}`, nome: c.descricao, tipo: "cnae", codigo: c.codigo, empresas: Number(c.empresas),
        area: s ? `${s.letra} · ${s.nome}` : "Outras atividades",
      };
    });
    porCnae.sort((a, b) => a.area.localeCompare(b.area) || a.nome.localeCompare(b.nome));
    return [...porCnae, ...nichos];
  }

  /** "cnae-8630503" → segmento só com aquele CNAE; senão, um nicho de segmentos.json. */
  async function resolverSegmento(slug: string): Promise<Segmento> {
    const codigo = slug.match(/^cnae-(\w+)$/)?.[1];
    if (codigo) {
      const [c] = await (await db()).linhas<{ codigo: string; descricao: string }>(
        "SELECT codigo, descricao FROM cnaes WHERE codigo = ?", [codigo]);
      if (!c) throw new Error(`CNAE ${codigo} não existe na base.`);
      return { slug, nome: c.descricao, keywords: [], cnaes: [c.codigo], name_stems: [] };
    }
    const segmento = (await lerSegmentos(cfg.arquivoSegmentos)).find((s) => s.slug === slug);
    if (!segmento) throw new Error(`Segmento ${slug} não existe.`);
    return segmento;
  }

  async function novaLista(slug: string, opcoes: Omit<OpcoesLista, "segmento">) {
    if (atualizacao?.rodando) throw new Error("A base da Receita está sendo atualizada. Espere terminar para gerar a lista.");
    const segmento = await resolverSegmento(slug);
    slug = segmento.slug;
    const lim = opcoes.limiteCompartilhado ?? 3;
    const { leads, encontrados, cnaes, stems } = await gerarLista(await db(), { ...opcoes, segmento });
    const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    const nome = `${slug}-${opcoes.uf.toLowerCase()}-${carimbo}`;
    return {
      nome, segmento: segmento.nome, encontrados, cnaes, stems, colunas: COLUNAS_CSV,
      linhas: leads.map((l, i) => paraTexto(linhaCsv(i + 1, l, lim))),
    };
  }

  /** Grava no histórico os CNPJs que entraram no CRM (não voltam nas próximas listas por 90 dias). */
  async function registrar(nomeLista: string, cnpjs: string[]) {
    await registrarExportacao(await db(), cnpjs.map((cnpj) => ({ cnpj }) as Lead), nomeLista);
  }

  async function verificarNoGoogle(
    linhas: LinhaLista[],
    o: { provedor?: "google" | "serper"; detalhes?: boolean },
    aoProgredir?: (i: number, total: number, status: StatusGoogle) => void,
  ) {
    const usarSerper = o.provedor === "serper";
    const chave = usarSerper ? cfg.serperKey : cfg.googleKey;
    if (!chave) {
      throw new Error(`Defina ${usarSerper ? "SERPER_API_KEY" : "GOOGLE_PLACES_API_KEY"} no arquivo .env do CRM e reinicie o npm run dev.`);
    }
    const uso = await Uso.criar(await db(), limites);
    const provedor = usarSerper ? new Serper(chave, uso) : new GooglePlaces(chave, uso);
    const r = await verificarLista(await db(), linhas, {
      provedor, detalhes: o.detalhes, aoProgredir: (i, total, s) => aoProgredir?.(i, total, s),
    });
    return { linhas: r.linhas.map(paraTexto), erroCota: r.erroCota, colunas: COLUNAS_GOOGLE };
  }

  return { status, segmentos, novaLista, registrar, verificarNoGoogle, fechar, atualizar, progresso: () => atualizacao };
}

export type Servico = ReturnType<typeof criarServico>;
