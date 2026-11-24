import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classificarMatch, classificarTelefone, normalizar, scoreLead, scoreMatchGoogle, similaridadeNome, type Place,
} from "../regras.js";
import { Serper, consultas } from "../verificar-google.js";

describe("regras", () => {
  it("normaliza nomes", () => {
    assert.equal(normalizar("Clínica São José — Ltda."), "CLINICA SAO JOSE LTDA");
  });

  it("classifica telefones", () => {
    assert.equal(classificarTelefone("41", "999998888")?.tipo, "celular");
    assert.equal(classificarTelefone("41", "33321900")?.tipo, "fixo");
    assert.equal(classificarTelefone("41", "33321900")?.exibicao, "(41) 3332-1900");
    const antigo = classificarTelefone("041", "99998888");
    assert.deepEqual([antigo?.tipo, antigo?.e164], ["celular_antigo", "+5541999998888"]);
    assert.equal(classificarTelefone("41", "00000000"), null);
    assert.equal(classificarTelefone("", "33321900"), null);
    assert.equal(classificarTelefone("41", "123"), null);
  });

  it("prefere celular próprio a número de contabilidade", () => {
    const base = { decisor: "MARIA", matriz: true, porte: "01", dataInicio: "20180101" };
    const hoje = new Date("2026-11-23");
    const proprio = scoreLead({ ...base, telefones: [{ e164: "x", tipo: "celular", compartilhado: 1 }] }, 3, hoje);
    const contab = scoreLead({ ...base, telefones: [{ e164: "y", tipo: "fixo", compartilhado: 40 }] }, 3, hoje);
    assert.ok(proprio.score > contab.score + 15, `${proprio.score} vs ${contab.score}`);
  });

  it("compara nomes", () => {
    assert.ok(similaridadeNome("ODONTO SERRA LTDA", "Odonto Serra") >= 0.9);
    assert.ok(similaridadeNome("CLINICA ODONTO SERRA", "Odonto Serra") >= 0.6);
    assert.ok(similaridadeNome("ODONTO SERRA", "Padaria Pão Quente") < 0.34);
  });
});

describe("match no Google", () => {
  const place = (nome: string, cep: string, numero: string, cidade = "Curitiba", tel?: string): Place => ({
    displayName: { text: nome }, nationalPhoneNumber: tel,
    addressComponents: [
      { longText: cep, types: ["postal_code"] },
      { longText: numero, types: ["street_number"] },
      { longText: cidade, types: ["administrative_area_level_2"] },
    ],
  });
  const lead = {
    razaoSocial: "ODONTO SERRA LTDA", nomeFantasia: "", cep: "80420090", numero: "1500",
    municipio: "CURITIBA", telefones: [{ e164: "+554130784410" }],
  };

  it("confirma por CEP + número + nome", () => {
    const { score } = scoreMatchGoogle(lead, place("Odonto Serra", "80420-090", "1500"));
    assert.equal(classificarMatch(score, "OPERATIONAL"), "confirmado");
    assert.equal(classificarMatch(score, "CLOSED_PERMANENTLY"), "fechado");
  });

  it("usa o telefone quando disponível", () => {
    const { sinais } = scoreMatchGoogle(lead, place("Odonto Serra", "80420-090", "1500", "Curitiba", "(41) 3078-4410"));
    assert.ok(sinais.includes("telefone"));
  });

  it("rejeita outra empresa em outra cidade", () => {
    const { score } = scoreMatchGoogle(lead, place("Pizzaria do Zé", "01310-100", "10", "São Paulo"));
    assert.equal(classificarMatch(score, "OPERATIONAL"), "nao_encontrado");
  });

  it("converte o resultado do Serper", () => {
    const p = Serper.converter({
      title: "Odonto Serra", cid: "123", phoneNumber: "(41) 3078-4410",
      address: "Av. Sete de Setembro, 1500 - Batel, Curitiba - PR, 80420-090",
    });
    const { sinais } = scoreMatchGoogle(lead, p);
    for (const s of ["cep", "numero", "nome", "telefone"]) assert.ok(sinais.includes(s), sinais.join(","));
  });

  it("monta as consultas sem repetir", () => {
    assert.deepEqual(
      consultas({ nome_fantasia: "", razao_social: "ODONTO SERRA LTDA", endereco: "AVENIDA SETE", numero: "1500",
        municipio: "CURITIBA", uf: "PR" }),
      ["ODONTO SERRA LTDA AVENIDA SETE 1500 CURITIBA PR", "ODONTO SERRA LTDA CURITIBA PR"],
    );
  });
});
