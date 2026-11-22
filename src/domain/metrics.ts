import { RESULTADOS_CONEXAO, RESULTADOS_DECISOR, TRANSICOES } from './constants';
import { diaSP, somarDias, diasEntre } from './format';
import type { Atividade, Config, FaixaScore, Lead, Reuniao, Transicao, Venda } from './types';

export interface Dados {
  leads: Lead[];
  atividades: Atividade[];
  reunioes: Reuniao[];
  vendas: Venda[];
}

export interface FiltroMetricas {
  inicio: string; // ISO UTC
  fim: string; // ISO UTC
  segmento?: string;
  faixa?: FaixaScore | '';
}

export interface EtapaFunil { id: string; label: string; valor: number; taxa: number | null; transicao?: Transicao }

export interface LinhaTransicao {
  id: Transicao; label: string; taxa: number | null; meta: number; distancia: number | null; diagnostico: string;
  numerador: number; denominador: number;
}

export interface Metricas {
  funil: EtapaFunil[];
  transicoes: LinhaTransicao[];
  gargalo: LinhaTransicao | null;
  ligacoesPorEmpresa: number | null;
  motivosPerda: { motivo: string; qtd: number; pct: number }[];
  conexaoPorFaixa: { chave: string; ligacoes: number; conexoes: number; taxa: number | null }[];
  conexaoPorSegmento: { chave: string; ligacoes: number; conexoes: number; taxa: number | null }[];
  ligacoesPorDia: { dia: string; qtd: number }[];
  tentativasAtePrimeiraConexao: number | null;
  leadsComPrimeiraConexao: number;
}

const taxa = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const dentro = (iso: string | null | undefined, f: FiltroMetricas) => !!iso && iso >= f.inicio && iso <= f.fim;

export function calcularMetricas(dados: Dados, f: FiltroMetricas, config: Config): Metricas {
  const leads = dados.leads.filter((l) =>
    (!f.segmento || (l.segmento ?? '') === f.segmento) && (!f.faixa || l.faixa_score === f.faixa));
  const porId = new Map(leads.map((l) => [l.id!, l]));

  const ligacoesTodas = dados.atividades.filter((a) => a.tipo === 'ligacao' && porId.has(a.lead_id));
  const ligacoes = ligacoesTodas.filter((a) => dentro(a.data_hora, f));
  const empresas = new Set(ligacoes.map((a) => a.lead_id)).size;
  const conexoes = ligacoes.filter((a) => RESULTADOS_CONEXAO.includes(a.resultado)).length;
  const decisor = ligacoes.filter((a) => RESULTADOS_DECISOR.includes(a.resultado)).length;
  const reunioes = dados.reunioes.filter((r) => porId.has(r.lead_id));
  const marcadas = reunioes.filter((r) => dentro(r.criado_em, f)).length;
  const realizadas = reunioes.filter((r) => r.status === 'realizada' && dentro(r.data_hora, f)).length;
  const vendas = dados.vendas.filter((v) => porId.has(v.lead_id) && dentro(v.data, f)).length;

  const funil: EtapaFunil[] = [
    { id: 'ligacoes', label: 'Ligações', valor: ligacoes.length, taxa: null },
    { id: 'empresas', label: 'Empresas', valor: empresas, taxa: null },
    { id: 'conexoes', label: 'Conexões', valor: conexoes, taxa: taxa(conexoes, ligacoes.length), transicao: 'conexao' },
    { id: 'decisor', label: 'Conexões com o decisor', valor: decisor, taxa: taxa(decisor, conexoes), transicao: 'decisor' },
    { id: 'marcadas', label: 'Reuniões marcadas', valor: marcadas, taxa: taxa(marcadas, decisor), transicao: 'reuniao' },
    { id: 'realizadas', label: 'Reuniões realizadas', valor: realizadas, taxa: taxa(realizadas, marcadas), transicao: 'comparecimento' },
    { id: 'vendas', label: 'Vendas', valor: vendas, taxa: taxa(vendas, realizadas), transicao: 'venda' },
  ];

  const pares: Record<Transicao, [number, number]> = {
    conexao: [conexoes, ligacoes.length],
    decisor: [decisor, conexoes],
    reuniao: [marcadas, decisor],
    comparecimento: [realizadas, marcadas],
    venda: [vendas, realizadas],
  };
  const transicoes: LinhaTransicao[] = TRANSICOES.map((t) => {
    const [n, d] = pares[t.id];
    const tx = taxa(n, d);
    const meta = config.metas[t.id];
    return {
      id: t.id, label: t.label, taxa: tx, meta, diagnostico: t.diagnostico, numerador: n, denominador: d,
      distancia: tx == null || !meta ? null : ((meta - tx) / meta) * 100,
    };
  });
  const candidatos = transicoes.filter((t) => t.distancia != null && t.distancia > 0);
  const gargalo = candidatos.sort((a, b) => b.distancia! - a.distancia!)[0] ?? null;

  // Motivos de perda (leads que foram para Perdido no período)
  const perdidos = leads.filter((l) => l.etapa_pipeline === 'perdido' && dentro(l.perdido_em ?? l.atualizado_em, f));
  const contMotivos = new Map<string, number>();
  for (const l of perdidos) {
    const m = l.motivo_perda || 'Sem motivo';
    contMotivos.set(m, (contMotivos.get(m) ?? 0) + 1);
  }
  const motivosPerda = [...contMotivos.entries()]
    .map(([motivo, qtd]) => ({ motivo, qtd, pct: (qtd / perdidos.length) * 100 }))
    .sort((a, b) => b.qtd - a.qtd);

  // Conexão por faixa de score e por segmento
  const agrupar = (chaveDe: (l: Lead) => string) => {
    const m = new Map<string, { ligacoes: number; conexoes: number }>();
    for (const a of ligacoes) {
      const k = chaveDe(porId.get(a.lead_id)!);
      const g = m.get(k) ?? { ligacoes: 0, conexoes: 0 };
      g.ligacoes++;
      if (RESULTADOS_CONEXAO.includes(a.resultado)) g.conexoes++;
      m.set(k, g);
    }
    return [...m.entries()].map(([chave, g]) => ({ chave, ...g, taxa: taxa(g.conexoes, g.ligacoes) }));
  };
  const ordemFaixa: FaixaScore[] = ['quase_nada', 'alta', 'pontuais', 'nao_ligar'];
  const conexaoPorFaixa = agrupar((l) => l.faixa_score)
    .sort((a, b) => ordemFaixa.indexOf(a.chave as FaixaScore) - ordemFaixa.indexOf(b.chave as FaixaScore));
  const conexaoPorSegmento = agrupar((l) => l.segmento || 'Sem segmento').sort((a, b) => b.ligacoes - a.ligacoes);

  // Ligações por dia (cada dia do período, limitado a 92 dias para não poluir)
  const diaIni = diaSP(f.inicio);
  const diaFim = diaSP(f.fim);
  const nDias = Math.min(92, diasEntre(diaIni, diaFim) + 1);
  const cont = new Map<string, number>();
  for (const a of ligacoes) {
    const d = diaSP(a.data_hora);
    cont.set(d, (cont.get(d) ?? 0) + 1);
  }
  const inicioSerie = nDias < diasEntre(diaIni, diaFim) + 1 ? somarDias(diaFim, -(nDias - 1)) : diaIni;
  const ligacoesPorDia = Array.from({ length: nDias }, (_, i) => {
    const dia = somarDias(inicioSerie, i);
    return { dia, qtd: cont.get(dia) ?? 0 };
  });

  // Tentativas até a primeira conexão (leads cuja 1ª conexão ocorreu no período)
  const porLead = new Map<number, Atividade[]>();
  for (const a of ligacoesTodas) {
    const arr = porLead.get(a.lead_id) ?? [];
    arr.push(a);
    porLead.set(a.lead_id, arr);
  }
  const amostras: number[] = [];
  for (const arr of porLead.values()) {
    arr.sort((a, b) => a.data_hora.localeCompare(b.data_hora));
    const i = arr.findIndex((a) => RESULTADOS_CONEXAO.includes(a.resultado));
    if (i >= 0 && dentro(arr[i].data_hora, f)) amostras.push(i + 1);
  }

  return {
    funil, transicoes, gargalo,
    ligacoesPorEmpresa: empresas ? ligacoes.length / empresas : null,
    motivosPerda, conexaoPorFaixa, conexaoPorSegmento, ligacoesPorDia,
    tentativasAtePrimeiraConexao: amostras.length ? amostras.reduce((a, b) => a + b, 0) / amostras.length : null,
    leadsComPrimeiraConexao: amostras.length,
  };
}
