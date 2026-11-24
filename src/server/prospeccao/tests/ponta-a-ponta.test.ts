/** Monta ZIPs falsos no formato da Receita, carrega no DuckDB e gera a lista pela CLI. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import yazl from "yazl";
import { lerCsv } from "../csv.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function zip(pasta: string, nome: string, linhas: string[][]): Promise<void> {
  const conteudo = linhas.map((l) => l.map((c) => `"${c}"`).join(";")).join("\n");
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from(conteudo, "latin1"), `K3241.${nome.toUpperCase()}CSV`);
  z.end();
  return new Promise((ok, erro) => {
    z.outputStream.pipe(createWriteStream(path.join(pasta, `${nome}.zip`))).on("close", ok).on("error", erro);
  });
}

const estab = (basico: string, fantasia: string, cnae: string, ddd: string, tel: string,
  { uf = "PR", mun = "7535", situacao = "02", email = "" } = {}) =>
  [basico, "0001", "00", "1", fantasia, situacao, "20200101", "00", "", "", "20150310", cnae, "",
    "AVENIDA", "SETE DE SETEMBRO", "1500", "", "BATEL", "80420090", uf, mun, ddd, tel, "", "", "", "",
    email, "", ""];

// cwd = raiz do projeto: o "--import tsx" é resolvido a partir dela (todos os outros caminhos são absolutos)
function cli(script: string, args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", path.join(RAIZ, script), ...args],
    { cwd: RAIZ, encoding: "utf8" });
}

describe("ponta a ponta", () => {
  let tmp = "", db = "";

  before(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "prospeccao-"));
    const z = path.join(tmp, "zips");
    await mkdir(z);
    await zip(z, "Cnaes", [["8630503", "Atividade médica ambulatorial restrita a consultas"],
      ["8630504", "Atividade odontológica"], ["5611201", "Restaurantes e similares"]]);
    await zip(z, "Municipios", [["7535", "CURITIBA"], ["7691", "MARINGA"]]);
    await zip(z, "Estabelecimentos0", [
      estab("11111111", "DERMA CURITIBA", "8630503", "41", "999998888", { email: "contato@dermacuritiba.com.br" }),
      estab("22222222", "", "8630503", "41", "30000000"),             // clínica genérica (sem DERMA/PELE)
      estab("33333333", "PELE & CIA", "8630503", "41", "32223333"),   // telefone de contabilidade
      estab("44444444", "DERMA MEI", "8630503", "41", "988887777"),   // MEI -> fora
      estab("55555555", "DERMA SP", "8630503", "11", "988887777", { uf: "SP" }),
      estab("66666666", "DERMA BAIXADA", "8630503", "41", "988880000", { situacao: "08" }),
    ]);
    await zip(z, "Estabelecimentos1",
      Array.from({ length: 5 }, (_, i) => estab(`9${String(i).padStart(7, "0")}`, "", "5611201", "41", "32223333")));
    await zip(z, "Empresas0", [
      ["11111111", "INSTITUTO DERMATOLOGICO LTDA", "2062", "49", "150000,00", "05", ""],
      ["22222222", "CLINICA MEDICA BOA VIDA LTDA", "2062", "49", "10000,00", "01", ""],
      ["33333333", "CLINICA DA PELE LTDA", "2062", "49", "5000,00", "01", ""],
      ["44444444", "JOAO DERMA", "2135", "50", "1000,00", "01", ""],
      ...Array.from({ length: 5 }, (_, i) => [`9${String(i).padStart(7, "0")}`, `RESTAURANTE ${i}`, "2062", "49", "1,00", "01", ""]),
    ]);
    await zip(z, "Socios0", [
      ["11111111", "2", "JOSE SOUZA", "***654321**", "22", "20100101", "", "", "", "", "5"],
      ["11111111", "2", "MARIA SILVA", "***123456**", "49", "20150310", "", "", "", "", "5"],
    ]);
    await zip(z, "Simples", [
      ["44444444", "S", "20200101", "", "S", "20200101", ""],
      ["33333333", "S", "20200101", "", "N", "", ""],
    ]);
    db = path.join(tmp, "t.duckdb");
    cli("carregar-receita.ts", ["--zips", z, "--db", db, "--uf", "PR"]);
  });

  async function gerar(...extra: string[]) {
    const saida = path.join(tmp, "lista.csv");
    const out = cli("gerar-lista.ts", ["--db", db, "--segmento", "dermatologia", "--uf", "PR",
      "--municipio", "Curitiba", "--saida", saida, "--reexibir-apos-dias", "0", ...extra]);
    return { linhas: await lerCsv(saida), out };
  }

  it("gera a lista filtrada e ordenada", async () => {
    const { linhas, out } = await gerar();
    assert.match(out, /nome contém DERMA\/PELE/);
    assert.deepEqual(linhas.map((l) => l.cnpj), ["11111111000100", "33333333000100"]);
    const [primeiro, segundo] = linhas;
    assert.equal(primeiro.decisor, "MARIA SILVA");        // sócio-administrador antes de sócio
    assert.equal(primeiro.tipo_telefone, "celular");
    assert.equal(primeiro.email_tipo, "proprio");
    assert.equal(segundo.telefone_contabilidade, "sim");  // mesmo número em 6 empresas
  });

  it("esconde quem só tem telefone de contabilidade", async () => {
    const { linhas } = await gerar("--esconder-contabilidade");
    assert.deepEqual(linhas.map((l) => l.cnpj), ["11111111000100"]);
  });

  it("não repete quem já foi exportado", () => {
    const args = ["--db", db, "--segmento", "dermatologia", "--uf", "PR", "--saida", path.join(tmp, "h.csv")];
    cli("gerar-lista.ts", args);
    assert.match(cli("gerar-lista.ts", args), / 0 exportadas/);
  });
});
