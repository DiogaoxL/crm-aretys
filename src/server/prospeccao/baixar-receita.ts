/**
 * Atualização automática da base: descobre o mês mais recente publicado pela Receita, baixa os ZIPs
 * necessários para dados/cnpj/AAAA-MM, carrega no DuckDB (carregar-receita.ts) e apaga os ZIPs.
 *
 *   npm run receita:atualizar                 # Brasil inteiro, mês mais recente
 *   npm run receita:atualizar -- --uf PR      # só algumas UFs
 *   npm run receita:atualizar -- --manter-zips --forcar
 *
 * Desde 2026 os arquivos ficam num compartilhamento público (WebDAV) em arquivos.receitafederal.gov.br.
 * O "token" do compartilhamento é público; se a Receita trocar, defina RECEITA_SHARE_TOKEN no .env.
 */
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { carregarReceita, ORDEM, PREFIXO } from "./carregar-receita.js";
import { Banco } from "./db.js";

export const WEBDAV_RECEITA = "https://arquivos.receitafederal.gov.br/public.php/webdav";
export const TOKEN_RECEITA = "YggdBLfdninEJX9";

export interface ArquivoRemoto { nome: string; bytes: number }

export interface Progresso {
  fase: "verificando" | "baixando" | "carregando" | "limpando" | "concluido" | "erro";
  mensagem: string;
  competencia?: string;
  arquivo?: string;
  baixados?: number;      // bytes já baixados (todos os arquivos)
  total?: number;         // bytes a baixar (todos os arquivos)
  /** 0–100 dentro da fase atual (baixando ou carregando). */
  percentual?: number;
  /** Etapa 1 de 2 (download) ou 2 de 2 (carga). */
  etapa?: number;
  /** Quando a fase atual começou (ISO): a tela estima o tempo restante. */
  inicioFase?: string;
}

export interface OpcoesAtualizacao {
  /** Pasta base dos dados (dentro do projeto): ZIPs em <dados>/cnpj/AAAA-MM, extração em <dados>/tmp. */
  pastaDados: string;
  ufs?: string[];
  manterZips?: boolean;
  /** Recarrega mesmo se o banco já estiver no mês mais recente. */
  forcar?: boolean;
  token?: string;
  base?: string;
  aoProgredir?: (p: Progresso) => void;
}

const autorizacao = (token: string) => "Basic " + Buffer.from(`${token}:`).toString("base64");

/** PROPFIND (Depth 1) no compartilhamento: devolve os itens da pasta (href e tamanho). */
async function listar(url: string, token: string): Promise<{ href: string; bytes: number }[]> {
  const r = await fetch(url, {
    method: "PROPFIND",
    headers: { Authorization: autorizacao(token), Depth: "1" },
    signal: AbortSignal.timeout(60_000),
  });
  if (r.status !== 207) {
    throw new Error(`A Receita respondeu ${r.status} ao listar ${url}. Se o compartilhamento mudou, ajuste RECEITA_SHARE_TOKEN no .env.`);
  }
  const xml = await r.text();
  return xml.split(/<d:response>/i).slice(1).map((bloco) => ({
    href: decodeURIComponent(bloco.match(/<d:href>([^<]*)<\/d:href>/i)?.[1] ?? ""),
    bytes: Number(bloco.match(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/i)?.[1] ?? 0),
  }));
}

/** Meses publicados (AAAA-MM), do mais antigo ao mais recente. */
export async function competencias(token = TOKEN_RECEITA, base = WEBDAV_RECEITA): Promise<string[]> {
  const itens = await listar(base + "/", token);
  return itens.map((i) => i.href.match(/(\d{4}-\d{2})\/?$/)?.[1]).filter((m): m is string => !!m).sort();
}

/** ZIPs do mês que o carregador usa (Empresas, Estabelecimentos, Socios, Simples, Cnaes, Municipios). */
export async function arquivosDoMes(mes: string, token = TOKEN_RECEITA, base = WEBDAV_RECEITA): Promise<ArquivoRemoto[]> {
  const prefixos = ORDEM.map((t) => PREFIXO[t]);
  return (await listar(`${base}/${mes}/`, token))
    .map((i) => ({ nome: i.href.split("/").filter(Boolean).pop() ?? "", bytes: i.bytes }))
    .filter((a) => /\.zip$/i.test(a.nome) && prefixos.some((p) => a.nome.startsWith(p)))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Baixa um arquivo com retomada (Range) e até 5 tentativas. Pula se já estiver completo.
 *  `aoReceber` recebe a posição (bytes já gravados deste arquivo). */
async function baixar(url: string, destino: string, bytes: number, token: string, aoReceber: (n: number) => void) {
  if (existsSync(destino) && (await stat(destino)).size === bytes) { aoReceber(bytes); return; }
  const parcial = destino + ".part";
  for (let tentativa = 1; ; tentativa++) {
    const ja = existsSync(parcial) ? (await stat(parcial)).size : 0;
    try {
      if (ja < bytes) {
        const r = await fetch(url, {
          headers: { Authorization: autorizacao(token), ...(ja ? { Range: `bytes=${ja}-` } : {}) },
        });
        if (r.status !== 200 && r.status !== 206) throw new Error(`HTTP ${r.status}`);
        const continuar = r.status === 206; // 200 = o servidor ignorou o Range: recomeça do zero
        let posicao = continuar ? ja : 0;
        aoReceber(posicao);
        const corpo = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream);
        corpo.on("data", (c: Buffer) => aoReceber((posicao += c.length)));
        await pipeline(corpo, createWriteStream(parcial, { flags: continuar ? "a" : "w" }));
      }
      const final = (await stat(parcial)).size;
      if (final !== bytes) throw new Error(`tamanho ${final} ≠ ${bytes}`);
      await rename(parcial, destino);
      return;
    } catch (e) {
      if (tentativa >= 5) throw new Error(`Falha ao baixar ${path.basename(destino)}: ${(e as Error).message}`);
      await new Promise((ok) => setTimeout(ok, 3000 * tentativa));
    }
  }
}

async function competenciaCarregada(db: Banco): Promise<string | null> {
  await db.exec("CREATE TABLE IF NOT EXISTS receita_meta (chave VARCHAR PRIMARY KEY, valor VARCHAR)");
  return (await db.valor<string>("SELECT valor FROM receita_meta WHERE chave = 'competencia'")) ?? null;
}

export { competenciaCarregada };

/**
 * Fluxo completo. Usa a conexão `db` já aberta (no app) ou abre `arquivoDb` (na CLI).
 * Os ZIPs só são apagados depois que a carga termina sem erro.
 */
export async function atualizarReceita(destino: Banco | string, o: OpcoesAtualizacao): Promise<{ competencia: string; carregou: boolean }> {
  const token = o.token || TOKEN_RECEITA;
  const base = o.base || WEBDAV_RECEITA;
  const avisar = o.aoProgredir ?? ((p: Progresso) => console.log(p.mensagem));
  const inicioDownload = new Date().toISOString();
  const db = typeof destino === "string" ? await Banco.abrir(destino) : destino;

  avisar({ fase: "verificando", mensagem: "Procurando o mês mais recente na Receita…" });
  const meses = await competencias(token, base);
  const mes = meses.at(-1);
  if (!mes) throw new Error("Nenhum mês (AAAA-MM) encontrado no compartilhamento da Receita.");
  const atual = await competenciaCarregada(db);
  if (atual === mes && !o.forcar) {
    avisar({ fase: "concluido", competencia: mes, mensagem: `A base já está no mês mais recente (${mes}).` });
    return { competencia: mes, carregou: false };
  }

  const arquivos = await arquivosDoMes(mes, token, base);
  const faltam = ORDEM.filter((t) => !arquivos.some((a) => a.nome.startsWith(PREFIXO[t])));
  if (faltam.length) throw new Error(`O mês ${mes} ainda não tem todos os arquivos (faltam ${faltam.map((t) => PREFIXO[t]).join(", ")}). Tente mais tarde.`);

  const pastaMes = path.join(o.pastaDados, "cnpj", mes);
  await mkdir(pastaMes, { recursive: true });
  const total = arquivos.reduce((s, a) => s + a.bytes, 0);
  let concluidos = 0;
  for (const a of arquivos) {
    let ultimoAviso = 0;
    await baixar(`${base}/${mes}/${a.nome}`, path.join(pastaMes, a.nome), a.bytes, token, (doArquivo) => {
      const agora = Date.now();
      if (agora - ultimoAviso < 1000 && doArquivo < a.bytes) return;
      ultimoAviso = agora;
      const baixados = concluidos + doArquivo;
      avisar({
        fase: "baixando", competencia: mes, arquivo: a.nome, baixados, total,
        etapa: 1, inicioFase: inicioDownload, percentual: total ? (100 * baixados) / total : 0,
        mensagem: `Baixando ${a.nome} · ${(baixados / 1e9).toFixed(2)} de ${(total / 1e9).toFixed(2)} GB`,
      });
    });
    concluidos += a.bytes;
  }

  const ufs = (o.ufs ?? []).map((u) => u.trim().toUpperCase()).filter(Boolean);
  avisar({ fase: "carregando", competencia: mes, mensagem: `Carregando ${mes} (${ufs.length ? ufs.join(", ") : "todas as UFs"})…` });
  const inicioCarga = new Date().toISOString();
  let percentualCarga = 0;
  await carregarReceita(pastaMes, db, ufs, {
    tmp: path.join(o.pastaDados, "tmp"),
    log: (m) => avisar({ fase: "carregando", competencia: mes, etapa: 2, inicioFase: inicioCarga, percentual: percentualCarga, mensagem: m.trim() }),
    aoProgredir: (p) => {
      percentualCarga = p.total ? (100 * p.feitos) / p.total : 0;
      avisar({ fase: "carregando", competencia: mes, etapa: 2, inicioFase: inicioCarga, percentual: percentualCarga, mensagem: p.etapa });
    },
  });
  await db.exec("INSERT OR REPLACE INTO receita_meta VALUES ('competencia', ?), ('ufs', ?), ('carregado_em', ?)",
    [mes, ufs.join(",") || "todas", new Date().toISOString()]);

  if (!o.manterZips) {
    avisar({ fase: "limpando", competencia: mes, mensagem: "Apagando os ZIPs baixados…" });
    await rm(pastaMes, { recursive: true, force: true });
    // Meses antigos que tenham ficado para trás (download interrompido de outro mês)
    const pastaCnpj = path.join(o.pastaDados, "cnpj");
    if ((await readdir(pastaCnpj)).length === 0) await rm(pastaCnpj, { recursive: true, force: true });
  }
  await rm(path.join(o.pastaDados, "tmp"), { recursive: true, force: true });
  avisar({ fase: "concluido", competencia: mes, mensagem: `Base atualizada para ${mes}.` });
  return { competencia: mes, carregou: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      db: { type: "string", default: "dados/receita.duckdb" },
      dados: { type: "string", default: "dados" },
      uf: { type: "string", multiple: true, default: [] },
      "manter-zips": { type: "boolean", default: false },
      forcar: { type: "boolean", default: false },
    },
  });
  const ufs = values.uf!.length ? values.uf! : (process.env.RECEITA_UFS ?? "").split(",");
  await atualizarReceita(values.db!, {
    pastaDados: values.dados!, ufs, manterZips: values["manter-zips"], forcar: values.forcar,
    token: process.env.RECEITA_SHARE_TOKEN,
    aoProgredir: (p) => {
      if (p.fase === "baixando") process.stdout.write(`\r${p.mensagem.padEnd(70)}`);
      else console.log((p.fase === "carregando" ? "" : "\n") + p.mensagem);
    },
  });
}
