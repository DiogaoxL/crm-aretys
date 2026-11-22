import { useMemo, useState } from 'react';
import * as repo from '../db/repo';
import { useConfig, useLeads } from '../db/hooks';
import { BLOCO_LABEL, ETAPA_LABEL, ETAPA_ORDEM, ETAPAS, FAIXA_CURTA, TEMP_LABEL, TEMPERATURAS } from '../domain/constants';
import { formatarRelativo, formatarTelefone, vencida } from '../domain/format';
import type { Bloco, Etapa, FaixaScore, Lead, Temperatura } from '../domain/types';
import { useApp } from '../components/AppContext';
import { NovoLead } from '../components/NovoLead';
import { FitBadge, LacunaTag, ScoreBadge, TempBadge, Telefone, Vazio } from '../components/ui';

interface Filtros {
  busca: string; etapa: string; faixa: string; fit: string; temperatura: string; lacuna: string;
  cidade: string; segmento: string; decisor: string; vencida: boolean;
}
const FILTROS_VAZIOS: Filtros = {
  busca: '', etapa: '', faixa: '', fit: '', temperatura: '', lacuna: '', cidade: '', segmento: '', decisor: '', vencida: false,
};

type Ordem = 'nome_empresa' | 'score' | 'temperatura' | 'etapa_pipeline' | 'tentativas' | 'ultimo_contato_data' | 'proxima_acao_data' | 'cidade';

function lerVisao(): 'kanban' | 'lista' {
  try { return localStorage.getItem('crm-visao') === 'lista' ? 'lista' : 'kanban'; } catch { return 'kanban'; }
}

export function Leads() {
  const leads = useLeads();
  const config = useConfig();
  const [visao, setVisaoState] = useState(lerVisao);
  const [f, setF] = useState<Filtros>(FILTROS_VAZIOS);
  const [novo, setNovo] = useState(false);
  const setVisao = (v: 'kanban' | 'lista') => { setVisaoState(v); try { localStorage.setItem('crm-visao', v); } catch { /* ignore */ } };

  const opcoes = useMemo(() => ({
    cidades: [...new Set((leads ?? []).map((l) => l.cidade).filter(Boolean))].sort() as string[],
    segmentos: [...new Set((leads ?? []).map((l) => l.segmento).filter(Boolean))].sort() as string[],
  }), [leads]);

  const filtrados = useMemo(() => {
    const q = f.busca.trim().toLowerCase();
    const qDig = q.replace(/\D/g, '');
    return (leads ?? []).filter((l) => {
      if (q) {
        const ok = l.nome_empresa.toLowerCase().includes(q) || (l.site ?? '').toLowerCase().includes(q)
          || (qDig.length >= 3 && l.telefone.includes(qDig));
        if (!ok) return false;
      }
      if (f.etapa && l.etapa_pipeline !== f.etapa) return false;
      if (f.faixa && l.faixa_score !== f.faixa) return false;
      if (f.fit && l.fit !== f.fit) return false;
      if (f.temperatura && l.temperatura !== f.temperatura) return false;
      if (f.lacuna && (l.maior_lacuna ?? 'nenhuma') !== f.lacuna) return false;
      if (f.cidade && l.cidade !== f.cidade) return false;
      if (f.segmento && l.segmento !== f.segmento) return false;
      if (f.decisor && String(l.decisor_identificado) !== f.decisor) return false;
      if (f.vencida && !vencida(l.proxima_acao_data)) return false;
      return true;
    });
  }, [leads, f]);

  const ativos = Object.entries(f).filter(([k, v]) => k !== 'busca' && v).length;
  const set = (k: keyof Filtros) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  if (!leads) return null;
  return (
    <div className="pagina larga">
      <div className="pagina-head">
        <h1>Leads <span className="muted">({filtrados.length}{filtrados.length !== leads.length && ` de ${leads.length}`})</span></h1>
        <div className="linha-flex">
          <div className="seg">
            <button className={visao === 'kanban' ? 'on' : ''} onClick={() => setVisao('kanban')}>Kanban</button>
            <button className={visao === 'lista' ? 'on' : ''} onClick={() => setVisao('lista')}>Lista</button>
          </div>
          <button className="btn primary" onClick={() => setNovo(true)}>+ Novo lead</button>
        </div>
      </div>

      <div className="filtros">
        <input className="busca" placeholder="Buscar por nome, telefone ou site" value={f.busca} onChange={set('busca')} />
        <select value={f.etapa} onChange={set('etapa')}><option value="">Etapa</option>{ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
        <select value={f.faixa} onChange={set('faixa')}><option value="">Faixa de score</option>
          {(Object.keys(FAIXA_CURTA) as FaixaScore[]).map((k) => <option key={k} value={k}>{FAIXA_CURTA[k]}</option>)}</select>
        <select value={f.fit} onChange={set('fit')}><option value="">Fit</option><option value="forte">Forte</option><option value="incerto">Incerto</option></select>
        <select value={f.temperatura} onChange={set('temperatura')}><option value="">Temperatura</option>{TEMPERATURAS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        <select value={f.lacuna} onChange={set('lacuna')}><option value="">Maior lacuna</option>
          {(Object.keys(BLOCO_LABEL) as Bloco[]).map((b) => <option key={b} value={b}>{BLOCO_LABEL[b]}</option>)}<option value="nenhuma">Sem lacuna</option></select>
        <select value={f.cidade} onChange={set('cidade')}><option value="">Cidade</option>{opcoes.cidades.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={f.segmento} onChange={set('segmento')}><option value="">Segmento</option>{opcoes.segmentos.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={f.decisor} onChange={set('decisor')}><option value="">Decisor</option><option value="true">Identificado</option><option value="false">Não identificado</option></select>
        <label className="check"><input type="checkbox" checked={f.vencida} onChange={set('vencida')} /> Próx. ação vencida</label>
        {(ativos > 0 || f.busca) && <button className="btn-link" onClick={() => setF(FILTROS_VAZIOS)}>Limpar filtros</button>}
      </div>

      {leads.length === 0 ? (
        <Vazio>Nenhum lead ainda. <a href="#/importar">Importe um CSV</a>, crie um lead ou carregue os dados de exemplo em <a href="#/config">Configurações</a>.</Vazio>
      ) : visao === 'kanban'
        ? <Kanban leads={filtrados} etapas={config.etapas_visiveis} />
        : <Lista leads={filtrados} />}
      {novo && <NovoLead onClose={() => setNovo(false)} />}
    </div>
  );
}

function Kanban({ leads, etapas }: { leads: Lead[]; etapas: Etapa[] }) {
  const { abrirLead, mudarEtapa } = useApp();
  const [sobre, setSobre] = useState<Etapa | null>(null);
  const colunas = ETAPAS.filter((e) => etapas.includes(e.id));
  const porEtapa = useMemo(() => {
    const m = new Map<Etapa, Lead[]>();
    for (const l of leads) m.set(l.etapa_pipeline, [...(m.get(l.etapa_pipeline) ?? []), l]);
    for (const arr of m.values()) arr.sort((a, b) => b.score - a.score);
    return m;
  }, [leads]);

  async function soltar(e: React.DragEvent, etapa: Etapa) {
    e.preventDefault();
    setSobre(null);
    const id = Number(e.dataTransfer.getData('text/lead'));
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.etapa_pipeline === etapa) return;
    if (etapa === 'descartado' && !confirm(`Mover “${lead.nome_empresa}” para Descartado?`)) return;
    await mudarEtapa([id], etapa);
  }

  return (
    <div className="kanban">
      {colunas.map((c) => {
        const itens = porEtapa.get(c.id) ?? [];
        return (
          <div
            key={c.id}
            className={`coluna etapa-${c.id} ${sobre === c.id ? 'sobre' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setSobre(c.id); }}
            onDragLeave={() => setSobre((s) => (s === c.id ? null : s))}
            onDrop={(e) => soltar(e, c.id)}
          >
            <div className="coluna-head"><span>{c.label}</span><span className="contador">{itens.length}</span></div>
            <div className="coluna-body">
              {itens.map((l) => (
                <div
                  key={l.id} className="cartao" draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/lead', String(l.id)); e.dataTransfer.effectAllowed = 'move'; }}
                  onClick={() => abrirLead(l.id!)}
                >
                  <div className="cartao-titulo">{l.nome_empresa}</div>
                  <div className="linha-flex wrap">
                    <ScoreBadge score={l.score} faixa={l.faixa_score} completo={l.diagnostico_completo} />
                    <FitBadge fit={l.fit} />
                    <TempBadge t={l.temperatura} />
                  </div>
                  {(l.proxima_acao || l.proxima_acao_data) && (
                    <div className={`cartao-prox ${vencida(l.proxima_acao_data) ? 'vencida' : ''}`}>
                      ⏱ {formatarRelativo(l.proxima_acao_data)}{l.proxima_acao && ` · ${l.proxima_acao}`}
                    </div>
                  )}
                  {l.etapa_pipeline === 'perdido' && l.motivo_perda && <div className="cartao-prox muted">{l.motivo_perda}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Lista({ leads }: { leads: Lead[] }) {
  const { abrirLead, mudarEtapa, toast } = useApp();
  const [ordem, setOrdem] = useState<{ campo: Ordem; asc: boolean }>({ campo: 'score', asc: false });
  const [sel, setSel] = useState<Set<number>>(new Set());

  const ordenados = useMemo(() => {
    const peso = { quente: 3, morno: 2, frio: 1 };
    const val = (l: Lead): string | number => {
      switch (ordem.campo) {
        case 'temperatura': return peso[l.temperatura];
        case 'etapa_pipeline': return ETAPA_ORDEM[l.etapa_pipeline];
        case 'score': return l.score;
        case 'tentativas': return l.tentativas;
        default: return String(l[ordem.campo] ?? '').toLowerCase();
      }
    };
    return [...leads].sort((a, b) => {
      const va = val(a); const vb = val(b);
      const r = va < vb ? -1 : va > vb ? 1 : 0;
      return ordem.asc ? r : -r;
    });
  }, [leads, ordem]);

  const visiveis = new Set(leads.map((l) => l.id!));
  const selecionados = [...sel].filter((id) => visiveis.has(id));
  const todos = selecionados.length === leads.length && leads.length > 0;

  const th = (campo: Ordem, label: string) => (
    <th className="ordenavel" onClick={() => setOrdem({ campo, asc: ordem.campo === campo ? !ordem.asc : campo === 'nome_empresa' })}>
      {label}{ordem.campo === campo && (ordem.asc ? ' ▲' : ' ▼')}
    </th>
  );

  async function emMassa(acao: string) {
    if (!acao) return;
    const [tipo, valor] = acao.split(':');
    if (tipo === 'etapa') {
      if (valor === 'descartado' && !confirm(`Mover ${selecionados.length} lead(s) para Descartado?`)) return;
      if (await mudarEtapa(selecionados, valor as Etapa)) setSel(new Set());
    } else if (tipo === 'temp') {
      await repo.atualizarEmMassa(selecionados, { temperatura: valor as Temperatura });
      toast(`Temperatura: ${TEMP_LABEL[valor as Temperatura]}`);
    } else if (tipo === 'excluir') {
      if (!confirm(`Excluir ${selecionados.length} lead(s) e todo o histórico? Esta ação não pode ser desfeita.`)) return;
      await repo.excluirLeads(selecionados);
      setSel(new Set());
      toast('Leads excluídos');
    }
  }

  return (
    <>
      {selecionados.length > 0 && (
        <div className="barra-massa">
          <b>{selecionados.length} selecionado(s)</b>
          <select value="" onChange={(e) => emMassa(e.target.value)}>
            <option value="">Mudar etapa…</option>
            {ETAPAS.map((e) => <option key={e.id} value={`etapa:${e.id}`}>{e.label}</option>)}
          </select>
          <select value="" onChange={(e) => emMassa(e.target.value)}>
            <option value="">Mudar temperatura…</option>
            {TEMPERATURAS.map((t) => <option key={t.id} value={`temp:${t.id}`}>{t.label}</option>)}
          </select>
          <button className="btn danger small" onClick={() => emMassa('excluir:')}>Excluir</button>
          <button className="btn-link" onClick={() => setSel(new Set())}>Limpar seleção</button>
        </div>
      )}
      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th><input type="checkbox" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(leads.map((l) => l.id!)))} aria-label="Selecionar todos" /></th>
              {th('nome_empresa', 'Empresa')}<th>Telefone</th>{th('score', 'Score')}<th>Lacuna</th><th>Fit</th>
              {th('temperatura', 'Temp.')}{th('etapa_pipeline', 'Etapa')}{th('cidade', 'Cidade')}
              {th('tentativas', 'Tent.')}{th('ultimo_contato_data', 'Último contato')}{th('proxima_acao_data', 'Próxima ação')}
            </tr>
          </thead>
          <tbody>
            {ordenados.map((l) => (
              <tr key={l.id} className={`clicavel ${sel.has(l.id!) ? 'sel' : ''}`} onClick={() => abrirLead(l.id!)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={sel.has(l.id!)} aria-label={`Selecionar ${l.nome_empresa}`} onChange={() => {
                    const n = new Set(sel); if (n.has(l.id!)) n.delete(l.id!); else n.add(l.id!); setSel(n);
                  }} />
                </td>
                <td><b>{l.nome_empresa}</b><div className="muted small">{l.dominio}{l.segmento && ` · ${l.segmento}`}</div></td>
                <td title={formatarTelefone(l.telefone)}><Telefone tel={l.telefone} compacto /></td>
                <td><ScoreBadge score={l.score} faixa={l.faixa_score} completo={l.diagnostico_completo} /></td>
                <td><LacunaTag b={l.maior_lacuna} /></td>
                <td><FitBadge fit={l.fit} /></td>
                <td><TempBadge t={l.temperatura} /></td>
                <td className="small">{ETAPA_LABEL[l.etapa_pipeline]}</td>
                <td className="small">{l.cidade}</td>
                <td>{l.tentativas}</td>
                <td className="small">{formatarRelativo(l.ultimo_contato_data)}</td>
                <td className="small"><span className={vencida(l.proxima_acao_data) ? 'vencida' : ''}>{formatarRelativo(l.proxima_acao_data)}</span>
                  {l.proxima_acao && <div className="muted">{l.proxima_acao}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ordenados.length === 0 && <Vazio>Nenhum lead com esses filtros.</Vazio>}
      </div>
    </>
  );
}
