/**
 * Carrega os ZIPs da base pública de CNPJ (Receita Federal) num banco DuckDB local.
 *
 * Baixe os arquivos do mês em https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj
 * (Empresas*.zip, Estabelecimentos*.zip, Socios*.zip, Simples.zip, Cnaes.zip, Municipios.zip) e rode:
 *
 *   npm run carregar -- --zips C:/dados/cnpj/2026-11 --uf PR --uf SC
 *
 * Filtrar por UF reduz o banco de ~25 GB (Brasil) para poucos GB. Só estabelecimentos ATIVOS são carregados.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import yauzl, { type Entry } from "yauzl";
import { Banco, literal } from "./db.js";

export const LAYOUT = {
  cnaes: ["codigo", "descricao"],
  municipios: ["codigo", "descricao"],
  estabelecimentos: [
    "cnpj_basico", "cnpj_ordem", "cnpj_dv", "identificador_matriz_filial", "nome_fantasia",
    "situacao_cadastral", "data_situacao_cadastral", "motivo_situacao_cadastral",
    "nome_cidade_exterior", "pais", "data_inicio_atividade", "cnae_fiscal_principal",
    "cnae_fiscal_secundaria", "tipo_logradouro", "logradouro", "numero", "complemento",
    "bairro", "cep", "uf", "municipio", "ddd_1", "telefone_1", "ddd_2", "telefone_2",
    "ddd_fax", "fax", "correio_eletronico", "situacao_especial", "data_situacao_especial",
  ],
  empresas: [
    "cnpj_basico", "razao_social", "natureza_juridica", "qualificacao_responsavel",
    "capital_social", "porte_empresa", "ente_federativo",
  ],
  socios: [
    "cnpj_basico", "identificador_socio", "nome_socio", "cnpj_cpf_socio", "qualificacao_socio",
    "data_entrada_sociedade", "pais", "representante_legal", "nome_representante",
    "qualificacao_representante_legal", "faixa_etaria",
  ],
  simples: [
    "cnpj_basico", "opcao_simples", "data_opcao_simples", "data_exclusao_simples",
    "opcao_mei", "data_opcao_mei", "data_exclusao_mei",
  ],
} as const;

type Tabela = keyof typeof LAYOUT;

export const PREFIXO: Record<Tabela, string> = {
  cnaes: "Cnaes", municipios: "Municipios", estabelecimentos: "Estabelecimentos",
  empresas: "Empresas", socios: "Socios", simples: "Simples",
};
// Estabelecimentos antes: as outras tabelas são filtradas pelos CNPJs carregados.
export const ORDEM: Tabela[] = ["cnaes", "municipios", "estabelecimentos", "empresas", "socios", "simples"];

export interface OpcoesCarga {
  /** Pasta onde cada ZIP é extraído (e apagado em seguida). Padrão: pasta temporária do sistema. */
  tmp?: string;
  log?: (msg: string) => void;
  /** Progresso da carga (feitos/total em bytes de ZIP) e a etapa atual. */
  aoProgredir?: (p: { feitos: number; total: number; etapa: string }) => void;
}

/** Extrai um ZIP em streaming (os de Estabelecimentos passam de 1 GB). */
export function extrairZip(arquivo: string, destino: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(arquivo, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error(`não abriu ${arquivo}`));
      const saidas: string[] = [];
      zip.on("error", reject);
      zip.on("end", () => resolve(saidas));
      zip.on("entry", (entry: Entry) => {
        if (entry.fileName.endsWith("/")) return zip.readEntry();
        const alvo = path.join(destino, path.basename(entry.fileName)); // basename: evita zip-slip
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error("sem stream"));
          stream.pipe(createWriteStream(alvo))
            .on("finish", () => { saidas.push(alvo); zip.readEntry(); })
            .on("error", reject);
        });
      });
      zip.readEntry();
    });
  });
}

function readCsv(arquivo: string, colunas: readonly string[], paralelo = true): string {
  const cols = colunas.map((c) => `'${c}': 'VARCHAR'`).join(", "); // CNPJ é alfanumérico desde jul/2026
  const p = arquivo.replace(/\\/g, "/");
  return `read_csv(${literal(p)}, delim=';', quote='"', escape='"', header=false, encoding='latin-1', ` +
    `columns={${cols}}, strict_mode=false, null_padding=true${paralelo ? "" : ", parallel=false"})`;
}

/**
 * O leitor paralelo do DuckDB não aceita null_padding junto com quebra de linha dentro de campo entre aspas
 * (acontece na base real, ex.: Estabelecimentos de nov/2026). Nesse caso relê o arquivo sem paralelismo:
 * o INSERT que falhou não gravou nada, então não duplica linhas.
 */
async function inserirCsv(db: Banco, tabela: string, csv: string, colunas: readonly string[], filtro: string, log: (m: string) => void) {
  let paralelo = true;
  let limpo = false;
  for (;;) {
    try {
      await db.exec(`INSERT INTO ${tabela} SELECT * FROM ${readCsv(csv, colunas, paralelo)} ${filtro}`);
      return;
    } catch (e) {
      const msg = (e as Error).message;
      if (paralelo && /parallel\s*=\s*false/i.test(msg)) {
        paralelo = false;
        log(`  ${path.basename(csv)}: campo com quebra de linha, relendo sem paralelismo (mais lento)…`);
        continue;
      }
      if (!limpo && /not latin-1 encoded/i.test(msg)) {
        const trocados = await limparControles(csv);
        limpo = true;
        log(`  ${path.basename(csv)}: ${trocados} caractere(s) de controle inválido(s) trocado(s) por espaço, relendo…`);
        continue;
      }
      throw e;
    }
  }
}

/**
 * O decodificador latin-1 do DuckDB recusa o arquivo inteiro se houver um byte de controle C1 (0x80–0x9F).
 * A base real tem alguns (ex.: 0x8F em campos vazios de Estabelecimentos8/9 de nov/2026). Troca por espaço,
 * mantendo o tamanho do arquivo. Devolve quantos bytes foram trocados.
 */
export async function limparControles(csv: string): Promise<number> {
  let trocados = 0;
  const limpo = csv + ".limpo";
  await pipeline(
    createReadStream(csv),
    new Transform({
      transform(parte: Buffer, _enc, pronto) {
        for (let i = 0; i < parte.length; i++) {
          if (parte[i] >= 0x80 && parte[i] <= 0x9f) { parte[i] = 0x20; trocados++; }
        }
        pronto(null, parte);
      },
    }),
    createWriteStream(limpo),
  );
  await rename(limpo, csv);
  return trocados;
}

/** @param destino caminho do arquivo DuckDB, ou a conexão já aberta (dentro do app). */
export async function carregarReceita(pastaZips: string, destino: string | Banco, ufs: string[] = [], o: OpcoesCarga = {}) {
  const db = typeof destino === "string" ? await Banco.abrir(destino) : destino;
  const arquivoDb = typeof destino === "string" ? destino : "banco do app";
  const log = o.log ?? console.log;
  const tmpBase = o.tmp ?? tmpdir();
  await mkdir(tmpBase, { recursive: true });
  const arquivosNaPasta = await readdir(pastaZips);
  // Marca de carga completa: só volta a existir no fim. Uma carga interrompida (queda, reinício do
  // servidor) deixa a base sem a marca, e a tela não a trata como pronta.
  await db.exec("CREATE TABLE IF NOT EXISTS receita_meta (chave VARCHAR PRIMARY KEY, valor VARCHAR)");
  await db.exec("DELETE FROM receita_meta WHERE chave IN ('carga_completa', 'competencia')");

  // Progresso: proporcional ao tamanho dos ZIPs (Estabelecimentos0 sozinho tem ~2,3 GB);
  // a etapa final (telefones/e-mails compartilhados, contagem por CNAE) vale os últimos 3%.
  const zipsPorTabela = Object.fromEntries(ORDEM.map((t) => [t, arquivosNaPasta
    .filter((f) => f.startsWith(PREFIXO[t]) && f.toLowerCase().endsWith(".zip")).sort()])) as Record<Tabela, string[]>;
  const tamanho = new Map<string, number>();
  for (const z of Object.values(zipsPorTabela).flat()) tamanho.set(z, (await stat(path.join(pastaZips, z))).size);
  const bytesZips = [...tamanho.values()].reduce((a, b) => a + b, 0);
  const total = Math.round(bytesZips / 0.97);
  let feitos = 0;
  const progresso = (etapa: string) => o.aoProgredir?.({ feitos, total, etapa });

  for (const tabela of ORDEM) {
    const zips = zipsPorTabela[tabela];
    if (!zips.length) throw new Error(`Nenhum ${PREFIXO[tabela]}*.zip em ${pastaZips}`);

    const colunas = LAYOUT[tabela];
    await db.exec(`DROP TABLE IF EXISTS ${tabela}`);
    await db.exec(`CREATE TABLE ${tabela} (${colunas.map((c) => `${c} VARCHAR`).join(", ")})`);

    let filtro = "";
    if (tabela === "estabelecimentos") {
      filtro = "WHERE situacao_cadastral = '02'";
      if (ufs.length) filtro += ` AND uf IN (${ufs.map((u) => literal(u.toUpperCase())).join(", ")})`;
    } else if (tabela !== "cnaes" && tabela !== "municipios") {
      filtro = "WHERE cnpj_basico IN (SELECT cnpj_basico FROM estabelecimentos)";
    }

    for (const zip of zips) {
      progresso(`Descompactando ${zip}`);
      const tmp = await mkdtemp(path.join(tmpBase, "cnpj_"));
      try {
        const csvs = await extrairZip(path.join(pastaZips, zip), tmp);
        progresso(`Carregando ${zip}`);
        for (const csv of csvs) {
          try {
            await inserirCsv(db, tabela, csv, colunas, filtro, log);
          } catch (e) {
            throw new Error(`${zip}: ${(e as Error).message.split("\n")[0]}`); // diz qual arquivo falhou
          }
        }
        log(`  ${zip} ok`);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
      feitos += tamanho.get(zip) ?? 0;
      progresso(`${zip} ok`);
    }
    log(`${tabela}: ${Number(await db.valor(`SELECT count(*) FROM ${tabela}`)).toLocaleString("pt-BR")} linhas`);
  }

  progresso("Finalizando: telefones e e-mails compartilhados, contagem por atividade");
  log("Calculando telefones e e-mails compartilhados (sinal de contabilidade)...");
  await db.exec(`
    CREATE OR REPLACE TABLE telefones_compartilhados AS
    SELECT tel, count(DISTINCT cnpj_basico) AS empresas FROM (
      SELECT cnpj_basico, ddd_1 || telefone_1 AS tel FROM estabelecimentos WHERE telefone_1 <> ''
      UNION ALL
      SELECT cnpj_basico, ddd_2 || telefone_2 FROM estabelecimentos WHERE telefone_2 <> ''
    ) GROUP BY tel`);
  await db.exec(`
    CREATE OR REPLACE TABLE emails_compartilhados AS
    SELECT lower(trim(correio_eletronico)) AS email, count(DISTINCT cnpj_basico) AS empresas
    FROM estabelecimentos WHERE correio_eletronico <> '' GROUP BY 1`);
  await contarEmpresasPorCnae(db, log);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS historico_exportados (
      cnpj VARCHAR, lista VARCHAR, exportado_em TIMESTAMP DEFAULT current_timestamp)`);
  await db.exec("INSERT OR REPLACE INTO receita_meta VALUES ('carga_completa', ?)", [new Date().toISOString()]);
  feitos = total;
  progresso("Concluído");
  log(`Pronto: ${arquivoDb}`);
}

/**
 * Catálogo de segmentos da base: quantas empresas existem em cada CNAE (atividade principal).
 * Mesmo universo padrão da lista: matriz, ativa, sem MEI. Recalculado a cada carga.
 */
export async function contarEmpresasPorCnae(db: Banco, log: (m: string) => void = console.log) {
  log("Contando empresas por atividade (catálogo de segmentos)...");
  await db.exec(`
    CREATE OR REPLACE TABLE cnae_empresas AS
    SELECT e.cnae_fiscal_principal AS codigo, count(*) AS empresas
    FROM estabelecimentos e LEFT JOIN simples si ON si.cnpj_basico = e.cnpj_basico
    WHERE e.identificador_matriz_filial = '1' AND coalesce(si.opcao_mei, 'N') <> 'S'
    GROUP BY 1`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      zips: { type: "string" },
      db: { type: "string", default: "receita.duckdb" },
      uf: { type: "string", multiple: true, default: [] },
    },
  });
  if (!values.zips) {
    console.error("Uso: npm run carregar -- --zips <pasta com os ZIPs> [--uf PR] [--db receita.duckdb]");
    process.exit(1);
  }
  await carregarReceita(values.zips, values.db!, values.uf!);
}
