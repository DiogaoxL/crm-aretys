import type { Bloco, Diagnostico, FaixaScore, Fit, Lead } from './types';

const PONTOS = {
  google_ads: { nao_anuncia: 20, fraco: 10, bom: 0, nao_verificado: 0 },
  meta_ads: { nao_anuncia: 20, fraco: 10, bom: 0, nao_verificado: 0 },
  site_qualidade: { sem_site: 30, ruim_ou_institucional: 20, sem_foco_conversao: 10, bom: 0, nao_verificado: 0 },
  social: { sem_presenca: 15, abandonado: 10, sem_estrutura: 5, estruturado: 0, nao_verificado: 0 },
  gmn_cadastro: { sem_cadastro: 8, incompleto: 4, bem_cuidado: 0, nao_verificado: 0 },
  aparece_busca_local: { nao: 7, sim: 0, nao_verificado: 0 },
} as const;

const MAX_BLOCO: Record<Bloco, number> = { midia_paga: 40, conversao: 30, social: 15, gmn_local: 15 };

export interface ResultadoScore {
  score: number;
  faixa_score: FaixaScore;
  maior_lacuna: Bloco | null;
  diagnostico_completo: boolean;
  blocos: Record<Bloco, number>;
}

export function pontosBlocos(d: Diagnostico): Record<Bloco, number> {
  return {
    midia_paga: PONTOS.google_ads[d.google_ads] + PONTOS.meta_ads[d.meta_ads],
    conversao: PONTOS.site_qualidade[d.site_qualidade],
    social: PONTOS.social[d.social],
    gmn_local: PONTOS.gmn_cadastro[d.gmn_cadastro] + PONTOS.aparece_busca_local[d.aparece_busca_local],
  };
}

export function faixaDoScore(score: number): FaixaScore {
  if (score >= 90) return 'quase_nada';
  if (score >= 70) return 'alta';
  if (score >= 40) return 'pontuais';
  return 'nao_ligar';
}

/**
 * Maior lacuna = bloco com maior proporção de pontos de lacuna em relação ao máximo do bloco
 * (assim um bloco de 15 pontos totalmente ausente pesa igual a um de 40 totalmente ausente).
 * Empate: vence o bloco com mais pontos absolutos.
 */
export function maiorLacuna(blocos: Record<Bloco, number>): Bloco | null {
  let melhor: Bloco | null = null;
  let melhorRazao = 0;
  for (const b of Object.keys(blocos) as Bloco[]) {
    const razao = blocos[b] / MAX_BLOCO[b];
    if (blocos[b] === 0) continue;
    if (melhor === null || razao > melhorRazao || (razao === melhorRazao && blocos[b] > blocos[melhor])) {
      melhor = b;
      melhorRazao = razao;
    }
  }
  return melhor;
}

export function calcularScore(d: Diagnostico): ResultadoScore {
  const blocos = pontosBlocos(d);
  const score = Math.min(100, Object.values(blocos).reduce((a, b) => a + b, 0));
  const diagnostico_completo = (
    ['google_ads', 'meta_ads', 'site_qualidade', 'social', 'gmn_cadastro', 'aparece_busca_local'] as const
  ).every((k) => d[k] !== 'nao_verificado');
  return { score, faixa_score: faixaDoScore(score), maior_lacuna: maiorLacuna(blocos), diagnostico_completo, blocos };
}

export function calcularFit(capital: number | null | undefined, limite: number): Fit {
  return capital != null && capital >= limite ? 'forte' : 'incerto';
}

export type Prioridade = 'maxima' | 'validar_porte' | 'so_fit_forte' | 'normal' | 'descartar';

/** Regras de priorização combinando score e fit. */
export function prioridade(lead: Pick<Lead, 'score' | 'fit'>): { nivel: Prioridade; texto: string } {
  const { score, fit } = lead;
  if (score < 40) return { nivel: 'descartar', texto: 'Score baixo: estrutura completa. Sugestão: mover para Descartado.' };
  if (score >= 90) {
    return fit === 'forte'
      ? { nivel: 'maxima', texto: 'Quase nada existe e o fit é forte: prioridade máxima.' }
      : { nivel: 'so_fit_forte', texto: 'Quase nada existe e o fit é incerto: só ligar após confirmar o porte.' };
  }
  if (score >= 70) {
    return fit === 'forte'
      ? { nivel: 'maxima', texto: 'Score alto e fit forte: prioridade máxima.' }
      : { nivel: 'validar_porte', texto: 'Score alto, fit incerto: ligar, mas validar o porte no início da conversa.' };
  }
  return { nivel: 'normal', texto: 'Lacunas pontuais: abordar a lacuna principal.' };
}

export interface Frase { objecao: string; resposta: string }

/** Frases de abordagem conforme as lacunas do diagnóstico. */
export function frasesAbordagem(d: Diagnostico): Frase[] {
  const frases: Frase[] = [];
  const socialAtivo = d.social === 'estruturado' || d.social === 'sem_estrutura';
  const semAnuncio = d.google_ads === 'nao_anuncia' && d.meta_ads === 'nao_anuncia';
  const temAnuncio = d.google_ads === 'fraco' || d.google_ads === 'bom' || d.meta_ads === 'fraco' || d.meta_ads === 'bom';
  const paginaFraca = ['sem_site', 'ruim_ou_institucional', 'sem_foco_conversao'].includes(d.site_qualidade);

  if (socialAtivo && semAnuncio) {
    frases.push({
      objecao: '“Já tenho alguém no marketing”',
      resposta: 'Conteúdo e performance atuam juntos, não competem. O social constrói marca; o anúncio leva a oferta a quem já está procurando.',
    });
  }
  if (temAnuncio && paginaFraca) {
    frases.push({
      objecao: '“Já anuncio”',
      resposta: 'Ótimo, mas o gasto está vazando na conversão: a página que recebe o clique não transforma visita em contato.',
    });
  }
  if (d.site_qualidade === 'sem_site') {
    frases.push({
      objecao: '“Meus clientes vêm por indicação”',
      resposta: 'Depender só de indicação limita o crescimento. O site é o ponto de partida natural para ser encontrado por quem ainda não te conhece.',
    });
  }
  return frases;
}
