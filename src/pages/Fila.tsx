import { Fragment, useMemo, useState } from 'react';
import { useConfig, useTudo } from '../db/hooks';
import { ETAPA_LABEL, ETAPAS_FINAIS } from '../domain/constants';
import { diaSP, fimDiaIso, formatarRelativo, hojeSP, vencida } from '../domain/format';
import { prioridade } from '../domain/score';
import type { Lead } from '../domain/types';
import { useApp } from '../components/AppContext';
import { RegistroRapido } from '../components/RegistroRapido';
import { LacunaTag, ScoreBadge, TempBadge, Telefone, Vazio } from '../components/ui';
import { AvisoBackup } from '../components/AvisoBackup';

const PESO_TEMP = { quente: 0, morno: 1, frio: 2 } as const;

export function ordenarFila(a: Lead, b: Lead, fimHoje: string): number {
  const ga = a.proxima_acao_data && a.proxima_acao_data <= fimHoje ? 0 : 1;
  const gb = b.proxima_acao_data && b.proxima_acao_data <= fimHoje ? 0 : 1;
  if (ga !== gb) return ga - gb;
  if (PESO_TEMP[a.temperatura] !== PESO_TEMP[b.temperatura]) return PESO_TEMP[a.temperatura] - PESO_TEMP[b.temperatura];
  if (a.score !== b.score) return b.score - a.score;
  if (a.fit !== b.fit) return a.fit === 'forte' ? -1 : 1;
  return (a.proxima_acao_data ?? '').localeCompare(b.proxima_acao_data ?? '');
}

export function Fila() {
  const dados = useTudo();
  const config = useConfig();
  const { abrirLead } = useApp();
  const [semAgenda, setSemAgenda] = useState(true);
  const [aberto, setAberto] = useState<number | null>(null);

  const fimHoje = fimDiaIso(hojeSP());
  const { fila, nHoje, nVencidas, nSem, ligHoje, conHoje } = useMemo(() => {
    const leads = dados?.leads ?? [];
    const ativos = leads.filter((l) => !ETAPAS_FINAIS.includes(l.etapa_pipeline));
    const agendados = ativos.filter((l) => l.proxima_acao_data && l.proxima_acao_data <= fimHoje);
    const sem = ativos.filter((l) => !l.proxima_acao_data && l.cadencia_status !== 'pausada'
      && !(l.diagnostico_completo && l.score < 40));
    const fila = [...agendados, ...(semAgenda ? sem : [])].sort((a, b) => ordenarFila(a, b, fimHoje));
    const hoje = hojeSP();
    const ligacoesHoje = (dados?.atividades ?? []).filter((a) => a.tipo === 'ligacao' && diaSP(a.data_hora) === hoje);
    return {
      fila, nHoje: agendados.length, nVencidas: agendados.filter((l) => vencida(l.proxima_acao_data) && diaSP(l.proxima_acao_data!) < hoje).length,
      nSem: sem.length, ligHoje: ligacoesHoje.length,
      conHoje: ligacoesHoje.filter((a) => ['atendeu_sem_decisor', 'atendeu_decisor', 'pediu_retorno', 'reuniao_marcada', 'sem_interesse'].includes(a.resultado)).length,
    };
  }, [dados, semAgenda, fimHoje]);

  if (!dados) return null;

  return (
    <div className="pagina">
      <AvisoBackup />
      <div className="pagina-head">
        <div>
          <h1>Fila do dia</h1>
          <p className="muted">
            {nHoje} agendados para hoje{nVencidas > 0 && <> · <span className="vencida">{nVencidas} atrasados</span></>} · {nSem} sem próxima ação
          </p>
        </div>
        <div className="kpis-mini">
          <div><b>{ligHoje}</b><span>ligações hoje</span></div>
          <div><b>{conHoje}</b><span>conexões hoje</span></div>
        </div>
      </div>
      <label className="check" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={semAgenda} onChange={(e) => setSemAgenda(e.target.checked)} />
        Incluir leads ativos sem próxima ação (não mostra score abaixo de 40 nem cadência pausada)
      </label>

      {fila.length === 0 ? (
        <Vazio>
          Nada na fila de hoje. 🎉<br />
          {dados.leads.length === 0 && <>
            Importe leads em <a href="#/importar">Importar</a> ou carregue dados de exemplo em <a href="#/config">Configurações</a>.<br />
            Atualizou o app? Traga seus dados em <a href="#/config">Configurações → Importar de versão anterior</a>.
          </>}
        </Vazio>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela fila">
            <thead>
              <tr>
                <th>#</th><th>Empresa</th><th>Telefone</th><th>Score</th><th>Maior lacuna</th><th>Temp.</th>
                <th>Tent.</th><th>Último contato</th><th>Próxima ação</th><th></th>
              </tr>
            </thead>
            <tbody>
              {fila.map((l, i) => {
                const p = prioridade(l);
                return (
                  <Fragment key={l.id}>
                    <tr className={`clicavel ${aberto === l.id ? 'aberta' : ''}`} onClick={() => abrirLead(l.id!)}>
                      <td className="muted">{i + 1}</td>
                      <td>
                        <b>{l.nome_empresa}</b>
                        <div className="muted small">
                          {ETAPA_LABEL[l.etapa_pipeline]}{l.fit === 'forte' && ' · fit forte'}
                          {p.nivel === 'validar_porte' && ' · validar porte'}
                          {p.nivel === 'so_fit_forte' && ' · confirmar porte'}
                        </div>
                      </td>
                      <td><Telefone tel={l.telefone} compacto /></td>
                      <td><ScoreBadge score={l.score} faixa={l.faixa_score} completo={l.diagnostico_completo} /></td>
                      <td><LacunaTag b={l.maior_lacuna} /></td>
                      <td><TempBadge t={l.temperatura} /></td>
                      <td>{l.tentativas}</td>
                      <td className="small">{formatarRelativo(l.ultimo_contato_data)}</td>
                      <td className="small">
                        <span className={vencida(l.proxima_acao_data) ? 'vencida' : ''}>{formatarRelativo(l.proxima_acao_data)}</span>
                        {l.proxima_acao && <div className="muted">{l.proxima_acao}</div>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="btn primary small" onClick={() => setAberto(aberto === l.id ? null : l.id!)}>
                          {aberto === l.id ? 'Fechar' : 'Registrar ligação'}
                        </button>
                      </td>
                    </tr>
                    {aberto === l.id && (
                      <tr className="linha-registro">
                        <td colSpan={10}>
                          <RegistroRapido lead={l} config={config} autoFocus onSaved={() => setAberto(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
