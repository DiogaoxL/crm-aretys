/** Catálogo de segmentos (Anexo A do guia) e busca de CNAE pela descrição. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Banco } from "../db.js";
import { cnaesDoSegmento, lerSegmentos } from "../gerar-lista.js";
import { secaoDoCnae } from "../secoes-cnae.js";
import { AREA_NICHOS, criarServico } from "../servico.js";

describe("segmentos", () => {
  it("catálogo completo do Anexo A, sem slug repetido", async () => {
    const segs = await lerSegmentos();
    assert.equal(segs.length, 213);
    assert.equal(new Set(segs.map((s) => s.nicho)).size, 20);
    assert.equal(new Set(segs.map((s) => s.slug)).size, segs.length, "slugs únicos");
    for (const s of segs) {
      assert.ok(s.nome && s.nicho && (s.keywords.length || s.cnaes?.length), s.slug);
    }
  });

  it("casa trechos com vírgula, hífen e acento com a descrição oficial do CNAE", async () => {
    const db = await Banco.abrir(path.join(await mkdtemp(path.join(tmpdir(), "segs-")), "c.duckdb"));
    await db.exec("CREATE TABLE cnaes (codigo VARCHAR, descricao VARCHAR)");
    await db.exec(`INSERT INTO cnaes VALUES
      ('5611203', 'Lanchonetes, casas de chá, de sucos e similares'),
      ('2449199', 'Metalurgia de outros metais não-ferrosos e suas ligas não especificados anteriormente'),
      ('8630504', 'Atividade odontológica')`);
    const seg = (keywords: string[]) => ({ slug: "x", nome: "x", keywords, name_stems: [] });
    const codigos = async (k: string[]) => (await cnaesDoSegmento(db, seg(k))).map((c) => c.codigo);
    assert.deepEqual(await codigos(["lanchonetes, casas de cha, de sucos e similares"]), ["5611203"]);
    assert.deepEqual(await codigos(["metais nao-ferrosos"]), ["2449199"]);
    assert.deepEqual(await codigos(["atividade odontologica"]), ["8630504"]);
    assert.deepEqual(await codigos(["padaria"]), []);
    db.fechar();
  });

  it("seção da CNAE pelo código", () => {
    assert.equal(secaoDoCnae("8630503")?.letra, "Q");
    assert.equal(secaoDoCnae("0111301")?.letra, "A");
    assert.equal(secaoDoCnae("4120400")?.letra, "F");
    assert.equal(secaoDoCnae("9900800")?.letra, "U");
    assert.equal(secaoDoCnae("0400000"), null); // divisão 04 não existe
  });

  it("catálogo sai da base: um segmento por CNAE com empresas, mais os nichos", async () => {
    const pasta = await mkdtemp(path.join(tmpdir(), "catalogo-"));
    const arquivoDb = path.join(pasta, "r.duckdb");
    const db = await Banco.abrir(arquivoDb);
    await db.exec("CREATE TABLE cnaes (codigo VARCHAR, descricao VARCHAR)");
    await db.exec(`INSERT INTO cnaes VALUES ('8630503', 'Atividade médica ambulatorial restrita a consultas'),
      ('5611201', 'Restaurantes e similares'), ('0111301', 'Cultivo de arroz')`);
    await db.exec(`CREATE TABLE estabelecimentos (cnpj_basico VARCHAR, cnae_fiscal_principal VARCHAR, identificador_matriz_filial VARCHAR)`);
    await db.exec(`INSERT INTO estabelecimentos VALUES ('1', '8630503', '1'), ('2', '8630503', '1'), ('3', '8630503', '2'),
      ('4', '5611201', '1'), ('5', '5611201', '1')`);
    await db.exec("CREATE TABLE simples (cnpj_basico VARCHAR, opcao_mei VARCHAR)");
    await db.exec("INSERT INTO simples VALUES ('5', 'S')"); // MEI não conta
    db.fechar();

    // Carga interrompida (sem a marca de carga completa): não é base pronta e não gera catálogo por CNAE.
    const interrompida = criarServico({ arquivoDb, pastaDados: pasta });
    const st = await interrompida.status();
    assert.equal(st.carregado, false);
    assert.equal((st as { incompleta?: boolean }).incompleta, true);
    assert.equal((await interrompida.segmentos()).filter((s) => s.tipo === "cnae").length, 0);
    await interrompida.fechar();
    const db2 = await Banco.abrir(arquivoDb);
    await db2.exec("INSERT INTO receita_meta VALUES ('carga_completa', '2026-11-23')");
    db2.fechar();

    const servico = criarServico({ arquivoDb, pastaDados: pasta });
    const cat = await servico.segmentos();
    const porCnae = cat.filter((s) => s.tipo === "cnae");
    assert.deepEqual(porCnae.map((s) => [s.slug, s.empresas, s.area]), [
      ["cnae-5611201", 1, "I · Alojamento e alimentação"],      // 1 matriz sem MEI
      ["cnae-8630503", 2, "Q · Saúde humana e serviços sociais"], // filial não conta
    ]); // cultivo de arroz: nenhuma empresa → fora do catálogo
    assert.equal(cat.filter((s) => s.area === AREA_NICHOS).length, 213);
    assert.deepEqual(cat.slice(0, porCnae.length), porCnae, "CNAEs primeiro, nichos no fim");
    await servico.fechar();
  });
});
