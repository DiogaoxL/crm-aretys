// Dados de exemplo para testar kanban, score, fila e dashboard.
import { RESULTADOS_CONTATO } from './constants';
import { diaHoraIso, hojeSP, somarDias, diaSP, diasEntre } from './format';
import type { Atividade, Lead, Reuniao, ResultadoAtividade, TipoAtividade, Venda } from './types';

const t = (diasAtras: number, hora = '10:00') => diaHoraIso(somarDias(hojeSP(), -diasAtras), hora);
const f = (diasAdiante: number, hora = '09:00') => diaHoraIso(somarDias(hojeSP(), diasAdiante), hora);

type A = [number, TipoAtividade, ResultadoAtividade, string?, string?]; // diasAtras, tipo, resultado, hora, comentário

interface Modelo {
  lead: Partial<Lead>;
  atividades: A[];
  reunioes?: { data: string; status: Reuniao['status']; criado: number; obs?: string }[];
  venda?: { dias: number; valor: number | null };
}

const L = (nome: string, tel: string, site: string, segmento: string, cidade: string, capital: number | null,
  d: [Lead['google_ads'], Lead['meta_ads'], Lead['site_qualidade'], Lead['social'], Lead['gmn_cadastro'], Lead['aparece_busca_local']],
  extra: Partial<Lead> = {}): Partial<Lead> => ({
  nome_empresa: nome, telefone: tel, site, segmento, cidade, capital_social: capital,
  google_ads: d[0], meta_ads: d[1], site_qualidade: d[2], social: d[3], gmn_cadastro: d[4], aparece_busca_local: d[5],
  origem: 'exemplo', ...extra,
});

const MODELOS: Modelo[] = [
  {
    lead: L('Clínica Odonto Vida', '(11) 97412-3301', 'odontovida-exemplo.com.br', 'Odontologia', 'São Paulo', 250000,
      ['nao_anuncia', 'nao_anuncia', 'ruim_ou_institucional', 'sem_estrutura', 'incompleto', 'nao'],
      { decisor_nome: 'Dra. Paula Reis', decisor_cargo: 'Sócia', etapa_pipeline: 'reuniao_marcada', temperatura: 'quente',
        proxima_acao: 'Confirmar reunião por WhatsApp', proxima_acao_data: f(1, '09:00') }),
    atividades: [[12, 'ligacao', 'nao_atendeu', '09:10'], [11, 'ligacao', 'caixa_postal', '15:20'],
      [9, 'ligacao', 'atendeu_sem_decisor', '10:05', 'Recepção passou o nome da Dra. Paula'],
      [6, 'ligacao', 'atendeu_decisor', '11:30', 'Interessada em Google Ads'],
      [2, 'ligacao', 'reuniao_marcada', '14:00', 'Reunião online marcada']],
    reunioes: [{ data: f(2, '15:00'), status: 'marcada', criado: 2 }],
  },
  {
    lead: L('Auto Center Turbo', '(19) 3241-5566', 'autocenterturbo-exemplo.com.br', 'Automotivo', 'Campinas', 80000,
      ['nao_anuncia', 'nao_anuncia', 'sem_site', 'sem_presenca', 'sem_cadastro', 'nao'],
      { etapa_pipeline: 'em_contato', temperatura: 'frio', proxima_acao: 'Ligar no fim da manhã', proxima_acao_data: t(0, '11:00') }),
    atividades: [[5, 'ligacao', 'nao_atendeu', '08:40'], [3, 'whatsapp', 'sem_resposta', '10:00'], [1, 'ligacao', 'caixa_postal', '17:10']],
  },
  {
    lead: L('Imobiliária Horizonte', '(11) 3322-1100', 'horizonte-imoveis-exemplo.com.br', 'Imobiliário', 'São Paulo', 500000,
      ['fraco', 'bom', 'sem_foco_conversao', 'estruturado', 'bem_cuidado', 'sim'], { etapa_pipeline: 'qualificado' }),
    atividades: [],
  },
  {
    lead: L('Academia Força Total', '(11) 98123-4455', 'forcatotal-exemplo.com.br', 'Fitness', 'Santo André', 120000,
      ['nao_anuncia', 'fraco', 'ruim_ou_institucional', 'abandonado', 'incompleto', 'nao'],
      { decisor_nome: 'Marcos Lima', decisor_cargo: 'Proprietário', etapa_pipeline: 'venda_ganha', temperatura: 'quente' }),
    atividades: [[20, 'ligacao', 'nao_atendeu', '09:00'], [19, 'ligacao', 'atendeu_decisor', '10:15'],
      [18, 'ligacao', 'reuniao_marcada', '16:00', 'Reunião presencial']],
    reunioes: [{ data: t(14, '10:00'), status: 'realizada', criado: 18, obs: 'Gostou da proposta de tráfego + landing page' }],
    venda: { dias: 8, valor: 4500 },
  },
  {
    lead: L('Escritório Contábil Precisão', '(11) 3456-7788', 'contabilprecisao-exemplo.com.br', 'Contabilidade', 'São Paulo', 60000,
      ['nao_anuncia', 'nao_anuncia', 'ruim_ou_institucional', 'sem_presenca', 'incompleto', 'nao'],
      { decisor_nome: 'Roberto Alves', decisor_cargo: 'Diretor', etapa_pipeline: 'perdido', motivo_perda: 'Sem orçamento', temperatura: 'morno' }),
    atividades: [[17, 'ligacao', 'atendeu_sem_decisor', '11:00'], [16, 'ligacao', 'atendeu_decisor', '14:30'],
      [15, 'ligacao', 'reuniao_marcada', '09:30']],
    reunioes: [{ data: t(10, '14:00'), status: 'realizada', criado: 15, obs: 'Sem verba neste semestre' }],
  },
  {
    lead: L('Pet Shop Amigo Fiel', '(11) 94567-1234', 'amigofielpet-exemplo.com.br', 'Pet', 'Guarulhos', 40000,
      ['nao_anuncia', 'nao_anuncia', 'sem_foco_conversao', 'estruturado', 'bem_cuidado', 'sim'],
      { etapa_pipeline: 'conectado', temperatura: 'morno', proxima_acao: 'Retornar: dono volta às 14h', proxima_acao_data: t(0, '14:00') }),
    atividades: [[4, 'ligacao', 'nao_atendeu', '09:20'], [2, 'ligacao', 'atendeu_sem_decisor', '10:40'],
      [1, 'ligacao', 'pediu_retorno', '16:00', 'Pediu para ligar hoje à tarde']],
  },
  {
    lead: L('Restaurante Sabor Mineiro', '(31) 99876-5432', 'sabormineiro-exemplo.com.br', 'Alimentação', 'Belo Horizonte', 150000,
      ['nao_anuncia', 'nao_anuncia', 'sem_site', 'estruturado', 'incompleto', 'nao'],
      { decisor_nome: 'Joana Freitas', decisor_cargo: 'Gerente', etapa_pipeline: 'decisor_conectado', temperatura: 'quente',
        proxima_acao: 'Enviar case e propor reunião', proxima_acao_data: t(1, '10:00') }),
    atividades: [[6, 'ligacao', 'nao_atendeu', '15:00'], [5, 'ligacao', 'atendeu_sem_decisor', '10:00'],
      [3, 'ligacao', 'atendeu_decisor', '11:15', 'Achou caro; pediu case']],
  },
  {
    lead: L('Construtora Alicerce', '(11) 3030-4040', 'alicerce-exemplo.com.br', 'Construção', 'São Paulo', 2000000,
      ['fraco', 'nao_anuncia', 'sem_foco_conversao', 'sem_estrutura', 'incompleto', 'nao'],
      { decisor_nome: 'Eng. Carlos Mota', decisor_cargo: 'Diretor comercial', etapa_pipeline: 'reuniao_realizada', temperatura: 'quente',
        proxima_acao: 'Enviar proposta', proxima_acao_data: f(1, '10:00') }),
    atividades: [[13, 'ligacao', 'atendeu_sem_decisor', '09:45'], [12, 'email', 'respondeu', '12:00'],
      [10, 'ligacao', 'atendeu_decisor', '10:30'], [9, 'ligacao', 'reuniao_marcada', '11:00']],
    reunioes: [{ data: t(5, '16:00'), status: 'realizada', criado: 9, obs: 'Pediu proposta com landing pages por empreendimento' }],
  },
  {
    lead: L('Clínica Estética Bella', '(11) 95555-8899', 'esteticabella-exemplo.com.br', 'Estética', 'São Paulo', 90000,
      ['bom', 'fraco', 'ruim_ou_institucional', 'estruturado', 'bem_cuidado', 'sim'],
      { etapa_pipeline: 'perdido', motivo_perda: 'Empresa estruturada, sem oportunidade' }),
    atividades: [[8, 'ligacao', 'atendeu_sem_decisor', '10:00', 'Já tem agência']],
  },
  {
    lead: L('Ótica Visão Clara', '(15) 3211-9090', 'visaoclara-exemplo.com.br', 'Varejo', 'Sorocaba', 110000,
      ['nao_anuncia', 'nao_verificado', 'nao_verificado', 'nao_verificado', 'nao_verificado', 'nao_verificado'],
      { etapa_pipeline: 'novo' }),
    atividades: [],
  },
  {
    lead: L('Advocacia Martins & Lima', '(11) 3777-1212', 'martinslima-exemplo.adv.br', 'Jurídico', 'São Paulo', 300000,
      ['nao_anuncia', 'nao_anuncia', 'ruim_ou_institucional', 'abandonado', 'sem_cadastro', 'nao'],
      { etapa_pipeline: 'em_contato', temperatura: 'frio', proxima_acao: 'Decidir: perdido ou pausar', proxima_acao_data: t(0, '09:00') }),
    atividades: [[14, 'ligacao', 'nao_atendeu', '09:00'], [13, 'whatsapp', 'sem_resposta', '10:00'],
      [11, 'ligacao', 'caixa_postal', '14:00'], [8, 'email', 'sem_resposta', '08:30'],
      [5, 'ligacao', 'nao_atendeu', '16:30'], [1, 'whatsapp', 'sem_resposta', '11:00']],
  },
  {
    lead: L('Escola Infantil Pequeno Saber', '(19) 98888-7070', 'pequenosaber-exemplo.com.br', 'Educação', 'Campinas', 70000,
      ['nao_anuncia', 'fraco', 'sem_foco_conversao', 'sem_estrutura', 'incompleto', 'nao'], { etapa_pipeline: 'qualificado', temperatura: 'morno' }),
    atividades: [],
  },
  {
    lead: L('Marcenaria Arte em Madeira', '(11) 96666-3434', 'artemadeira-exemplo.com.br', 'Móveis', 'São Paulo', 50000,
      ['nao_anuncia', 'nao_anuncia', 'sem_site', 'abandonado', 'sem_cadastro', 'nao'],
      { etapa_pipeline: 'perdido', motivo_perda: 'Sem interesse' }),
    atividades: [[7, 'ligacao', 'nao_atendeu', '10:10'], [6, 'ligacao', 'sem_interesse', '15:40', 'Trabalha só por indicação']],
  },
  {
    lead: L('Laboratório BioAnálises', '(16) 3610-2020', 'bioanalises-exemplo.com.br', 'Saúde', 'Ribeirão Preto', 800000,
      ['fraco', 'fraco', 'sem_foco_conversao', 'sem_estrutura', 'incompleto', 'nao'],
      { decisor_nome: 'Fernanda Costa', decisor_cargo: 'Gerente de marketing', etapa_pipeline: 'reuniao_marcada', temperatura: 'morno',
        proxima_acao: 'Confirmar reunião remarcada', proxima_acao_data: f(3, '09:00') }),
    atividades: [[10, 'ligacao', 'atendeu_decisor', '10:20'], [9, 'ligacao', 'reuniao_marcada', '09:00']],
    reunioes: [{ data: t(4, '10:00'), status: 'no_show', criado: 9 }, { data: f(4, '10:00'), status: 'marcada', criado: 3, obs: 'Remarcada após no-show' }],
  },
  {
    lead: L('Hotel Vista Mar', '(13) 3289-4545', 'hotelvistamar-exemplo.com.br', 'Hotelaria', 'Santos', 400000,
      ['nao_anuncia', 'fraco', 'ruim_ou_institucional', 'estruturado', 'incompleto', 'nao'],
      { etapa_pipeline: 'em_contato', temperatura: 'morno', proxima_acao: 'Ligar para o gerente geral', proxima_acao_data: t(0, '10:30') }),
    atividades: [[3, 'ligacao', 'nao_atendeu', '09:15'], [2, 'ligacao', 'numero_invalido', '14:45', 'Ramal errado; testar o fixo']],
  },
];

export function gerarDadosExemplo() {
  const leads: Partial<Lead>[] = [];
  const atividades: (Omit<Atividade, 'lead_id'> & { lead: number })[] = [];
  const reunioes: (Omit<Reuniao, 'lead_id'> & { lead: number })[] = [];
  const vendas: (Omit<Venda, 'lead_id'> & { lead: number })[] = [];

  MODELOS.forEach((m, i) => {
    const acts = m.atividades.map(([d, tipo, resultado, hora, comentario]) => ({
      lead: i, tipo, resultado, data_hora: t(d, hora), comentario: comentario ?? '',
    })).sort((a, b) => a.data_hora.localeCompare(b.data_hora));
    atividades.push(...acts);

    // Campos derivados do histórico (como se as atividades tivessem sido registradas no app)
    const lead: Partial<Lead> = { ...m.lead, tentativas: acts.filter((a) => a.tipo === 'ligacao').length };
    const criado = acts[0]?.data_hora ?? t(3, '08:00');
    lead.criado_em = criado;
    lead.atualizado_em = acts.at(-1)?.data_hora ?? criado;
    lead.ultimo_contato_data = acts.at(-1)?.data_hora ?? null;
    if (lead.etapa_pipeline === 'perdido') lead.perdido_em = lead.atualizado_em;
    let tentativa = 0;
    let status: Lead['cadencia_status'] = 'ativa';
    for (const a of acts) {
      if (RESULTADOS_CONTATO.includes(a.resultado)) { status = 'concluida'; break; }
      tentativa++;
    }
    lead.cadencia_tentativa = tentativa;
    lead.cadencia_status = status;
    lead.cadencia_inicio = acts[0]?.data_hora ?? null;
    lead.cadencia_dia = acts.length ? diasEntre(diaSP(acts[0].data_hora), diaSP(acts.at(-1)!.data_hora)) + 1 : 0;
    leads.push(lead);

    for (const r of m.reunioes ?? []) {
      reunioes.push({ lead: i, data_hora: r.data, status: r.status, observacoes: r.obs ?? '', criado_em: t(r.criado, '12:00') });
    }
    if (m.venda) vendas.push({ lead: i, data: t(m.venda.dias, '17:00'), valor: m.venda.valor, observacoes: 'Pacote tráfego pago + landing page' });
  });

  return { leads, atividades, reunioes, vendas };
}
