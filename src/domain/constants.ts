import type {
  Bloco, Config, Etapa, FaixaScore, ResultadoAtividade, StatusReuniao, Temperatura, TipoAtividade, Transicao,
} from './types';

export const ETAPAS: { id: Etapa; label: string }[] = [
  { id: 'novo', label: 'Novo' },
  { id: 'qualificado', label: 'Qualificado' },
  { id: 'em_contato', label: 'Em contato' },
  { id: 'conectado', label: 'Conectado' },
  { id: 'decisor_conectado', label: 'Decisor conectado' },
  { id: 'reuniao_marcada', label: 'Reunião marcada' },
  { id: 'reuniao_realizada', label: 'Reunião realizada' },
  { id: 'venda_ganha', label: 'Venda ganha' },
  { id: 'perdido', label: 'Perdido' },
  { id: 'descartado', label: 'Descartado' },
];
export const ETAPA_LABEL = Object.fromEntries(ETAPAS.map((e) => [e.id, e.label])) as Record<Etapa, string>;
export const ETAPA_ORDEM = Object.fromEntries(ETAPAS.map((e, i) => [e.id, i])) as Record<Etapa, number>;
export const ETAPAS_FINAIS: Etapa[] = ['venda_ganha', 'perdido', 'descartado'];

export const TEMPERATURAS: { id: Temperatura; label: string }[] = [
  { id: 'frio', label: 'Frio' },
  { id: 'morno', label: 'Morno' },
  { id: 'quente', label: 'Quente' },
];
export const TEMP_LABEL: Record<Temperatura, string> = { frio: 'Frio', morno: 'Morno', quente: 'Quente' };

export const OPCOES_DIAGNOSTICO = {
  google_ads: [
    ['nao_verificado', 'Não verificado'], ['nao_anuncia', 'Não anuncia'], ['fraco', 'Fraco'], ['bom', 'Bom'],
  ],
  meta_ads: [
    ['nao_verificado', 'Não verificado'], ['nao_anuncia', 'Não anuncia'], ['fraco', 'Fraco'], ['bom', 'Bom'],
  ],
  site_qualidade: [
    ['nao_verificado', 'Não verificado'], ['sem_site', 'Sem site'], ['ruim_ou_institucional', 'Ruim ou institucional'],
    ['sem_foco_conversao', 'Sem foco em conversão'], ['bom', 'Bom'],
  ],
  social: [
    ['nao_verificado', 'Não verificado'], ['sem_presenca', 'Sem presença'], ['abandonado', 'Abandonado'],
    ['sem_estrutura', 'Sem estrutura'], ['estruturado', 'Estruturado'],
  ],
  gmn_cadastro: [
    ['nao_verificado', 'Não verificado'], ['sem_cadastro', 'Sem cadastro'], ['incompleto', 'Incompleto'],
    ['bem_cuidado', 'Bem cuidado'],
  ],
  aparece_busca_local: [['nao_verificado', 'Não verificado'], ['nao', 'Não'], ['sim', 'Sim']],
} as const;

export const CAMPOS_DIAGNOSTICO: { campo: keyof typeof OPCOES_DIAGNOSTICO; label: string }[] = [
  { campo: 'google_ads', label: 'Google Ads' },
  { campo: 'meta_ads', label: 'Meta Ads' },
  { campo: 'site_qualidade', label: 'Qualidade do site' },
  { campo: 'social', label: 'Redes sociais' },
  { campo: 'gmn_cadastro', label: 'Google Meu Negócio' },
  { campo: 'aparece_busca_local', label: 'Aparece na busca local' },
];

export const BLOCO_LABEL: Record<Bloco, string> = {
  midia_paga: 'Mídia paga',
  conversao: 'Site / conversão',
  social: 'Redes sociais',
  gmn_local: 'GMN / busca local',
};

export const FAIXA_LABEL: Record<FaixaScore, string> = {
  quase_nada: 'Quase nada existe, só ligar se o fit for forte',
  alta: 'Prioridade alta',
  pontuais: 'Lacunas pontuais',
  nao_ligar: 'Estrutura completa, não ligar',
};
export const FAIXA_CURTA: Record<FaixaScore, string> = {
  quase_nada: 'Quase nada (90+)',
  alta: 'Prioridade alta',
  pontuais: 'Lacunas pontuais',
  nao_ligar: 'Não ligar',
};

export const TIPOS_ATIVIDADE: { id: TipoAtividade; label: string }[] = [
  { id: 'ligacao', label: 'Ligação' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'email', label: 'E-mail' },
  { id: 'outro', label: 'Outro' },
];
export const TIPO_LABEL: Record<TipoAtividade, string> = { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', outro: 'Outro' };

export const RESULTADO_LABEL: Record<ResultadoAtividade, string> = {
  nao_atendeu: 'Não atendeu',
  caixa_postal: 'Caixa postal',
  numero_invalido: 'Número inválido',
  atendeu_sem_decisor: 'Atendeu (sem decisor)',
  atendeu_decisor: 'Falou com o decisor',
  pediu_retorno: 'Pediu retorno',
  reuniao_marcada: 'Reunião marcada',
  sem_interesse: 'Sem interesse',
  sem_resposta: 'Sem resposta',
  respondeu: 'Respondeu',
};

export const RESULTADOS_LIGACAO: ResultadoAtividade[] = [
  'nao_atendeu', 'caixa_postal', 'numero_invalido', 'atendeu_sem_decisor',
  'atendeu_decisor', 'pediu_retorno', 'reuniao_marcada', 'sem_interesse',
];
export const RESULTADOS_ESCRITOS: ResultadoAtividade[] = [
  'sem_resposta', 'respondeu', 'pediu_retorno', 'reuniao_marcada', 'sem_interesse',
];

/** Ligações atendidas (conexões), conforme definição do funil. */
export const RESULTADOS_CONEXAO: ResultadoAtividade[] = [
  'atendeu_sem_decisor', 'atendeu_decisor', 'pediu_retorno', 'reuniao_marcada', 'sem_interesse',
];
/** Conexões com o decisor. */
export const RESULTADOS_DECISOR: ResultadoAtividade[] = ['atendeu_decisor', 'reuniao_marcada'];
/** Resultados que encerram a cadência (houve contato). */
export const RESULTADOS_CONTATO: ResultadoAtividade[] = [...RESULTADOS_CONEXAO, 'respondeu'];

/** Etapa sugerida após cada resultado. */
export const ETAPA_SUGERIDA: Record<ResultadoAtividade, Etapa> = {
  nao_atendeu: 'em_contato',
  caixa_postal: 'em_contato',
  numero_invalido: 'em_contato',
  sem_resposta: 'em_contato',
  atendeu_sem_decisor: 'conectado',
  pediu_retorno: 'conectado',
  respondeu: 'conectado',
  atendeu_decisor: 'decisor_conectado',
  reuniao_marcada: 'reuniao_marcada',
  sem_interesse: 'perdido',
};

export const STATUS_REUNIAO_LABEL: Record<StatusReuniao, string> = {
  marcada: 'Marcada', realizada: 'Realizada', no_show: 'No-show', remarcada: 'Remarcada',
};

export const TRANSICOES: {
  id: Transicao; label: string; de: string; para: string; diagnostico: string;
}[] = [
  { id: 'conexao', label: 'Ligações → Conexões', de: 'Ligações', para: 'Conexões',
    diagnostico: 'Baixa conexão: revise os horários de ligação e a qualidade da lista (telefones corretos, empresas ativas).' },
  { id: 'decisor', label: 'Conexões → Decisor', de: 'Conexões', para: 'Conexões com o decisor',
    diagnostico: 'Baixo acesso ao decisor: revise a abordagem com a recepção e a pesquisa prévia de decisores.' },
  { id: 'reuniao', label: 'Decisor → Reunião marcada', de: 'Conexões com o decisor', para: 'Reuniões marcadas',
    diagnostico: 'Baixa marcação de reunião: revise o pitch e as frases de abordagem por lacuna.' },
  { id: 'comparecimento', label: 'Marcada → Realizada', de: 'Reuniões marcadas', para: 'Reuniões realizadas',
    diagnostico: 'Alto no-show: reforce a confirmação antes da reunião (WhatsApp na véspera e no dia).' },
  { id: 'venda', label: 'Realizada → Venda', de: 'Reuniões realizadas', para: 'Vendas',
    diagnostico: 'Baixa conversão em venda: revise a proposta e o processo de reunião.' },
];

export const MOTIVO_SEM_CONTATO = 'Sem contato após a cadência';
export const MOTIVO_OUTRO = 'Outro (com texto livre)';

export const CONFIG_PADRAO: Config = {
  chave: 'app',
  metas: { conexao: 25, decisor: 40, reuniao: 30, comparecimento: 75, venda: 25 },
  limite_fit_forte: 100000,
  cadencia: [
    { dia: 1, canal: 'ligacao' },
    { dia: 2, canal: 'whatsapp' },
    { dia: 4, canal: 'ligacao' },
    { dia: 7, canal: 'email' },
    { dia: 10, canal: 'ligacao' },
    { dia: 14, canal: 'whatsapp' },
  ],
  motivos_perda: [
    MOTIVO_SEM_CONTATO,
    'Sem interesse',
    'Já tem fornecedor',
    'Sem orçamento',
    'Momento inadequado',
    'Não é o decisor e não conseguiu acesso',
    'Empresa estruturada, sem oportunidade',
    MOTIVO_OUTRO,
  ],
  etapas_visiveis: ETAPAS.map((e) => e.id),
  ultimo_backup: null,
};
