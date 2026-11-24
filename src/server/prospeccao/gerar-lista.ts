/**
 * Gera uma lista de prospecção a partir do banco DuckDB da Receita.
 *
 *   npm run lista -- --segmento dermatologia --uf PR --municipio Curitiba --limite 100
 *
 * Empresas exportadas nos últimos 90 dias ficam de fora (cada lista da semana traz leads novos).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { escreverCsv } from "./csv.js";
import { Banco, literal, marcadores, type Param } from "./db.js";
import {
  EMAILS_GRATUITOS, QUALIFICACOES_DECISOR, classificarTelefone, dominioEmail, normalizar, scoreLead,
  type TelefoneLead,
} from "./regras.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export interface Segmento {
  slug: string;
  nome: string;
  /** Nicho do mapa do GRID (Anexo A), ex.: "Saúde e clínicas". */
  nicho?: string;
  grupo?: string;
  /** Trechos da descrição do CNAE (sem acento). */
  keywords: string[];
  /** Ou códigos de CNAE explícitos. */
  cnaes?: string[];
  /** Radicais procurados na razão social / nome fantasia. */
  name_stems: string[];
}

export interface OpcoesLista {
  segmento: Segmento;
  uf: string;
  municipios?: string[];
  limite?: number;
  incluirSecundarios?: boolean;
  soMatriz?: boolean;              // padrão true
  excluirSimples?: boolean;
  portes?: string[];               // 01 ME · 03 EPP · 05 Demais
  idadeMinAnos?: number;
  exigirTelefone?: boolean;        // padrão true
  exigirDecisor?: boolean;
  esconderContabilidade?: boolean; // padrão: só marca
  limiteCompartilhado?: number;    // padrão 3
  reexibirAposDias?: number;       // padrão 90; 0 desliga
  filtroNome?: "auto" | "sim" | "nao";
}

export interface Lead {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnaePrincipal: string;
  cnaeDescricao: string | null;
  logradouro: string;
  numero: string | null;
  bairro: string | null;
  cep: string | null;
  municipio: string | null;
  uf: string;
  telefones: Required<TelefoneLead>[];
  email: string | null;
  emailCompartilhado: number;
  matriz: boolean;
  dataInicio: string | null;
  capitalSocial: string | null;
  porte: string | null;
  naturezaJuridica: string | null;
  simples: string;
  decisor: string | null;
  qtdSocios: number;
  score: number;
  motivos: string[];
}

export async function lerSegmentos(arquivo = path.join(AQUI, "segmentos.json")): Promise<Segmento[]> {
  return JSON.parse(await readFile(arquivo, "utf8"));
}

export async function cnaesDoSegmento(db: Banco, seg: Segmento) {
  if (seg.cnaes?.length) {
    return db.linhas<{ codigo: string; descricao: string }>(
      `SELECT codigo, descricao FROM cnaes WHERE codigo IN (${marcadores(seg.cnaes.length)})`, seg.cnaes);
  }
  // A keyword passa por normalizar() (sem acento e sem pontuação); a descrição do CNAE precisa do mesmo
  // tratamento, senão "lanchonetes, casas de cha, de sucos e similares" ou "nao-ferrosos" nunca casam.
  const descricao = "trim(regexp_replace(regexp_replace(lower(strip_accents(descricao)), '[^a-z0-9]+', ' ', 'g'), ' +', ' ', 'g'))";
  const conds = seg.keywords.map(() => `${descricao} LIKE ?`).join(" OR ");
  return db.linhas<{ codigo: string; descricao: string }>(
    `SELECT codigo, descricao FROM cnaes WHERE ${conds}`,
    seg.keywords.map((k) => `%${normalizar(k).toLowerCase()}%`));
}

/** Igual ao GRID: só filtra pelo nome se os radicais NÃO aparecem na descrição do CNAE (CNAE genérico demais). */
export function deveFiltrarPorNome(seg: Segmento, descricoesCnae: string[]): boolean {
  const stems = seg.name_stems.map(normalizar).filter(Boolean);
  if (!stems.length) return false;
  const descricoes = descricoesCnae.map(normalizar).join(" ");
  return !stems.some((s) => descricoes.includes(s));
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SQL_BASE = `
WITH socios_rank AS (
  SELECT cnpj_basico, nome_socio,
         row_number() OVER (PARTITION BY cnpj_basico
                            ORDER BY coalesce(nullif(list_position([${QUALIFICACOES_DECISOR.map(literal).join(", ")}],
                                                                   qualificacao_socio), 0), 99),
                                     data_entrada_sociedade) AS rk,
         count(*) OVER (PARTITION BY cnpj_basico) AS qtd_socios
  FROM socios
  WHERE identificador_socio = '2'  -- pessoa física
)
SELECT e.cnpj_basico || e.cnpj_ordem || e.cnpj_dv              AS cnpj,
       emp.razao_social, e.nome_fantasia,
       e.cnae_fiscal_principal, c.descricao                      AS cnae_descricao,
       trim(e.tipo_logradouro || ' ' || e.logradouro)           AS logradouro,
       e.numero, e.bairro, e.cep, m.descricao                   AS municipio, e.uf,
       e.ddd_1, e.telefone_1, coalesce(t1.empresas, 0)           AS tel1_compartilhado,
       e.ddd_2, e.telefone_2, coalesce(t2.empresas, 0)           AS tel2_compartilhado,
       lower(trim(e.correio_eletronico))                        AS email,
       coalesce(em.empresas, 0)                                 AS email_compartilhado,
       e.identificador_matriz_filial = '1'                      AS matriz,
       e.data_inicio_atividade, emp.capital_social, emp.porte_empresa, emp.natureza_juridica,
       coalesce(si.opcao_simples, 'N')                          AS simples,
       s.nome_socio                                             AS decisor,
       coalesce(s.qtd_socios, 0)                                AS qtd_socios
FROM estabelecimentos e
JOIN empresas emp            ON emp.cnpj_basico = e.cnpj_basico
LEFT JOIN simples si         ON si.cnpj_basico = e.cnpj_basico
LEFT JOIN cnaes c            ON c.codigo = e.cnae_fiscal_principal
LEFT JOIN municipios m       ON m.codigo = e.municipio
LEFT JOIN telefones_compartilhados t1 ON t1.tel = e.ddd_1 || e.telefone_1
LEFT JOIN telefones_compartilhados t2 ON t2.tel = e.ddd_2 || e.telefone_2
LEFT JOIN emails_compartilhados em    ON em.email = lower(trim(e.correio_eletronico))
LEFT JOIN socios_rank s      ON s.cnpj_basico = e.cnpj_basico AND s.rk = 1
WHERE `;

function montarWhere(o: OpcoesLista, cnaes: string[], stems: string[]): [string, Param[]] {
  const w: string[] = [];
  const p: Param[] = [];
  const ph = marcadores(cnaes.length);

  if (o.incluirSecundarios) {
    w.push(`(e.cnae_fiscal_principal IN (${ph}) OR ` +
      `list_has_any(string_split(e.cnae_fiscal_secundaria, ','), [${ph}]))`);
    p.push(...cnaes, ...cnaes);
  } else {
    w.push(`e.cnae_fiscal_principal IN (${ph})`);
    p.push(...cnaes);
  }
  w.push("coalesce(si.opcao_mei, 'N') <> 'S'"); // sem MEI
  w.push("e.uf = ?"); p.push(o.uf.toUpperCase());
  if (o.municipios?.length) {
    w.push(`m.descricao IN (${marcadores(o.municipios.length)})`);
    p.push(...o.municipios.map(normalizar));
  }
  if (stems.length) {
    w.push("regexp_matches(upper(strip_accents(coalesce(emp.razao_social, '') || ' ' || " +
      "coalesce(e.nome_fantasia, ''))), ?)");
    p.push(stems.map(escaparRegex).join("|"));
  }
  if (o.soMatriz ?? true) w.push("e.identificador_matriz_filial = '1'");
  if (o.excluirSimples) w.push("coalesce(si.opcao_simples, 'N') <> 'S'");
  if (o.portes?.length) {
    w.push(`emp.porte_empresa IN (${marcadores(o.portes.length)})`);
    p.push(...o.portes);
  }
  if (o.idadeMinAnos) {
    w.push("e.data_inicio_atividade <= strftime(current_date - to_years(CAST(? AS INTEGER)), '%Y%m%d')");
    p.push(o.idadeMinAnos);
  }
  const dias = o.reexibirAposDias ?? 90;
  if (dias > 0) {
    w.push("(e.cnpj_basico || e.cnpj_ordem || e.cnpj_dv) NOT IN (SELECT cnpj FROM historico_exportados " +
      "WHERE exportado_em > current_timestamp - to_days(CAST(? AS INTEGER)))");
    p.push(dias);
  }
  return [w.join(" AND "), p];
}

type Linha = Record<string, string | number | boolean | null>;
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));

function montarLead(r: Linha, limiteCompartilhado: number): Lead {
  const telefones: Required<TelefoneLead>[] = [];
  for (const [ddd, num, comp] of [
    [r.ddd_1, r.telefone_1, r.tel1_compartilhado],
    [r.ddd_2, r.telefone_2, r.tel2_compartilhado],
  ] as const) {
    const t = classificarTelefone(txt(ddd), txt(num));
    if (t && !telefones.some((x) => x.e164 === t.e164)) telefones.push({ ...t, compartilhado: Number(comp) });
  }
  const lead: Omit<Lead, "score" | "motivos"> = {
    cnpj: String(r.cnpj), razaoSocial: String(r.razao_social ?? ""), nomeFantasia: txt(r.nome_fantasia),
    cnaePrincipal: String(r.cnae_fiscal_principal), cnaeDescricao: txt(r.cnae_descricao),
    logradouro: String(r.logradouro ?? ""), numero: txt(r.numero), bairro: txt(r.bairro), cep: txt(r.cep),
    municipio: txt(r.municipio), uf: String(r.uf), telefones,
    email: txt(r.email) || null, emailCompartilhado: Number(r.email_compartilhado),
    matriz: Boolean(r.matriz), dataInicio: txt(r.data_inicio_atividade), capitalSocial: txt(r.capital_social),
    porte: txt(r.porte_empresa), naturezaJuridica: txt(r.natureza_juridica), simples: String(r.simples),
    decisor: txt(r.decisor), qtdSocios: Number(r.qtd_socios),
  };
  return { ...lead, ...scoreLead(lead, limiteCompartilhado) };
}

/** Função principal para usar dentro da sua aplicação. Não grava histórico (use registrarExportacao). */
export async function gerarLista(db: Banco, o: OpcoesLista): Promise<{ leads: Lead[]; encontrados: number; cnaes: string[]; stems: string[] }> {
  const cnaes = await cnaesDoSegmento(db, o.segmento);
  if (!cnaes.length) throw new Error("Nenhum CNAE casou com as keywords do segmento.");

  const filtro = o.filtroNome ?? "auto";
  const usarNome = filtro === "sim" ||
    (filtro === "auto" && deveFiltrarPorNome(o.segmento, cnaes.map((c) => c.descricao)));
  const stems = usarNome ? o.segmento.name_stems.map(normalizar).filter(Boolean) : [];

  const [where, params] = montarWhere(o, cnaes.map((c) => c.codigo), stems);
  const lim = o.limiteCompartilhado ?? 3;
  let leads = (await db.linhas<Linha>(SQL_BASE + where, params)).map((r) => montarLead(r, lim));
  const encontrados = leads.length;

  if (o.exigirTelefone ?? true) leads = leads.filter((l) => l.telefones.length);
  if (o.esconderContabilidade) leads = leads.filter((l) => l.telefones.some((t) => t.compartilhado < lim));
  if (o.exigirDecisor) leads = leads.filter((l) => l.decisor);
  leads.sort((a, b) => b.score - a.score);

  return { leads: leads.slice(0, o.limite ?? 100), encontrados, cnaes: cnaes.map((c) => c.codigo), stems };
}

export async function registrarExportacao(db: Banco, leads: Lead[], nomeLista: string) {
  for (const l of leads) {
    await db.exec("INSERT INTO historico_exportados (cnpj, lista) VALUES (?, ?)", [l.cnpj, nomeLista]);
  }
}

export const COLUNAS_CSV = [
  "posicao", "score", "cnpj", "razao_social", "nome_fantasia", "decisor", "telefone_principal",
  "tipo_telefone", "telefone_contabilidade", "outros_telefones", "email", "email_tipo",
  "cnae_fiscal_principal", "cnae_descricao", "endereco", "numero", "bairro", "cep", "municipio", "uf",
  "data_inicio_atividade", "capital_social", "porte_empresa", "simples", "matriz", "qtd_socios", "motivos",
];

export function linhaCsv(posicao: number, l: Lead, lim = 3): Record<string, unknown> {
  const tels = [...l.telefones].sort((a, b) =>
    Number(a.compartilhado >= lim) - Number(b.compartilhado >= lim) ||
    Number(!a.tipo.startsWith("celular")) - Number(!b.tipo.startsWith("celular")));
  const principal = tels[0];
  const dom = dominioEmail(l.email);
  return {
    posicao, score: l.score, cnpj: l.cnpj, razao_social: l.razaoSocial, nome_fantasia: l.nomeFantasia,
    decisor: l.decisor ?? "",
    telefone_principal: principal?.exibicao ?? "", tipo_telefone: principal?.tipo ?? "",
    telefone_contabilidade: principal && principal.compartilhado >= lim ? "sim" : "",
    outros_telefones: tels.slice(1).map((t) => t.exibicao).join(" / "),
    email: l.email ?? "",
    email_tipo: !dom ? "" : l.emailCompartilhado >= lim ? "contabilidade" : EMAILS_GRATUITOS.has(dom) ? "gratuito" : "proprio",
    cnae_fiscal_principal: l.cnaePrincipal, cnae_descricao: l.cnaeDescricao,
    endereco: l.logradouro, numero: l.numero, bairro: l.bairro, cep: l.cep, municipio: l.municipio, uf: l.uf,
    data_inicio_atividade: l.dataInicio, capital_social: l.capitalSocial, porte_empresa: l.porte,
    simples: l.simples, matriz: l.matriz ? "sim" : "não", qtd_socios: l.qtdSocios, motivos: l.motivos.join("; "),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: a } = parseArgs({
    options: {
      db: { type: "string", default: "receita.duckdb" },
      segmentos: { type: "string" },
      segmento: { type: "string" },
      uf: { type: "string" },
      municipio: { type: "string", multiple: true, default: [] },
      limite: { type: "string", default: "100" },
      "incluir-secundarios": { type: "boolean", default: false },
      "incluir-filiais": { type: "boolean", default: false },
      "excluir-simples": { type: "boolean", default: false },
      porte: { type: "string", multiple: true, default: [] },
      "idade-min": { type: "string", default: "0" },
      "permitir-sem-telefone": { type: "boolean", default: false },
      "exigir-decisor": { type: "boolean", default: false },
      "esconder-contabilidade": { type: "boolean", default: false },
      "limite-compartilhado": { type: "string", default: "3" },
      "reexibir-apos-dias": { type: "string", default: "90" },
      "filtro-nome": { type: "string", default: "auto" },
      saida: { type: "string" },
    },
  });
  if (!a.segmento || !a.uf) {
    console.error("Uso: npm run lista -- --segmento <slug> --uf PR [--municipio Curitiba] [--limite 100]");
    process.exit(1);
  }
  const segmentos = await lerSegmentos(a.segmentos);
  const segmento = segmentos.find((s) => s.slug === a.segmento);
  if (!segmento) {
    console.error(`Segmento '${a.segmento}' não existe. Disponíveis: ${segmentos.map((s) => s.slug).join(", ")}`);
    process.exit(1);
  }

  const lim = Number(a["limite-compartilhado"]);
  const db = await Banco.abrir(a.db!);
  const r = await gerarLista(db, {
    segmento, uf: a.uf, municipios: a.municipio, limite: Number(a.limite),
    incluirSecundarios: a["incluir-secundarios"], soMatriz: !a["incluir-filiais"],
    excluirSimples: a["excluir-simples"], portes: a.porte, idadeMinAnos: Number(a["idade-min"]),
    exigirTelefone: !a["permitir-sem-telefone"], exigirDecisor: a["exigir-decisor"],
    esconderContabilidade: a["esconder-contabilidade"], limiteCompartilhado: lim,
    reexibirAposDias: Number(a["reexibir-apos-dias"]), filtroNome: a["filtro-nome"] as OpcoesLista["filtroNome"],
  });
  console.log(`CNAEs: ${r.cnaes.join(", ")}` + (r.stems.length ? ` · nome contém ${r.stems.join("/")}` : ""));

  const agora = new Date();
  const carimbo = agora.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const nomeLista = `${a.segmento}-${a.uf.toLowerCase()}-${carimbo}`;
  const saida = a.saida ?? `${nomeLista}.csv`;
  await escreverCsv(saida, COLUNAS_CSV, r.leads.map((l, i) => linhaCsv(i + 1, l, lim)));
  await registrarExportacao(db, r.leads, nomeLista);
  console.log(`${r.encontrados} empresas encontradas · ${r.leads.length} exportadas para ${saida}`);
}
