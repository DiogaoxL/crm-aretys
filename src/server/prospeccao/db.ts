/** Acesso mínimo ao DuckDB (@duckdb/node-api). Troque por Postgres na sua aplicação se preferir: o SQL é quase o mesmo. */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export type Param = string | number | boolean | null;

export class Banco {
  private constructor(private readonly instancia: DuckDBInstance, private readonly con: DuckDBConnection) {}

  static async abrir(arquivo: string): Promise<Banco> {
    mkdirSync(path.dirname(path.resolve(arquivo)), { recursive: true }); // ex.: dados/receita.duckdb
    const instancia = await DuckDBInstance.create(arquivo);
    return new Banco(instancia, await instancia.connect());
  }

  /** Libera o arquivo (o DuckDB aceita um único processo escrevendo nele). */
  fechar(): void {
    this.con.closeSync();
    this.instancia.closeSync();
  }

  async exec(sql: string, params: Param[] = []): Promise<void> {
    await this.con.run(sql, params);
  }

  async linhas<T = Record<string, unknown>>(sql: string, params: Param[] = []): Promise<T[]> {
    const r = await this.con.runAndReadAll(sql, params);
    // getRowObjectsJS converte tipos do DuckDB (BIGINT, BOOLEAN...) para tipos JS
    return r.getRowObjectsJS() as T[];
  }

  async valor<T = unknown>(sql: string, params: Param[] = []): Promise<T | undefined> {
    const [linha] = await this.linhas(sql, params);
    return linha ? (Object.values(linha)[0] as T) : undefined;
  }
}

/** "?, ?, ?" para n parâmetros. */
export const marcadores = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** Literal SQL para constantes do próprio código (nunca para entrada do usuário). */
export const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
