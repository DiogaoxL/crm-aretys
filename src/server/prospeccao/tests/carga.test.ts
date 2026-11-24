/** Carga com um campo entre aspas que contém quebra de linha (caso real: Estabelecimentos de nov/2026). */
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import yazl from "yazl";
import { carregarReceita, LAYOUT } from "../carregar-receita.js";
import { Banco } from "../db.js";

function zip(pasta: string, nome: string, linhas: string[][]): Promise<void> {
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from(linhas.map((l) => l.map((c) => `"${c}"`).join(";")).join("\n"), "latin1"), `K3241.${nome.toUpperCase()}CSV`);
  z.end();
  return new Promise((ok, erro) => {
    z.outputStream.pipe(createWriteStream(path.join(pasta, `${nome}.zip`))).on("close", ok).on("error", erro);
  });
}

describe("carga da Receita", () => {
  it("lê campo com quebra de linha (relê sem paralelismo, sem duplicar)", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "receita-carga-"));
    const zips = path.join(tmp, "zips");
    await mkdir(zips);
    const N = 6000;
    const estab = (i: number) => LAYOUT.estabelecimentos.map((c) =>
      c === "cnpj_basico" ? String(i).padStart(8, "0")
        : c === "nome_fantasia" ? (i === 3000 ? "CLINICA\nDA PELE" : "LOJA")
          : c === "situacao_cadastral" ? "02" : c === "uf" ? "PR" : c === "identificador_matriz_filial" ? "1" : "");
    await zip(zips, "Estabelecimentos0", Array.from({ length: N }, (_, i) => estab(i)));
    await zip(zips, "Cnaes", [["8630503", "Atividade médica"]]);
    await zip(zips, "Municipios", [["7535", "CURITIBA"]]);
    await zip(zips, "Empresas0", [["00000001", "EMPRESA", "2062", "49", "1,00", "01", ""]]);
    await zip(zips, "Socios0", [["00000001", "2", "ANA", "***", "49", "20150310", "", "", "", "", "5"]]);
    await zip(zips, "Simples", [["00000001", "N", "", "", "N", "", ""]]);

    const mensagens: string[] = [];
    const db = await Banco.abrir(path.join(tmp, "r.duckdb"));
    await carregarReceita(zips, db, [], { tmp: path.join(tmp, "x"), log: (m) => mensagens.push(m) });

    assert.ok(mensagens.some((m) => m.includes("relendo sem paralelismo")), "o caso do leitor paralelo foi exercitado");
    assert.equal(Number(await db.valor("SELECT count(*) FROM estabelecimentos")), N, "todas as linhas, sem duplicar");
    assert.equal(await db.valor("SELECT nome_fantasia FROM estabelecimentos WHERE cnpj_basico = '00003000'"), "CLINICA\nDA PELE");
    db.fechar();
  });

  it("troca byte de controle (0x8F) que o DuckDB recusa como latin-1, sem duplicar; progresso até 100%", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "receita-latin-"));
    const zips = path.join(tmp, "zips");
    await mkdir(zips);
    const N = 3000;
    const linha = (i: number) => LAYOUT.estabelecimentos.map((c) =>
      c === "cnpj_basico" ? String(i).padStart(8, "0") : c === "situacao_cadastral" ? "02"
        : c === "nome_fantasia" ? "JOSÉ" : c === "correio_eletronico" && i === 1500 ? "\u008f" : "").map((v) => `"${v}"`).join(";");
    // latin1: "É" vira 0xC9 (válido) e "\u008f" vira 0x8F (byte de controle C1, como na base real)
    const z = new yazl.ZipFile();
    z.addBuffer(Buffer.from(Array.from({ length: N }, (_, i) => linha(i)).join("\n"), "latin1"), "K3241.ESTABELE");
    z.end();
    await new Promise<void>((ok) => z.outputStream.pipe(createWriteStream(path.join(zips, "Estabelecimentos0.zip"))).on("close", () => ok()));
    await zip(zips, "Cnaes", [["8630503", "Atividade médica"]]);
    await zip(zips, "Municipios", [["7535", "CURITIBA"]]);
    await zip(zips, "Empresas0", [["00000001", "EMPRESA", "2062", "49", "1,00", "01", ""]]);
    await zip(zips, "Socios0", [["00000001", "2", "ANA", "***", "49", "20150310", "", "", "", "", "5"]]);
    await zip(zips, "Simples", [["00000001", "N", "", "", "N", "", ""]]);

    const mensagens: string[] = [];
    const pcts: number[] = [];
    const db = await Banco.abrir(path.join(tmp, "r.duckdb"));
    await carregarReceita(zips, db, [], {
      tmp: path.join(tmp, "x"), log: (m) => mensagens.push(m),
      aoProgredir: (p) => pcts.push((100 * p.feitos) / p.total),
    });
    assert.ok(mensagens.some((m) => /1 caractere\(s\) de controle/.test(m)), mensagens.join("\n"));
    assert.equal(Number(await db.valor("SELECT count(*) FROM estabelecimentos")), N, "sem duplicar");
    assert.equal(await db.valor("SELECT nome_fantasia FROM estabelecimentos WHERE cnpj_basico = '00000001'"), "JOSÉ");
    assert.equal(await db.valor("SELECT correio_eletronico FROM estabelecimentos WHERE cnpj_basico = '00001500'"), " ");
    assert.ok(pcts.every((p, i) => i === 0 || p >= pcts[i - 1]), "progresso só avança");
    assert.equal(pcts.at(-1), 100);
    db.fechar();
  });
});
