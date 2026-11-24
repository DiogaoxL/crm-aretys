/** CSV com ";" (abre direto no Excel em português). */
import { readFile, writeFile } from "node:fs/promises";

const escapar = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function escreverCsv(arquivo: string, colunas: string[], linhas: Record<string, unknown>[]) {
  const corpo = [colunas.join(";"), ...linhas.map((l) => colunas.map((c) => escapar(l[c])).join(";"))];
  await writeFile(arquivo, "﻿" + corpo.join("\r\n") + "\r\n", "utf8"); // BOM: acentos certos no Excel
}

export async function lerCsv(arquivo: string): Promise<Record<string, string>[]> {
  const texto = (await readFile(arquivo, "utf8")).replace(/^﻿/, "");
  const registros: string[][] = [];
  let campo = "", registro: string[] = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") { registro.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      registro.push(campo); campo = "";
      if (registro.some((x) => x !== "")) registros.push(registro);
      registro = [];
    } else campo += c;
  }
  if (campo || registro.length) { registro.push(campo); registros.push(registro); }
  const [cabecalho, ...resto] = registros;
  if (!cabecalho) return [];
  return resto.map((r) => Object.fromEntries(cabecalho.map((c, i) => [c, r[i] ?? ""])));
}
