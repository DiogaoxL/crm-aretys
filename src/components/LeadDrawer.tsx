import { useEffect, useRef, useState } from 'react';
import * as repo from '../db/repo';
import { useAtividadesDoLead, useConfig, useLead, useReunioesDoLead, useVendasDoLead } from '../db/hooks';
import {
  BLOCO_LABEL, CAMPOS_DIAGNOSTICO, ETAPAS, MOTIVO_SEM_CONTATO, OPCOES_DIAGNOSTICO, RESULTADO_LABEL,
  RESULTADOS_CONTATO, STATUS_REUNIAO_LABEL, TEMPERATURAS, TIPO_LABEL,
} from '../domain/constants';
import {
  formatarData, formatarDataHora, formatarMoeda, formatarRelativo, hojeSP, diaHoraIso, inputLocalParaIso,
  isoParaInputLocal, somarDias, urlDoSite, vencida, formatarTelefone,
} from '../domain/format';
import { estadoCadencia } from '../domain/lead';
import { calcularScore, frasesAbordagem, prioridade } from '../domain/score';
import { numeroBR } from '../domain/csv';
import type { Config, Lead, StatusReuniao } from '../domain/types';
import { useApp } from './AppContext';
import { RegistroRapido } from './RegistroRapido';
import { FitBadge, LacunaTag, ScoreBadge, Telefone } from './ui';

export function LeadDrawer() {
  const { leadAberto, fecharLead, focoInicial } = useApp();
  const lead = useLead(leadAberto);
  const config = useConfig();
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (leadAberto == null) return;
    const h = (e: KeyboardEvent) => {
      if (document.querySelector('.overlay')) return; // há um modal aberto
      const alvo = e.target as HTMLElement;
      const digitando = ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName);
      if (e.key === 'Escape') {
        if (digitando) { alvo.blur(); return; }
        fecharLead();
        return;
      }
      if (digitando || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'l') {
        e.preventDefault();
        painelRef.current?.querySelector<HTMLButtonElement>('.registro .res')?.focus();
        painelRef.current?.querySelector('.registro')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (k === 'p') {
        e.preventDefault();
        painelRef.current?.querySelector<HTMLInputElement>('[data-atalho="proxima"]')?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [leadAberto, fecharLead]);

  if (leadAberto == null) return null;
  return (
    <div className="drawer-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) fecharLead(); }}>
      <aside className="drawer" ref={painelRef} aria-label="Ficha do lead">
        {lead === undefined ? <div className="vazio">Carregando…</div>
          : <Ficha key={lead.id} lead={lead} config={config} autoFocus={focoInicial === 'ligacao'} />}
      </aside>
    </div>
  );
}

function Ficha({ lead, config, autoFocus }: { lead: Lead; config: Config; autoFocus: boolean }) {
  const { fecharLead, mudarEtapa, toast } = useApp();
  const id = lead.id!;
  const salvar = (patch: Partial<Lead>) => repo.atualizarLead(id, patch);
  const cad = estadoCadencia(lead, config);
  const prio = prioridade(lead);
  const frases = frasesAbordagem(lead);
  const blocos = calcularScore(lead).blocos;

  async function onEtapa(etapa: Lead['etapa_pipeline']) {
    if (etapa === 'descartado' && !confirm('Mover este lead para “Descartado” (não ligar)?')) return;
    await mudarEtapa([id], etapa);
  }

  return (
    <div className="ficha">
      <header className="ficha-head">
        <div>
          <h2>{lead.nome_empresa}</h2>
          <div className="linha-flex wrap">
            <Telefone tel={lead.telefone} />
            {lead.site && <a href={urlDoSite(lead.site)} target="_blank" rel="noreferrer">{lead.dominio || lead.site}</a>}
            {[lead.segmento, lead.cidade].filter(Boolean).join(' · ') && <span className="muted">{[lead.segmento, lead.cidade].filter(Boolean).join(' · ')}</span>}
          </div>
          <div className="linha-flex wrap" style={{ marginTop: 8 }}>
            <ScoreBadge score={lead.score} faixa={lead.faixa_score} completo={lead.diagnostico_completo} curto={false} />
            <FitBadge fit={lead.fit} />
            <LacunaTag b={lead.maior_lacuna} />
          </div>
        </div>
        <button className="btn-icon" onClick={fecharLead} aria-label="Fechar ficha" title="Fechar (Esc)">✕</button>
      </header>

      <div className="linha-flex wrap barra-ficha">
        <label className="campo inline">Etapa
          <select value={lead.etapa_pipeline} onChange={(e) => onEtapa(e.target.value as Lead['etapa_pipeline'])}>
            {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </label>
        <div className="seg pequeno">
          {TEMPERATURAS.map((t) => (
            <button key={t.id} className={lead.temperatura === t.id ? `on temp-${t.id}` : ''} onClick={() => salvar({ temperatura: t.id })}>{t.label}</button>
          ))}
        </div>
        {lead.etapa_pipeline !== 'perdido' && (
          <button className="btn danger-outline" onClick={() => mudarEtapa([id], 'perdido')}>Marcar como perdido</button>
        )}
      </div>
      {lead.etapa_pipeline === 'perdido' && (
        <div className="aviso erro">Perdido: <b>{lead.motivo_perda}</b>{lead.motivo_perda_texto ? ` · ${lead.motivo_perda_texto}` : ''}</div>
      )}

      {/* Avisos e sugestões */}
      <div className={`aviso prio-${prio.nivel}`}>{prio.texto}</div>
      {!lead.diagnostico_completo && <div className="aviso alerta">Diagnóstico incompleto: itens “não verificado” valem 0.</div>}
      {lead.score < 40 && lead.diagnostico_completo && lead.etapa_pipeline !== 'descartado' && (
        <div className="aviso alerta linha-flex">
          <span>Score {lead.score}: estrutura completa. Sugestão: mover para Descartado.</span>
          <button className="btn small" onClick={() => onEtapa('descartado')}>Mover para Descartado</button>
        </div>
      )}
      {lead.diagnostico_completo && lead.etapa_pipeline === 'novo' && lead.score >= 40 && (
        <div className="aviso info linha-flex">
          <span>Diagnóstico feito. Mover para Qualificado?</span>
          <button className="btn small" onClick={() => mudarEtapa([id], 'qualificado')}>Mover</button>
        </div>
      )}
      {cad.esgotada && (
        <div className="aviso alerta linha-flex wrap">
          <span>Cadência encerrada: {cad.total} tentativas sem conexão.</span>
          <span className="linha-flex">
            <button className="btn small danger" onClick={async () => {
              await mudarEtapa([id], 'perdido', MOTIVO_SEM_CONTATO);
            }}>Mover para Perdido</button>
            <button className="btn small" onClick={() => repo.pausarCadencia(id, true)}>Pausar cadência</button>
          </span>
        </div>
      )}

      {/* Registro rápido */}
      <section className="card">
        <div className="card-head">
          <h3>Registrar atividade</h3>
          <span className="muted small">Atalhos: <kbd>L</kbd> ligação · <kbd>1</kbd>–<kbd>8</kbd> resultado · <kbd>P</kbd> próxima ação · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> salvar</span>
        </div>
        <RegistroRapido lead={lead} config={config} autoFocus={autoFocus} />
        <div className="cadencia">
          <span>
            {lead.cadencia_status === 'concluida'
              ? <>Cadência concluída (conectou na tentativa {lead.cadencia_tentativa + 1})</>
              : <>Tentativa <b>{Math.min(cad.tentativa, cad.total)} de {cad.total}</b>{lead.cadencia_dia > 0 && ` · dia ${lead.cadencia_dia} da cadência`}{lead.cadencia_status === 'pausada' && ' · pausada'}</>}
            {cad.proximo && <> · próximo: {TIPO_LABEL[cad.proximo.canal]} ({formatarRelativo(cad.proximo.data).replace(/ \d\d:\d\d$/, '')})</>}
          </span>
          <span className="linha-flex">
            {lead.cadencia_status === 'ativa' && <button className="btn-link" onClick={() => repo.pausarCadencia(id, true)}>Pausar</button>}
            {lead.cadencia_status === 'pausada' && <button className="btn-link" onClick={() => repo.pausarCadencia(id, false)}>Retomar</button>}
            <button className="btn-link" onClick={() => { if (confirm('Reiniciar a cadência deste lead?')) repo.reiniciarCadencia(id); }}>Reiniciar</button>
          </span>
        </div>
        <div className="info-grid">
          <div><span className="muted">Próxima ação</span>
            <div className={vencida(lead.proxima_acao_data) ? 'vencida' : ''}>
              {lead.proxima_acao || '—'} {lead.proxima_acao_data && <small>({formatarRelativo(lead.proxima_acao_data)})</small>}
            </div>
          </div>
          <div><span className="muted">Último contato</span><div>{formatarRelativo(lead.ultimo_contato_data)}</div></div>
          <div><span className="muted">Ligações</span><div>{lead.tentativas}</div></div>
        </div>
      </section>

      {frases.length > 0 && (
        <section className="card">
          <h3>Frases de abordagem</h3>
          {frases.map((f) => (
            <div key={f.objecao} className="frase"><b>{f.objecao}</b> → {f.resposta}</div>
          ))}
        </section>
      )}

      {/* Diagnóstico */}
      <section className="card">
        <div className="card-head">
          <h3>Diagnóstico de presença digital</h3>
          <div className="score-vivo"><b>{lead.score}</b>/100</div>
        </div>
        <div className="diag-grid">
          {CAMPOS_DIAGNOSTICO.map(({ campo, label }) => (
            <label key={campo} className="campo">{label}
              <select value={lead[campo]} onChange={(e) => salvar({ [campo]: e.target.value } as Partial<Lead>)}
                className={lead[campo] === 'nao_verificado' ? 'nv' : ''}>
                {OPCOES_DIAGNOSTICO[campo].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="blocos">
          {(Object.keys(blocos) as (keyof typeof blocos)[]).map((b) => {
            const max = { midia_paga: 40, conversao: 30, social: 15, gmn_local: 15 }[b];
            return (
              <div key={b} className={`bloco ${lead.maior_lacuna === b ? 'maior' : ''}`}>
                <span>{BLOCO_LABEL[b]}</span>
                <div className="barra"><div style={{ width: `${(blocos[b] / max) * 100}%` }} /></div>
                <span className="num">{blocos[b]}/{max}</span>
              </div>
            );
          })}
        </div>
        <CampoTexto lead={lead} campo="observacoes_diagnostico" label="Observações (links, evidências)" multilinha />
      </section>

      {/* Dados cadastrais */}
      <section className="card">
        <h3>Dados da empresa</h3>
        <div className="form-grid">
          <CampoTexto lead={lead} campo="nome_empresa" label="Empresa" obrigatorio />
          <CampoTexto lead={lead} campo="telefone" label="Telefone" obrigatorio exibir={formatarTelefone} />
          <CampoTexto lead={lead} campo="site" label="Site" obrigatorio />
          <CampoTexto lead={lead} campo="cnpj" label="CNPJ" />
          <CampoTexto lead={lead} campo="capital_social" label="Capital social (R$)" numero />
          <label className="campo">Fit
            <select value={lead.fit_manual ? lead.fit : 'auto'} onChange={(e) => {
              const v = e.target.value;
              salvar(v === 'auto' ? { fit_manual: false } : { fit_manual: true, fit: v as Lead['fit'] });
            }}>
              <option value="auto">Automático ({lead.fit_manual ? 'recalcular' : lead.fit})</option>
              <option value="forte">Forte (manual)</option>
              <option value="incerto">Incerto (manual)</option>
            </select>
          </label>
          <CampoTexto lead={lead} campo="segmento" label="Segmento" />
          <CampoTexto lead={lead} campo="cidade" label="Cidade" />
          <CampoTexto lead={lead} campo="origem" label="Origem" />
        </div>
        <h3 style={{ marginTop: 16 }}>Decisor {lead.decisor_identificado ? <span className="tag ok">identificado</span> : <span className="tag muted">não identificado</span>}</h3>
        <div className="form-grid">
          <CampoTexto lead={lead} campo="decisor_nome" label="Nome" />
          <CampoTexto lead={lead} campo="decisor_cargo" label="Cargo" />
          <CampoTexto lead={lead} campo="decisor_email" label="E-mail" />
          <CampoTexto lead={lead} campo="decisor_telefone" label="Telefone" exibir={formatarTelefone} />
        </div>
        {lead.decisor_telefone && <div style={{ marginTop: 6 }}><Telefone tel={lead.decisor_telefone} /></div>}
      </section>

      <Reunioes lead={lead} />
      <Vendas lead={lead} />
      <LinhaDoTempo lead={lead} />

      <div className="rodape-ficha">
        <span className="muted small">Criado em {formatarData(lead.criado_em)} · atualizado {formatarRelativo(lead.atualizado_em)}</span>
        <button className="btn-link perigo" onClick={async () => {
          if (confirm(`Excluir “${lead.nome_empresa}” e todo o histórico?`)) { await repo.excluirLeads([id]); fecharLead(); toast('Lead excluído'); }
        }}>Excluir lead</button>
      </div>
    </div>
  );
}

function CampoTexto({ lead, campo, label, obrigatorio, numero, multilinha, exibir }: {
  lead: Lead; campo: keyof Lead; label: string; obrigatorio?: boolean; numero?: boolean; multilinha?: boolean;
  exibir?: (v: string) => string;
}) {
  const { toast } = useApp();
  const bruto = lead[campo];
  const inicial = bruto == null ? '' : exibir ? exibir(String(bruto)) : String(bruto);
  const [v, setV] = useState(inicial);
  useEffect(() => setV(inicial), [inicial]);

  async function commit() {
    if (v === inicial) return;
    if (obrigatorio && !v.trim()) { toast(`${label} é obrigatório`); setV(inicial); return; }
    const valor = numero ? numeroBR(v) : v.trim();
    if (campo === 'telefone' || campo === 'site') {
      const dup = await repo.buscarDuplicado(campo === 'telefone' ? v : lead.telefone, campo === 'site' ? v : lead.site, lead.id);
      if (dup && !confirm(`Já existe o lead “${dup.nome_empresa}” com este ${campo}. Salvar mesmo assim?`)) { setV(inicial); return; }
    }
    await repo.atualizarLead(lead.id!, { [campo]: valor } as Partial<Lead>);
  }
  const props = {
    value: v,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
  };
  return (
    <label className={`campo ${multilinha ? 'full' : ''}`}>{label}{obrigatorio && ' *'}
      {multilinha ? <textarea rows={3} {...props} /> : <input {...props} inputMode={numero ? 'decimal' : undefined}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
    </label>
  );
}

function Reunioes({ lead }: { lead: Lead }) {
  const reunioes = useReunioesDoLead(lead.id!);
  const { mudarEtapa, toast } = useApp();
  const [data, setData] = useState(isoParaInputLocal(diaHoraIso(somarDias(hojeSP(), 2), '10:00')));
  const [obs, setObs] = useState('');
  const [aberto, setAberto] = useState(false);

  async function status(id: number, s: StatusReuniao) {
    await repo.atualizarReuniao(id, { status: s });
    if (s === 'realizada' && ['novo', 'qualificado', 'em_contato', 'conectado', 'decisor_conectado', 'reuniao_marcada'].includes(lead.etapa_pipeline)) {
      if (confirm('Mover o lead para “Reunião realizada”?')) await mudarEtapa([lead.id!], 'reuniao_realizada');
    }
    if (s === 'no_show') toast('No-show registrado. Remarque com “+ Marcar reunião”.');
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>Reuniões</h3>
        <button className="btn small" onClick={() => setAberto(!aberto)}>+ Marcar reunião</button>
      </div>
      {aberto && (
        <form className="linha-flex wrap" onSubmit={async (e) => {
          e.preventDefault();
          const iso = inputLocalParaIso(data);
          if (!iso) return;
          await repo.criarReuniao({ lead_id: lead.id!, data_hora: iso, status: 'marcada', observacoes: obs });
          if (['novo', 'qualificado', 'em_contato', 'conectado', 'decisor_conectado'].includes(lead.etapa_pipeline)) {
            await mudarEtapa([lead.id!], 'reuniao_marcada');
          }
          setObs(''); setAberto(false); toast('Reunião marcada');
        }}>
          <input type="datetime-local" value={data} onChange={(e) => setData(e.target.value)} required />
          <input placeholder="Observações" value={obs} onChange={(e) => setObs(e.target.value)} style={{ flex: 1 }} />
          <button className="btn primary small">Salvar</button>
        </form>
      )}
      {reunioes.length === 0 && !aberto && <p className="muted small">Nenhuma reunião.</p>}
      {reunioes.map((r) => (
        <div key={r.id} className="item-lista">
          <div>
            <b>{formatarDataHora(r.data_hora)}</b>
            {r.observacoes && <div className="muted small">{r.observacoes}</div>}
          </div>
          <div className="linha-flex">
            <select value={r.status} onChange={(e) => status(r.id!, e.target.value as StatusReuniao)} className={`st-${r.status}`}>
              {(Object.keys(STATUS_REUNIAO_LABEL) as StatusReuniao[]).map((s) => <option key={s} value={s}>{STATUS_REUNIAO_LABEL[s]}</option>)}
            </select>
            <button className="btn-icon" title="Excluir" onClick={() => { if (confirm('Excluir reunião?')) repo.excluirReuniao(r.id!); }}>🗑</button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Vendas({ lead }: { lead: Lead }) {
  const vendas = useVendasDoLead(lead.id!);
  const { toast } = useApp();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState('');
  const [obs, setObs] = useState('');
  return (
    <section className="card">
      <div className="card-head">
        <h3>Venda</h3>
        <button className="btn small" onClick={() => setAberto(!aberto)}>+ Registrar venda</button>
      </div>
      {aberto && (
        <form className="linha-flex wrap" onSubmit={async (e) => {
          e.preventDefault();
          await repo.registrarVenda({ lead_id: lead.id!, data: new Date().toISOString(), valor: numeroBR(valor), observacoes: obs });
          setAberto(false); setValor(''); setObs(''); toast('Venda registrada · Venda ganha 🎉');
        }}>
          <input placeholder="Valor (opcional)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} style={{ width: 150 }} />
          <input placeholder="Observações" value={obs} onChange={(e) => setObs(e.target.value)} style={{ flex: 1 }} />
          <button className="btn primary small">Salvar</button>
        </form>
      )}
      {vendas.length === 0 && !aberto && <p className="muted small">Nenhuma venda.</p>}
      {vendas.map((v) => (
        <div key={v.id} className="item-lista">
          <div><b>{formatarMoeda(v.valor)}</b> · {formatarData(v.data)}{v.observacoes && <div className="muted small">{v.observacoes}</div>}</div>
          <button className="btn-icon" title="Excluir" onClick={() => { if (confirm('Excluir venda?')) repo.excluirVenda(v.id!); }}>🗑</button>
        </div>
      ))}
    </section>
  );
}

function LinhaDoTempo({ lead }: { lead: Lead }) {
  const atividades = useAtividadesDoLead(lead.id!);
  return (
    <section className="card">
      <h3>Linha do tempo ({atividades.length})</h3>
      {atividades.length === 0 && <p className="muted small">Nenhuma atividade registrada.</p>}
      <ol className="timeline">
        {atividades.map((a) => (
          <li key={a.id} className={RESULTADOS_CONTATO.includes(a.resultado) ? 'pos' : ''}>
            <div className="tl-head">
              <span><b>{TIPO_LABEL[a.tipo]}</b> · {RESULTADO_LABEL[a.resultado]}</span>
              <span className="muted small">{formatarDataHora(a.data_hora)}
                <button className="btn-icon mini" title="Excluir atividade" onClick={() => {
                  if (confirm('Excluir esta atividade? (contadores do lead não são recalculados)')) repo.excluirAtividade(a.id!);
                }}>✕</button>
              </span>
            </div>
            {a.comentario && <div className="tl-com">{a.comentario}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

