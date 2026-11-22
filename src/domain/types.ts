// Tipos de domínio do CRM. Independentes do banco (IndexedDB/Dexie).

export type Fit = 'forte' | 'incerto';
export type Temperatura = 'frio' | 'morno' | 'quente';

export type GoogleAds = 'nao_anuncia' | 'fraco' | 'bom' | 'nao_verificado';
export type MetaAds = GoogleAds;
export type SiteQualidade = 'sem_site' | 'ruim_ou_institucional' | 'sem_foco_conversao' | 'bom' | 'nao_verificado';
export type Social = 'sem_presenca' | 'abandonado' | 'sem_estrutura' | 'estruturado' | 'nao_verificado';
export type GmnCadastro = 'sem_cadastro' | 'incompleto' | 'bem_cuidado' | 'nao_verificado';
export type BuscaLocal = 'sim' | 'nao' | 'nao_verificado';

export type Etapa =
  | 'novo'
  | 'qualificado'
  | 'em_contato'
  | 'conectado'
  | 'decisor_conectado'
  | 'reuniao_marcada'
  | 'reuniao_realizada'
  | 'venda_ganha'
  | 'perdido'
  | 'descartado';

export type Bloco = 'midia_paga' | 'conversao' | 'social' | 'gmn_local';

export type FaixaScore = 'alta' | 'pontuais' | 'nao_ligar' | 'quase_nada';

export interface Diagnostico {
  google_ads: GoogleAds;
  meta_ads: MetaAds;
  site_qualidade: SiteQualidade;
  social: Social;
  gmn_cadastro: GmnCadastro;
  aparece_busca_local: BuscaLocal;
}

export interface Lead extends Diagnostico {
  id?: number;
  nome_empresa: string;
  telefone: string; // normalizado: somente dígitos, com DDI 55
  site: string;
  dominio: string; // derivado do site, usado para deduplicação
  cnpj?: string;
  capital_social?: number | null;
  segmento?: string;
  cidade?: string;
  fit: Fit;
  fit_manual: boolean; // true = fit sobrescrito manualmente
  decisor_nome?: string;
  decisor_cargo?: string;
  decisor_email?: string;
  decisor_telefone?: string;
  decisor_identificado: boolean;
  observacoes_diagnostico?: string;
  score: number;
  faixa_score: FaixaScore;
  maior_lacuna: Bloco | null;
  diagnostico_completo: boolean;
  temperatura: Temperatura;
  etapa_pipeline: Etapa;
  proxima_acao?: string;
  proxima_acao_data?: string | null; // ISO UTC
  ultimo_contato_data?: string | null; // ISO UTC
  tentativas: number; // ligações registradas
  cadencia_dia: number; // dia da cadência (1 = primeiro dia), 0 = não iniciada
  cadencia_tentativa: number; // tentativas da cadência (qualquer canal) até a 1ª conexão
  cadencia_inicio?: string | null; // ISO UTC da 1ª tentativa
  cadencia_status: 'ativa' | 'pausada' | 'concluida';
  motivo_perda?: string;
  motivo_perda_texto?: string;
  perdido_em?: string | null; // ISO UTC de quando foi para Perdido
  origem?: string;
  criado_em: string;
  atualizado_em: string;
}

export type TipoAtividade = 'ligacao' | 'whatsapp' | 'email' | 'outro';

export type ResultadoAtividade =
  | 'nao_atendeu'
  | 'caixa_postal'
  | 'numero_invalido'
  | 'atendeu_sem_decisor'
  | 'atendeu_decisor'
  | 'pediu_retorno'
  | 'reuniao_marcada'
  | 'sem_interesse'
  // canais escritos (WhatsApp, e-mail, outro)
  | 'sem_resposta'
  | 'respondeu';

export interface Atividade {
  id?: number;
  lead_id: number;
  tipo: TipoAtividade;
  data_hora: string; // ISO UTC
  resultado: ResultadoAtividade;
  comentario?: string;
}

export type StatusReuniao = 'marcada' | 'realizada' | 'no_show' | 'remarcada';

export interface Reuniao {
  id?: number;
  lead_id: number;
  data_hora: string; // ISO UTC da reunião
  status: StatusReuniao;
  observacoes?: string;
  criado_em: string; // quando foi marcada
}

export interface Venda {
  id?: number;
  lead_id: number;
  data: string; // ISO UTC
  valor?: number | null;
  observacoes?: string;
}

export type Transicao = 'conexao' | 'decisor' | 'reuniao' | 'comparecimento' | 'venda';

export interface PassoCadencia {
  dia: number;
  canal: TipoAtividade;
}

export interface Config {
  chave: 'app';
  metas: Record<Transicao, number>; // percentuais 0-100
  limite_fit_forte: number;
  cadencia: PassoCadencia[];
  motivos_perda: string[];
  etapas_visiveis: Etapa[];
  ultimo_backup?: string | null;
  /** Versão do app que gravou/normalizou os dados pela última vez. */
  dados_app_versao?: string;
}

export interface Backup {
  app: 'crm-prospeccao';
  /** Formato do arquivo de backup (inteiro). Ver src/db/migracoes.ts. */
  versao: number;
  /** Versão do app que gerou o arquivo (package.json). Ausente em backups do formato 1. */
  app_versao?: string;
  exportado_em: string;
  contagens?: { leads: number; atividades: number; reunioes: number; vendas: number };
  leads: Lead[];
  atividades: Atividade[];
  reunioes: Reuniao[];
  vendas: Venda[];
  configuracoes: Config[];
  /** Preferências de interface (localStorage, chaves "crm-*"). */
  preferencias?: Record<string, string>;
}
