/**
 * Confere se cada empresa da lista existe no Google (card do Google Maps / Perfil da Empresa).
 *
 *   $env:GOOGLE_PLACES_API_KEY="..."
 *   npm run google -- dermatologia-pr-20261123-1030.csv
 *   npm run google -- lista.csv --detalhes            # + telefone, site e nota dos confirmados
 *   npm run google -- lista.csv --provedor serper     # usa SERPER_API_KEY
 *
 * Faixa gratuita mensal (Google Places API New):
 *   Text Search Pro ............ 5.000/mês  -> toda verificação
 *   Place Details Enterprise ... 1.000/mês  -> só com --detalhes, só confirmados/prováveis
 * O uso fica gravado no banco e o script PARA antes de passar dos limites.
 * Resultados ficam em cache por CNPJ (90 dias): rodar de novo a mesma lista não gasta nada.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { escreverCsv, lerCsv } from "./csv.js";
import { Banco } from "./db.js";
import {
  classificarMatch, classificarTelefone, scoreMatchGoogle, soDigitos,
  type LeadParaMatch, type Place, type StatusGoogle,
} from "./regras.js";

const CAMPOS_PRO = [
  "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents",
  "places.businessStatus", "places.googleMapsUri", "places.primaryTypeDisplayName",
].join(",");
const CAMPOS_DETALHES = "nationalPhoneNumber,websiteUri,rating,userRatingCount";

export type Sku = "places_pro" | "places_enterprise" | "serper";

export class CotaEsgotada extends Error {}

async function http<T>(url: string, init: { corpo?: unknown; headers: Record<string, string> }): Promise<T> {
  const r = await fetch(url, {
    method: init.corpo === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...init.headers },
    body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Erro ${r.status} em ${url}: ${(await r.text()).slice(0, 500)}`);
  return (await r.json()) as T;
}

/** Contador mensal de chamadas por SKU, gravado no banco. */
export class Uso {
  readonly mes = new Date().toISOString().slice(0, 7);

  private constructor(private db: Banco, readonly limites: Record<Sku, number>) {}

  static async criar(db: Banco, limites: Record<Sku, number>) {
    await db.exec(`CREATE TABLE IF NOT EXISTS google_uso (mes VARCHAR, sku VARCHAR, chamadas INTEGER,
                   PRIMARY KEY (mes, sku))`);
    return new Uso(db, limites);
  }

  async usado(sku: Sku): Promise<number> {
    return Number((await this.db.valor("SELECT chamadas FROM google_uso WHERE mes = ? AND sku = ?", [this.mes, sku])) ?? 0);
  }

  async gastar(sku: Sku): Promise<void> {
    if ((await this.usado(sku)) >= this.limites[sku]) {
      throw new CotaEsgotada(`limite mensal de ${sku} atingido (${this.limites[sku]})`);
    }
    await this.db.exec(`INSERT INTO google_uso VALUES (?, ?, 1)
                        ON CONFLICT (mes, sku) DO UPDATE SET chamadas = chamadas + 1`, [this.mes, sku]);
  }
}

// ------------------------------------------------------------------ provedores

export interface Provedor {
  nome: "google" | "serper";
  buscar(consulta: string): Promise<Place[]>;
  detalhes(placeId: string): Promise<Partial<Place>>;
}

export class GooglePlaces implements Provedor {
  nome = "google" as const;
  constructor(private chave: string, private uso: Uso) {}

  async buscar(consulta: string): Promise<Place[]> {
    await this.uso.gastar("places_pro");
    const r = await http<{ places?: Place[] }>("https://places.googleapis.com/v1/places:searchText", {
      corpo: { textQuery: consulta, languageCode: "pt-BR", regionCode: "BR", pageSize: 5 },
      headers: { "X-Goog-Api-Key": this.chave, "X-Goog-FieldMask": CAMPOS_PRO },
    });
    return r.places ?? [];
  }

  async detalhes(placeId: string): Promise<Partial<Place>> {
    await this.uso.gastar("places_enterprise");
    return http<Partial<Place>>(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=pt-BR`, {
      headers: { "X-Goog-Api-Key": this.chave, "X-Goog-FieldMask": CAMPOS_DETALHES },
    });
  }
}

interface SerperPlace {
  title?: string; address?: string; phoneNumber?: string; website?: string;
  rating?: number; ratingCount?: number; category?: string; cid?: string;
}

/** google.serper.dev/places — créditos pré-pagos (2.500 grátis no cadastro). Já traz telefone e site. */
export class Serper implements Provedor {
  nome = "serper" as const;
  constructor(private chave: string, private uso: Uso) {}

  async buscar(consulta: string): Promise<Place[]> {
    await this.uso.gastar("serper");
    const r = await http<{ places?: SerperPlace[] }>("https://google.serper.dev/places", {
      corpo: { q: consulta, gl: "br", hl: "pt-br" },
      headers: { "X-API-KEY": this.chave },
    });
    return (r.places ?? []).map(Serper.converter);
  }

  /** Deixa o resultado do Serper no mesmo formato do Google Places. */
  static converter(p: SerperPlace): Place {
    const end = p.address ?? "";
    const comps: NonNullable<Place["addressComponents"]> = [];
    let m: RegExpMatchArray | null;
    if ((m = end.match(/\b(\d{5})-?(\d{3})\b/))) comps.push({ longText: m[1] + m[2], types: ["postal_code"] });
    if ((m = end.match(/,\s*(\d+)\b/))) comps.push({ longText: m[1], types: ["street_number"] });
    if ((m = end.match(/,\s*([^,\-]+?)\s*-\s*[A-Z]{2}\b/))) {
      comps.push({ longText: m[1], types: ["administrative_area_level_2"] });
    }
    return {
      id: p.cid, displayName: { text: p.title ?? "" }, formattedAddress: end, addressComponents: comps,
      nationalPhoneNumber: p.phoneNumber ?? null, websiteUri: p.website ?? null,
      rating: p.rating ?? null, userRatingCount: p.ratingCount ?? null,
      googleMapsUri: p.cid ? `https://maps.google.com/?cid=${p.cid}` : undefined,
      primaryTypeDisplayName: { text: p.category ?? "" },
    };
  }

  async detalhes(): Promise<Partial<Place>> {
    return {}; // o Serper já devolve telefone/site/nota na busca
  }
}

// ------------------------------------------------------------------ verificação

export interface ResultadoGoogle {
  google_status: StatusGoogle;
  google_score: number;
  google_sinais?: string;
  google_nome?: string;
  google_categoria?: string;
  google_endereco?: string;
  google_maps?: string;
  google_situacao?: string;
  google_telefone?: string;
  google_site?: string;
  google_nota?: number | string;
  google_avaliacoes?: number | string;
}

export type LinhaLista = Record<string, string>;
/** Linha da lista com o resultado do Google (google_score é número). */
export type LinhaVerificada = Record<string, string | number | undefined> & ResultadoGoogle;

/** Converte uma linha do CSV de gerar-lista para o formato usado no match. */
export function leadDaLinha(r: LinhaLista): LeadParaMatch {
  const telefones: { e164: string }[] = [];
  for (const bruto of [r.telefone_principal ?? "", ...(r.outros_telefones ?? "").split("/")]) {
    const d = soDigitos(bruto);
    const t = d.length >= 10 ? classificarTelefone(d.slice(0, 2), d.slice(2)) : null;
    if (t) telefones.push({ e164: t.e164 });
  }
  return {
    ...r, telefones, razaoSocial: r.razao_social, nomeFantasia: r.nome_fantasia,
    cep: r.cep, numero: r.numero, municipio: r.municipio,
  };
}

export function consultas(r: LinhaLista): string[] {
  const nome = (r.nome_fantasia || r.razao_social || "").trim();
  const cidade = `${r.municipio ?? ""} ${r.uf ?? ""}`.trim();
  const endereco = `${r.endereco ?? ""} ${r.numero ?? ""}`.trim();
  const q = [`${nome} ${endereco} ${cidade}`, `${nome} ${cidade}`];
  if (r.nome_fantasia && r.razao_social) q.push(`${r.razao_social} ${cidade}`);
  return [...new Set(q.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function verificarEmpresa(r: LinhaLista, prov: Provedor, detalhes: boolean): Promise<ResultadoGoogle> {
  const lead = leadDaLinha(r);
  let melhor: Place | null = null, melhorScore = -999, melhorSinais: string[] = [];

  for (const q of consultas(r)) {
    for (const place of await prov.buscar(q)) {
      const { score, sinais } = scoreMatchGoogle(lead, place);
      if (score > melhorScore) [melhor, melhorScore, melhorSinais] = [place, score, sinais];
    }
    if (melhorScore >= 60) break; // já confirmou, não gasta outra chamada
    await pausa(100);
  }
  if (!melhor) return { google_status: "nao_encontrado", google_score: 0 };

  if (detalhes && prov.nome === "google" && melhorScore >= 35 && melhor.id) {
    melhor = { ...melhor, ...(await prov.detalhes(melhor.id)) };
    ({ score: melhorScore, sinais: melhorSinais } = scoreMatchGoogle(lead, melhor)); // agora com telefone
  }

  return {
    google_status: classificarMatch(melhorScore, melhor.businessStatus),
    google_score: melhorScore,
    google_sinais: melhorSinais.join(","),
    google_nome: melhor.displayName?.text ?? "",
    google_categoria: melhor.primaryTypeDisplayName?.text ?? "",
    google_endereco: melhor.formattedAddress ?? "",
    google_maps: melhor.googleMapsUri ?? "",
    google_situacao: melhor.businessStatus ?? "",
    google_telefone: melhor.nationalPhoneNumber ?? "",
    google_site: melhor.websiteUri ?? "",
    google_nota: melhor.rating ?? "",
    google_avaliacoes: melhor.userRatingCount ?? "",
  };
}

export interface OpcoesVerificacao {
  provedor: Provedor;
  detalhes?: boolean;
  cacheDias?: number;
  aoProgredir?: (i: number, total: number, status: StatusGoogle, linha: LinhaLista) => void;
}

/** Verifica uma lista inteira, com cache por CNPJ. Para (sem lançar) quando a cota do mês acaba. */
export async function verificarLista(db: Banco, linhas: LinhaLista[], o: OpcoesVerificacao) {
  await db.exec(`CREATE TABLE IF NOT EXISTS google_cache (cnpj VARCHAR, provedor VARCHAR,
                 consultado_em TIMESTAMP, resultado VARCHAR, PRIMARY KEY (cnpj, provedor))`);
  const saida: LinhaVerificada[] = [];
  let erroCota: string | null = null;

  try {
    for (const [i, r] of linhas.entries()) {
      const cache = await db.valor<string>(
        `SELECT resultado FROM google_cache WHERE cnpj = ? AND provedor = ?
         AND consultado_em > current_timestamp - to_days(CAST(? AS INTEGER))`,
        [r.cnpj, o.provedor.nome, o.cacheDias ?? 90]);
      const anterior = cache ? (JSON.parse(cache) as ResultadoGoogle) : null;
      const faltaDetalhe = !!o.detalhes && !!anterior && !anterior.google_telefone &&
        (anterior.google_status === "confirmado" || anterior.google_status === "provavel");

      let res: ResultadoGoogle;
      if (anterior && !faltaDetalhe) res = anterior;
      else {
        res = await verificarEmpresa(r, o.provedor, !!o.detalhes);
        await db.exec("INSERT OR REPLACE INTO google_cache VALUES (?, ?, current_timestamp, ?)",
          [r.cnpj, o.provedor.nome, JSON.stringify(res)]);
      }
      saida.push({ ...r, ...res });
      o.aoProgredir?.(i + 1, linhas.length, res.google_status, r);
    }
  } catch (e) {
    if (!(e instanceof CotaEsgotada)) throw e;
    erroCota = e.message;
    for (const r of linhas.slice(saida.length)) saida.push({ ...r, google_status: "nao_verificado", google_score: 0 });
  }
  return { linhas: saida, erroCota };
}

export const COLUNAS_GOOGLE = [
  "google_status", "google_score", "google_sinais", "google_nome", "google_categoria", "google_endereco",
  "google_maps", "google_situacao", "google_telefone", "google_site", "google_nota", "google_avaliacoes",
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: a, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      db: { type: "string", default: "receita.duckdb" },
      provedor: { type: "string", default: "google" },
      detalhes: { type: "boolean", default: false },
      "limite-pro": { type: "string", default: "4800" },
      "limite-enterprise": { type: "string", default: "950" },
      // buscas de Maps no Serper são relatadas como 3 créditos cada (2.500 créditos ≈ 800 buscas)
      "limite-serper": { type: "string", default: "800" },
      "cache-dias": { type: "string", default: "90" },
      saida: { type: "string" },
    },
  });
  const lista = positionals[0];
  if (!lista) {
    console.error("Uso: npm run google -- <lista.csv> [--detalhes] [--provedor google|serper]");
    process.exit(1);
  }
  const variavel = a.provedor === "serper" ? "SERPER_API_KEY" : "GOOGLE_PLACES_API_KEY";
  const chave = process.env[variavel];
  if (!chave) {
    console.error(`Defina a variável de ambiente ${variavel}.`);
    process.exit(1);
  }

  const db = await Banco.abrir(a.db!);
  const uso = await Uso.criar(db, {
    places_pro: Number(a["limite-pro"]),
    places_enterprise: Number(a["limite-enterprise"]),
    serper: Number(a["limite-serper"]),
  });
  const provedor = a.provedor === "serper" ? new Serper(chave, uso) : new GooglePlaces(chave, uso);

  const linhas = await lerCsv(lista);
  const r = await verificarLista(db, linhas, {
    provedor, detalhes: a.detalhes, cacheDias: Number(a["cache-dias"]),
    aoProgredir: (i, total, status, l) =>
      process.stdout.write(`\r${i}/${total} ${status.padEnd(15)} ${(l.razao_social ?? "").slice(0, 50).padEnd(50)}`),
  });
  process.stdout.write("\n");
  if (r.erroCota) console.error(`Parou: ${r.erroCota}. As linhas restantes ficaram como nao_verificado.`);

  const saida = a.saida ?? path.join(path.dirname(lista), `${path.basename(lista, ".csv")}-google.csv`);
  const colunas = [...Object.keys(linhas[0] ?? {}), ...COLUNAS_GOOGLE];
  await escreverCsv(saida, colunas, r.linhas as Record<string, unknown>[]);

  const contagem = new Map<string, number>();
  for (const l of r.linhas) contagem.set(l.google_status, (contagem.get(l.google_status) ?? 0) + 1);
  console.log([...contagem].sort().map(([k, v]) => `${k}: ${v}`).join(" · "));
  for (const sku of Object.keys(uso.limites) as Sku[]) {
    const n = await uso.usado(sku);
    if (n) console.log(`Uso do mês ${uso.mes} — ${sku}: ${n}/${uso.limites[sku]}`);
  }
  console.log(`Salvo em ${saida}`);
}
