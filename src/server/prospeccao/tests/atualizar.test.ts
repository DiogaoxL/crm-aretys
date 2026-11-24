/** Atualização automática contra um servidor WebDAV falso no formato do compartilhamento da Receita. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import yazl from "yazl";
import { atualizarReceita, competencias } from "../baixar-receita.js";
import { Banco } from "../db.js";

function zip(linhas: string[][]): Promise<Buffer> {
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from(linhas.map((l) => l.map((c) => `"${c}"`).join(";")).join("\n"), "latin1"), "K3241.CSV");
  z.end();
  const partes: Buffer[] = [];
  return new Promise((ok) => z.outputStream.on("data", (p: Buffer) => partes.push(p)).on("end", () => ok(Buffer.concat(partes))));
}

const estab = (b: string, uf: string, ddd: string, tel: string) =>
  [b, "0001", "00", "1", `DERMA ${b}`, "02", "20200101", "00", "", "", "20150310", "8630503", "", "RUA", "A", "1", "",
    "CENTRO", "80000000", uf, "7535", ddd, tel, "", "", "", "", "", "", ""];

describe("atualização automática da base", () => {
  const TOKEN = "tokenteste";
  const arquivos = new Map<string, Buffer>();
  let servidor: Server, base = "", pasta = "", gets = 0, derrubou = false;

  before(async () => {
    arquivos.set("Cnaes.zip", await zip([["8630503", "Atividade médica ambulatorial restrita a consultas"]]));
    arquivos.set("Municipios.zip", await zip([["7535", "CURITIBA"]]));
    arquivos.set("Estabelecimentos0.zip", await zip([estab("11111111", "PR", "41", "999998888"), estab("22222222", "SP", "11", "988887777")]));
    arquivos.set("Empresas0.zip", await zip([["11111111", "DERMA UM LTDA", "2062", "49", "1000,00", "05", ""],
      ["22222222", "DERMA DOIS LTDA", "2062", "49", "1000,00", "05", ""]]));
    arquivos.set("Socios0.zip", await zip([["11111111", "2", "ANA", "***", "49", "20150310", "", "", "", "", "5"]]));
    arquivos.set("Simples.zip", await zip([["11111111", "N", "", "", "N", "", ""]]));
    arquivos.set("Paises.zip", await zip([["1", "X"]])); // não usado: não deve ser baixado

    servidor = createServer((req, res) => {
      if (req.headers.authorization !== "Basic " + Buffer.from(`${TOKEN}:`).toString("base64")) {
        res.statusCode = 401; return res.end();
      }
      const url = decodeURIComponent(req.url ?? "");
      if (req.method === "PROPFIND") {
        const itens = url === "/webdav/" ? ["2026-10/", "2026-11/", "cnpj.tar.gz"].map((n) => [`/webdav/${n}`, 0] as const)
          : url === "/webdav/2026-11/" ? [...arquivos].map(([n, b]) => [`/webdav/2026-11/${n}`, b.length] as const) : null;
        if (!itens) { res.statusCode = 404; return res.end(); }
        res.statusCode = 207;
        return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${itens.map(([h, n]) =>
          `<d:response><d:href>${h}</d:href><d:propstat><d:prop><d:getcontentlength>${n}</d:getcontentlength></d:prop></d:propstat></d:response>`).join("")}</d:multistatus>`);
      }
      const corpo = arquivos.get(url.replace("/webdav/2026-11/", ""));
      if (!corpo) { res.statusCode = 404; return res.end(); }
      gets++;
      const ini = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
      res.statusCode = ini ? 206 : 200;
      // Simula queda de conexão no meio do maior arquivo (uma vez): testa a retomada.
      if (url.endsWith("Estabelecimentos0.zip") && !derrubou) {
        derrubou = true;
        res.write(corpo.subarray(0, 50));
        return setTimeout(() => res.destroy(), 20);
      }
      res.end(corpo.subarray(ini));
    });
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    const endereco = servidor.address();
    base = `http://127.0.0.1:${typeof endereco === "object" && endereco ? endereco.port : 0}/webdav`;
    pasta = await mkdtemp(path.join(tmpdir(), "receita-atualizar-"));
  });
  after(() => servidor.close());

  it("acha o mês mais recente", async () => {
    assert.deepEqual(await competencias(TOKEN, base), ["2026-10", "2026-11"]);
  });

  it("baixa (com retomada), carrega todas as UFs e apaga os ZIPs", async () => {
    const db = await Banco.abrir(path.join(pasta, "r.duckdb"));
    const fases = new Set<string>();
    const r = await atualizarReceita(db, { pastaDados: pasta, token: TOKEN, base, aoProgredir: (p) => fases.add(p.fase) });
    assert.deepEqual(r, { competencia: "2026-11", carregou: true });
    assert.ok(derrubou, "a queda de conexão foi simulada");
    assert.equal(Number(await db.valor("SELECT count(*) FROM estabelecimentos")), 2); // PR e SP
    assert.equal(await db.valor("SELECT valor FROM receita_meta WHERE chave = 'competencia'"), "2026-11");
    assert.ok(!existsSync(path.join(pasta, "cnpj")), "ZIPs apagados");
    assert.ok(!existsSync(path.join(pasta, "tmp")), "pasta de extração apagada");
    for (const f of ["verificando", "baixando", "carregando", "limpando", "concluido"]) assert.ok(fases.has(f), f);

    const antes = gets;
    const deNovo = await atualizarReceita(db, { pastaDados: pasta, token: TOKEN, base });
    assert.equal(deNovo.carregou, false, "já estava no mês mais recente");
    assert.equal(gets, antes, "não baixou nada de novo");
    db.fechar();
  });
});
