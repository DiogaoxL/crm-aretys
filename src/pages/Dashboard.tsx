import { useMemo, useState } from 'react';
import * as repo from '../db/repo';
import { useConfig, useTudo } from '../db/hooks';
import { FAIXA_CURTA } from '../domain/constants';
import { fimDiaIso, formatarPct, hojeSP, inicioDiaIso, somarDias } from '../domain/format';
import { calcularMetricas } from '../domain/metrics';
import type { FaixaScore, Transicao } from '../domain/types';
import { Vazio } from '../components/ui';

type Periodo = 'hoje' | 'semana' | 'mes' | 'custom';

export function Dashboard() {
  const dados = useTudo();
  const config = useConfig();
  const hoje = hojeSP();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [ini, setIni] = useState(somarDias(hoje, -29));
  const [fim, setFim] = useState(hoje);
  const [segmento, setSegmento] = useState('');
  const [faixa, setFaixa] = useState<FaixaScore | ''>('');

  const intervalo = useMemo(() => {
    switch (periodo) {
      case 'hoje': return [hoje, hoje];
      case 'semana': return [somarDias(hoje, -6), hoje];
      case 'mes': return [somarDias(hoje, -29), hoje];
      default: return ini <= fim ? [ini, fim] : [fim, ini];
    }
  }, [periodo, ini, fim, hoje]);

  const m = useMemo(() => dados && calcularMetricas(dados, {
    inicio: inicioDiaIso(intervalo[0]), fim: fimDiaIso(intervalo[1]), segmento, faixa,
  }, config), [dados, intervalo, segmento, faixa, config]);

  const segmentos = useMemo(() => [...new Set((dados?.leads ?? []).map((l) => l.segmento).filter(Boolean))].sort() as string[], [dados]);

  if (!dados || !m) return null;
  const maxFunil = Math.max(1, m.funil[0].valor, m.funil[1].valor);
  const maxDia = Math.max(1, ...m.ligacoesPorDia.map((d) => d.qtd));

  return (
    <div className="pagina">
      <div className="pagina-head">
        <h1>Dashboard do funil</h1>
      </div>
      <div className="filtros">
        <div className="seg">
          {([['hoje', 'Hoje'], ['semana', 'Semana (7 dias)'], ['mes', 'Mês (30 dias)'], ['custom', 'Personalizado']] as const).map(([k, l]) => (
            <button key={k} className={periodo === k ? 'on' : ''} onClick={() => setPeriodo(k)}>{l}</button>
          ))}
        </div>
        {periodo === 'custom' && (
          <>
            <input type="date" value={ini} onChange={(e) => setIni(e.target.value)} aria-label="Data inicial" />
            <span className="muted">até</span>
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} aria-label="Data final" />
          </>
        )}
        <select value={segmento} onChange={(e) => setSegmento(e.target.value)}>
          <option value="">Todos os segmentos</option>{segmentos.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={faixa} onChange={(e) => setFaixa(e.target.value as FaixaScore | '')}>
          <option value="">Todas as faixas de score</option>
          {(Object.keys(FAIXA_CURTA) as FaixaScore[]).map((k) => <option key={k} value={k}>{FAIXA_CURTA[k]}</option>)}
        </select>
      </div>

      {m.funil[0].valor === 0 && <Vazio>Nenhuma ligação registrada no período.</Vazio>}

      <div className={`gargalo ${m.gargalo ? 'ativo' : ''}`}>
        {m.gargalo ? (
          <>
            <div><b>Gargalo atual: {m.gargalo.label}</b> · {formatarPct(m.gargalo.taxa)} contra meta de {m.gargalo.meta}% ({formatarPct(m.gargalo.distancia)} abaixo)</div>
            <div className="small">{m.gargalo.diagnostico}</div>
          </>
        ) : <div>Nenhuma transição abaixo da meta no período{m.funil[0].valor === 0 ? ' (sem dados)' : ''}.</div>}
      </div>

      <div className="dash-grid">
        <section className="card span2">
          <h3>Funil</h3>
          <div className="funil">
            {m.funil.map((e) => {
              const isGargalo = e.transicao && m.gargalo?.id === e.transicao;
              return (
                <div key={e.id} className={`funil-linha ${isGargalo ? 'gargalo-linha' : ''}`}>
                  <span className="funil-label">{e.label}</span>
                  <div className="funil-barra"><div style={{ width: `${Math.max(e.valor ? 1.5 : 0, (e.valor / maxFunil) * 100)}%` }} /></div>
                  <span className="funil-valor">{e.valor}</span>
                  <span className="funil-taxa">
                    {e.id === 'empresas' ? (m.ligacoesPorEmpresa ? `${m.ligacoesPorEmpresa.toFixed(1)} lig./empresa` : '') : e.taxa != null ? formatarPct(e.taxa) : e.transicao ? '—' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card span2">
          <h3>Conversão por transição × meta</h3>
          <div className="tabela-wrap">
            <table className="tabela compacta">
              <thead><tr><th>Transição</th><th>Volume</th><th>Taxa</th><th>Meta</th><th>Distância</th><th>Diagnóstico sugerido</th></tr></thead>
              <tbody>
                {m.transicoes.map((t) => (
                  <tr key={t.id} className={m.gargalo?.id === t.id ? 'linha-gargalo' : ''}>
                    <td><b>{t.label}</b></td>
                    <td className="small">{t.numerador}/{t.denominador}</td>
                    <td>{formatarPct(t.taxa)}</td>
                    <td><MetaInput id={t.id} valor={t.meta} metas={config.metas} /></td>
                    <td className={t.distancia != null && t.distancia > 0 ? 'vencida' : 'ok-txt'}>
                      {t.distancia == null ? '—' : t.distancia > 0 ? `−${formatarPct(t.distancia)}` : 'na meta'}
                    </td>
                    <td className="small muted">{t.diagnostico}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Distância = quanto a taxa está abaixo da meta, em % da meta. O gargalo é a maior distância. Metas editáveis aqui ou em Configurações.</p>
        </section>

        <section className="card">
          <h3>Motivos de perda</h3>
          {m.motivosPerda.length === 0 ? <p className="muted small">Nenhuma perda no período.</p> : (
            <Barras itens={m.motivosPerda.map((x) => ({ label: x.motivo, valor: x.qtd, texto: `${x.qtd} · ${formatarPct(x.pct)}` }))} />
          )}
        </section>

        <section className="card">
          <h3>Tentativas até a 1ª conexão</h3>
          <div className="kpi-grande">{m.tentativasAtePrimeiraConexao == null ? '—' : m.tentativasAtePrimeiraConexao.toFixed(1)}</div>
          <p className="muted small">Média de ligações até a primeira conexão, em {m.leadsComPrimeiraConexao} lead(s) que conectaram pela 1ª vez no período.</p>
        </section>

        <section className="card">
          <h3>Taxa de conexão por faixa de score</h3>
          {m.conexaoPorFaixa.length === 0 ? <p className="muted small">Sem ligações.</p> : (
            <Barras pct itens={m.conexaoPorFaixa.map((x) => ({
              label: FAIXA_CURTA[x.chave as FaixaScore], valor: x.taxa ?? 0, texto: `${formatarPct(x.taxa)} (${x.conexoes}/${x.ligacoes})`,
            }))} />
          )}
          <p className="muted small">Valida se o score prioriza bem: faixas mais altas deveriam conectar e converter melhor.</p>
        </section>

        <section className="card">
          <h3>Taxa de conexão por segmento</h3>
          {m.conexaoPorSegmento.length === 0 ? <p className="muted small">Sem ligações.</p> : (
            <Barras pct itens={m.conexaoPorSegmento.map((x) => ({
              label: x.chave, valor: x.taxa ?? 0, texto: `${formatarPct(x.taxa)} (${x.conexoes}/${x.ligacoes})`,
            }))} />
          )}
        </section>

        <section className="card span2">
          <h3>Ligações por dia</h3>
          <div className="colunas-dia" role="img" aria-label="Ligações por dia">
            {m.ligacoesPorDia.map((d) => (
              <div key={d.dia} className="col-dia" title={`${d.dia.split('-').reverse().join('/')}: ${d.qtd} ligações`}>
                <span className="col-num">{d.qtd || ''}</span>
                <div className="col-barra" style={{ height: `${(d.qtd / maxDia) * 100}%` }} />
                <span className="col-label">{d.dia.slice(8)}/{d.dia.slice(5, 7)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Barras({ itens, pct }: { itens: { label: string; valor: number; texto: string }[]; pct?: boolean }) {
  const max = pct ? 100 : Math.max(1, ...itens.map((i) => i.valor));
  return (
    <div className="barras">
      {itens.map((i) => (
        <div key={i.label} className="barra-linha">
          <span className="barra-label" title={i.label}>{i.label}</span>
          <div className="barra"><div style={{ width: `${(i.valor / max) * 100}%` }} /></div>
          <span className="barra-valor">{i.texto}</span>
        </div>
      ))}
    </div>
  );
}

function MetaInput({ id, valor, metas }: { id: Transicao; valor: number; metas: Record<Transicao, number> }) {
  return (
    <span className="meta-input">
      <input
        type="number" min={0} max={100} step={1} defaultValue={valor} key={valor}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (!isNaN(v) && v !== valor) repo.salvarConfig({ metas: { ...metas, [id]: Math.max(0, Math.min(100, v)) } });
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        aria-label="Meta (%)"
      />%
    </span>
  );
}
