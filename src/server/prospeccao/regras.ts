/** Regras puras (sem banco, sem rede): normalização, telefones, score do lead e match no Google. */

export const EMAILS_GRATUITOS = new Set([
  "gmail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "live.com",
  "msn.com", "yahoo.com", "yahoo.com.br", "bol.com.br", "uol.com.br", "terra.com.br",
  "ig.com.br", "icloud.com", "globo.com", "r7.com", "zipmail.com.br",
]);

/**
 * Ordem de preferência do "decisor" no quadro de sócios (códigos de qualificação da Receita):
 * 49 Sócio-Administrador · 65 Titular PF · 05 Administrador · 16 Presidente · 10 Diretor · 22 Sócio
 */
export const QUALIFICACOES_DECISOR = ["49", "65", "05", "16", "10", "22"] as const;

const PALAVRAS_IGNORADAS_NOME = new Set([
  "LTDA", "ME", "EPP", "EIRELI", "SA", "S", "A", "SLU", "CIA", "DE", "DA", "DO", "DAS", "DOS",
  "E", "EM", "COMERCIO", "SERVICOS", "SERVICO", "MEI", "UNIPESSOAL", "LIMITADA",
]);

/** Maiúsculas, sem acento, só letras/números/espaço. */
export function normalizar(texto?: string | null): string {
  if (!texto) return "";
  return texto
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const soDigitos = (texto?: string | null): string => (texto ?? "").replace(/\D/g, "");

// ------------------------------------------------------------------ telefones

export type TipoTelefone = "celular" | "celular_antigo" | "fixo";

export interface Telefone {
  e164: string;      // +5541999998888
  exibicao: string;  // (41) 99999-8888
  tipo: TipoTelefone;
}

/** Telefone da Receita (DDD e número separados). Devolve null se inválido. */
export function classificarTelefone(ddd?: string | null, numero?: string | null): Telefone | null {
  let d = soDigitos(ddd);
  let n = soDigitos(numero);
  if (d.length === 3 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 2 || d[0] === "0" || d[1] === "0") return null;

  let tipo: TipoTelefone;
  if (n.length === 9 && n[0] === "9") tipo = "celular";
  else if (n.length === 8 && "2345".includes(n[0])) tipo = "fixo";
  else if (n.length === 8 && "6789".includes(n[0])) {
    n = "9" + n; // celular cadastrado antes do 9º dígito
    tipo = "celular_antigo";
  } else return null;

  if (new Set(n).size === 1) return null; // 99999-9999, 0000-0000...
  const meio = n.length === 9 ? 5 : 4;
  return { e164: `+55${d}${n}`, exibicao: `(${d}) ${n.slice(0, meio)}-${n.slice(meio)}`, tipo };
}

export function dominioEmail(email?: string | null): string {
  const e = (email ?? "").trim().toLowerCase();
  const i = e.lastIndexOf("@");
  return i >= 0 ? e.slice(i + 1) : "";
}

// ------------------------------------------------------------------ score do lead

export interface TelefoneLead {
  e164: string;
  exibicao?: string;
  tipo?: TipoTelefone;
  /** Em quantas empresas esse número aparece na base (>= limite ⇒ provável contabilidade). */
  compartilhado?: number;
}

export interface LeadParaScore {
  telefones: TelefoneLead[];
  decisor?: string | null;
  email?: string | null;
  emailCompartilhado?: number;
  matriz?: boolean;
  dataInicio?: string | null;     // AAAAMMDD
  capitalSocial?: string | null;  // "150000,00"
  porte?: string | null;          // 01 ME · 03 EPP · 05 Demais
  nomeFantasia?: string | null;
}

export function idadeAnos(dataInicio?: string | null, hoje = new Date()): number | null {
  const s = soDigitos(dataInicio);
  if (s.length !== 8) return null;
  const inicio = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6)));
  if (Number.isNaN(inicio.getTime())) return null;
  return (hoje.getTime() - inicio.getTime()) / (365.25 * 86_400_000);
}

export function capitalSocial(valor?: string | null): number {
  const n = Number((valor ?? "0").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Score 0–100 para ordenar a lista de ligação. */
export function scoreLead(
  lead: LeadParaScore,
  limiteCompartilhado = 3,
  hoje = new Date(),
): { score: number; motivos: string[] } {
  let pts = 0;
  const motivos: string[] = [];

  const proprios = lead.telefones.filter((t) => (t.compartilhado ?? 1) < limiteCompartilhado);
  if (proprios.some((t) => t.tipo?.startsWith("celular"))) {
    pts += 25; motivos.push("celular próprio");
  } else if (proprios.length) {
    pts += 15; motivos.push("fixo próprio");
  } else if (lead.telefones.length) {
    pts += 3; motivos.push("só telefone compartilhado (provável contabilidade)");
  }

  if (lead.decisor) { pts += 15; motivos.push("decisor no QSA"); }

  const dom = dominioEmail(lead.email);
  const emailProprioDaEmpresa = (lead.emailCompartilhado ?? 1) < limiteCompartilhado;
  if (dom && !EMAILS_GRATUITOS.has(dom) && emailProprioDaEmpresa) {
    pts += 10; motivos.push("e-mail de domínio próprio");
  } else if (dom && emailProprioDaEmpresa) pts += 4;

  if (lead.matriz) pts += 5;

  const idade = idadeAnos(lead.dataInicio, hoje);
  if (idade !== null) {
    if (idade >= 10) pts += 8;
    else if (idade >= 3) { pts += 10; motivos.push(`${Math.round(idade)} anos de empresa`); }
    else if (idade >= 1) pts += 5;
  }

  const cap = capitalSocial(lead.capitalSocial);
  if (cap >= 100_000) { pts += 10; motivos.push("capital ≥ 100 mil"); }
  else if (cap >= 20_000) pts += 6;
  else if (cap > 0) pts += 2;

  pts += ({ "01": 4, "03": 8, "05": 10 } as Record<string, number>)[lead.porte ?? ""] ?? 0;
  if ((lead.nomeFantasia ?? "").trim()) pts += 4;

  return { score: Math.min(pts, 100), motivos };
}

// ------------------------------------------------------------------ match no Google

/** Formato (subconjunto) de um Place da Google Places API (New). O Serper é convertido para ele. */
export interface Place {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  businessStatus?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
  nationalPhoneNumber?: string | null;
  websiteUri?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
}

export interface LeadParaMatch {
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  cep?: string | null;
  numero?: string | null;
  municipio?: string | null;
  telefones: { e164: string }[];
}

const tokens = (nome: string) =>
  new Set(normalizar(nome).split(" ").filter((t) => t.length > 1 && !PALAVRAS_IGNORADAS_NOME.has(t)));

function bigramas(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
  return m;
}

/** Coeficiente de Dice sobre bigramas (substitui o SequenceMatcher do Python). */
function dice(a: string, b: string): number {
  const ba = bigramas(a), bb = bigramas(b);
  let inter = 0, total = 0;
  for (const [k, v] of ba) { inter += Math.min(v, bb.get(k) ?? 0); total += v; }
  for (const v of bb.values()) total += v;
  return total ? (2 * inter) / total : 0;
}

export function similaridadeNome(a?: string | null, b?: string | null): number {
  const ta = tokens(a ?? ""), tb = tokens(b ?? "");
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = inter / new Set([...ta, ...tb]).size;
  const contido = inter / Math.min(ta.size, tb.size); // "ODONTO SERRA" dentro de "CLINICA ODONTO SERRA"
  const textual = dice([...ta].sort().join(" "), [...tb].sort().join(" "));
  return Math.max(jaccard, contido * 0.9, textual);
}

function componente(place: Place, tipo: string): string {
  const c = place.addressComponents?.find((x) => x.types?.includes(tipo));
  return c?.longText || c?.shortText || "";
}

/** Quão provável é que o card do Google seja esta empresa da Receita. */
export function scoreMatchGoogle(lead: LeadParaMatch, place: Place): { score: number; sinais: string[] } {
  let pts = 0;
  const sinais: string[] = [];

  const cepLead = soDigitos(lead.cep), cepG = soDigitos(componente(place, "postal_code"));
  if (cepLead && cepG) {
    if (cepLead === cepG) { pts += 30; sinais.push("cep"); }
    else if (cepLead.slice(0, 5) === cepG.slice(0, 5)) { pts += 10; sinais.push("cep_parcial"); }
  }

  const numLead = soDigitos(lead.numero), numG = soDigitos(componente(place, "street_number"));
  if (numLead && numG && numLead === numG) { pts += 15; sinais.push("numero"); }

  const nomeG = place.displayName?.text ?? "";
  const sim = Math.max(similaridadeNome(lead.nomeFantasia, nomeG), similaridadeNome(lead.razaoSocial, nomeG));
  if (sim >= 0.6) { pts += 30; sinais.push("nome"); }
  else if (sim >= 0.34) { pts += 15; sinais.push("nome_parcial"); }

  const cidadeG = normalizar(componente(place, "administrative_area_level_2") || componente(place, "locality"));
  if (cidadeG && lead.municipio) {
    if (cidadeG === normalizar(lead.municipio)) pts += 5;
    else { pts -= 20; sinais.push("cidade_diferente"); }
  }

  const telG = soDigitos(place.nationalPhoneNumber).replace(/^0+/, "");
  if (telG) {
    const telsLead = new Set(lead.telefones.map((t) => soDigitos(t.e164).slice(2)));
    if (telsLead.has(telG)) { pts += 50; sinais.push("telefone"); }
  }

  return { score: pts, sinais };
}

export type StatusGoogle = "confirmado" | "provavel" | "nao_encontrado" | "fechado" | "nao_verificado";

export function classificarMatch(score: number, businessStatus?: string | null): StatusGoogle {
  if (businessStatus === "CLOSED_PERMANENTLY" && score >= 35) return "fechado";
  if (score >= 60) return "confirmado";
  if (score >= 35) return "provavel";
  return "nao_encontrado";
}
