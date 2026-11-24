import { calcularFit, calcularScore } from './score';
import { diaSP, diasEntre, diaHoraIso, dominioDoSite, normalizarTelefone, somarDias, agoraIso, hojeSP } from './format';
import type { Config, Lead, PassoCadencia } from './types';

export function leadVazio(): Lead {
  const agora = agoraIso();
  return derivarLead({
    nome_empresa: '', telefone: '', site: '', dominio: '',
    cnpj: '', capital_social: null, segmento: '', cidade: '',
    fit: 'incerto', fit_manual: false,
    decisor_nome: '', decisor_cargo: '', decisor_email: '', decisor_telefone: '', decisor_identificado: false,
    google_ads: 'nao_verificado', meta_ads: 'nao_verificado', site_qualidade: 'nao_verificado',
    social: 'nao_verificado', gmn_cadastro: 'nao_verificado', aparece_busca_local: 'nao_verificado',
    observacoes_diagnostico: '',
    score: 0, faixa_score: 'nao_ligar', maior_lacuna: null, diagnostico_completo: false,
    temperatura: 'frio', etapa_pipeline: 'novo',
    proxima_acao: '', proxima_acao_data: null, ultimo_contato_data: null,
    tentativas: 0, cadencia_dia: 0, cadencia_tentativa: 0, cadencia_inicio: null, cadencia_status: 'ativa',
    origem: 'manual', dados_receita: null, criado_em: agora, atualizado_em: agora,
  }, 100000);
}

/** Recalcula todos os campos derivados do lead. */
export function derivarLead(lead: Lead, limiteFit: number): Lead {
  const s = calcularScore(lead);
  const out: Lead = {
    ...lead,
    telefone: normalizarTelefone(lead.telefone),
    decisor_telefone: lead.decisor_telefone ? normalizarTelefone(lead.decisor_telefone) : '',
    dominio: dominioDoSite(lead.site),
    score: s.score,
    faixa_score: s.faixa_score,
    maior_lacuna: s.maior_lacuna,
    diagnostico_completo: s.diagnostico_completo,
    decisor_identificado: !!lead.decisor_nome?.trim(),
  };
  if (!out.fit_manual) out.fit = calcularFit(out.capital_social, limiteFit);
  return out;
}

export interface EstadoCadencia {
  total: number;
  tentativa: number; // tentativas feitas
  status: Lead['cadencia_status'];
  esgotada: boolean; // todas as tentativas feitas sem contato
  proximo: (PassoCadencia & { data: string }) | null; // próximo passo sugerido (data ISO)
}

export function estadoCadencia(lead: Lead, config: Config): EstadoCadencia {
  const total = config.cadencia.length;
  const tentativa = lead.cadencia_tentativa ?? 0;
  const esgotada = lead.cadencia_status === 'ativa' && tentativa >= total;
  let proximo: EstadoCadencia['proximo'] = null;
  if (lead.cadencia_status === 'ativa' && tentativa < total) {
    const passo = config.cadencia[tentativa];
    const inicio = lead.cadencia_inicio ? diaSP(lead.cadencia_inicio) : hojeSP();
    let dia = somarDias(inicio, Math.max(0, passo.dia - 1));
    if (dia < hojeSP()) dia = hojeSP();
    proximo = { ...passo, data: diaHoraIso(dia, '09:00') };
  }
  return { total, tentativa, status: lead.cadencia_status, esgotada, proximo };
}

export function diaDaCadencia(inicioIso: string, atualIso: string): number {
  return diasEntre(diaSP(inicioIso), diaSP(atualIso)) + 1;
}
