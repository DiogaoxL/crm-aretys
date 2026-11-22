import { useEffect, useMemo, useRef, useState } from 'react';
import * as repo from '../db/repo';
import {
  ETAPA_LABEL, ETAPA_ORDEM, ETAPA_SUGERIDA, ETAPAS_FINAIS, RESULTADO_LABEL, RESULTADOS_CONTATO,
  RESULTADOS_ESCRITOS, RESULTADOS_LIGACAO, TIPO_LABEL, TIPOS_ATIVIDADE, TEMPERATURAS,
} from '../domain/constants';
import { diaHoraIso, diaSP, hojeSP, inputLocalParaIso, isoParaInputLocal, somarDias } from '../domain/format';
import type { Config, Etapa, Lead, ResultadoAtividade, Temperatura, TipoAtividade } from '../domain/types';
import { useApp } from './AppContext';

function sugerirEtapa(lead: Lead, res: ResultadoAtividade | ''): Etapa | null {
  if (!res) return null;
  const s = ETAPA_SUGERIDA[res];
  if (s === lead.etapa_pipeline) return null;
  if (s === 'perdido') return 'perdido';
  if (ETAPAS_FINAIS.includes(lead.etapa_pipeline)) return null;
  return ETAPA_ORDEM[s] > ETAPA_ORDEM[lead.etapa_pipeline] ? s : null;
}

function emDias(n: number) {
  return isoParaInputLocal(diaHoraIso(somarDias(hojeSP(), n), '09:00'));
}

function sugerirProxima(lead: Lead, config: Config, res: ResultadoAtividade | '', reuniao: string): { texto: string; data: string } | null {
  if (!res) return null;
  switch (res) {
    case 'pediu_retorno': return { texto: 'Retornar ligação (pediu retorno)', data: emDias(1) };
    case 'atendeu_sem_decisor': return { texto: 'Tentar falar com o decisor', data: emDias(1) };
    case 'atendeu_decisor': return { texto: 'Follow-up com o decisor', data: emDias(3) };
    case 'respondeu': return { texto: 'Dar sequência à conversa', data: emDias(1) };
    case 'sem_interesse': return { texto: '', data: '' };
    case 'reuniao_marcada': {
      const r = inputLocalParaIso(reuniao);
      if (!r) return { texto: 'Confirmar reunião', data: emDias(1) };
      const vespera = somarDias(diaSP(r), -1);
      const dia = vespera < hojeSP() ? hojeSP() : vespera;
      return { texto: 'Confirmar reunião', data: isoParaInputLocal(diaHoraIso(dia, '09:00')) };
    }
  }
  // Sem contato: próximo passo da cadência (esta tentativa conta como uma)
  if (lead.cadencia_status !== 'ativa') return { texto: 'Nova tentativa', data: emDias(2) };
  const proxIdx = (lead.cadencia_tentativa ?? 0) + 1;
  const total = config.cadencia.length;
  if (proxIdx >= total) return { texto: 'Cadência encerrada: decidir entre Perdido ou pausar', data: emDias(1) };
  const passo = config.cadencia[proxIdx];
  const inicio = lead.cadencia_inicio ? diaSP(lead.cadencia_inicio) : hojeSP();
  let dia = somarDias(inicio, passo.dia - 1);
  if (dia <= hojeSP()) dia = somarDias(hojeSP(), 1);
  return { texto: `Tentativa ${proxIdx + 1}/${total} da cadência: ${TIPO_LABEL[passo.canal]}`, data: isoParaInputLocal(diaHoraIso(dia, '09:00')) };
}

export function RegistroRapido({ lead, config, autoFocus, onSaved, tipoInicial }: {
  lead: Lead; config: Config; autoFocus?: boolean; onSaved?: (lead: Lead) => void; tipoInicial?: TipoAtividade;
}) {
  const { toast, pedirMotivoPerda } = useApp();
  const [tipo, setTipo] = useState<TipoAtividade>(tipoInicial ?? 'ligacao');
  const [resultado, setResultado] = useState<ResultadoAtividade | ''>('');
  const [comentario, setComentario] = useState('');
  const [reuniao, setReuniao] = useState(emDias(2).replace('09:00', '10:00'));
  const [prox, setProx] = useState(lead.proxima_acao ?? '');
  const [proxData, setProxData] = useState(isoParaInputLocal(lead.proxima_acao_data));
  const [proxEditada, setProxEditada] = useState(false);
  const [moverEtapa, setMoverEtapa] = useState(true);
  const [temp, setTemp] = useState<Temperatura>(lead.temperatura);
  const [salvando, setSalvando] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const primeiroRef = useRef<HTMLButtonElement>(null);

  const opcoes = tipo === 'ligacao' ? RESULTADOS_LIGACAO : RESULTADOS_ESCRITOS;
  const etapaSugerida = useMemo(() => sugerirEtapa(lead, resultado), [lead, resultado]);

  useEffect(() => { if (autoFocus) primeiroRef.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (resultado && !opcoes.includes(resultado)) setResultado(''); }, [tipo]); // eslint-disable-line

  // Pré-preenche a próxima ação conforme o resultado (se o usuário não editou)
  useEffect(() => {
    if (proxEditada) return;
    const s = sugerirProxima(lead, config, resultado, reuniao);
    if (s) { setProx(s.texto); setProxData(s.data); }
    if (resultado === 'reuniao_marcada') setTemp('quente');
    else if (resultado === 'atendeu_decisor' && lead.temperatura === 'frio') setTemp('morno');
  }, [resultado, reuniao]); // eslint-disable-line

  async function salvar() {
    if (!resultado || salvando) return;
    if (resultado === 'reuniao_marcada' && !inputLocalParaIso(reuniao)) { toast('Informe a data da reunião'); return; }
    setSalvando(true);
    try {
      let motivo: { motivo: string; texto: string } | null = null;
      const nova = moverEtapa ? etapaSugerida : null;
      if (nova === 'perdido') {
        motivo = await pedirMotivoPerda(resultado === 'sem_interesse' ? 'Sem interesse' : undefined);
        if (!motivo) { setSalvando(false); return; }
      }
      const atualizado = await repo.registrarAtividade({
        lead_id: lead.id!, tipo, resultado, comentario: comentario.trim(),
        proxima_acao: prox.trim(), proxima_acao_data: inputLocalParaIso(proxData),
        nova_etapa: nova, motivo_perda: motivo?.motivo, motivo_perda_texto: motivo?.texto,
        temperatura: temp,
        reuniao_data_hora: resultado === 'reuniao_marcada' ? inputLocalParaIso(reuniao) : null,
      });
      toast(`${TIPO_LABEL[tipo]} registrada${nova ? ` · ${ETAPA_LABEL[nova]}` : ''}`);
      setResultado(''); setComentario(''); setProxEditada(false);
      onSaved?.(atualizado);
    } finally {
      setSalvando(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); salvar(); return; }
    const alvo = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= opcoes.length) { e.preventDefault(); setResultado(opcoes[n - 1]); }
  }

  const atalho = (n: number) => { setProxData(emDias(n)); setProxEditada(true); };

  return (
    <form ref={formRef} className="registro" onSubmit={(e) => { e.preventDefault(); salvar(); }} onKeyDown={onKeyDown}>
      <div className="seg">
        {TIPOS_ATIVIDADE.map((t) => (
          <button type="button" key={t.id} className={tipo === t.id ? 'on' : ''} onClick={() => setTipo(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="resultados">
        {opcoes.map((r, i) => (
          <button
            type="button" key={r} ref={i === 0 ? primeiroRef : undefined}
            className={`res ${resultado === r ? 'on' : ''} ${RESULTADOS_CONTATO.includes(r) ? 'pos' : ''}`}
            onClick={() => setResultado(r)}
          >
            <kbd>{i + 1}</kbd> {RESULTADO_LABEL[r]}
          </button>
        ))}
      </div>

      {resultado === 'reuniao_marcada' && (
        <label className="campo">Data e hora da reunião
          <input type="datetime-local" value={reuniao} onChange={(e) => setReuniao(e.target.value)} required />
        </label>
      )}

      <textarea placeholder="Comentário (opcional)" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />

      <div className="prox">
        <input
          placeholder="Próxima ação" value={prox}
          onChange={(e) => { setProx(e.target.value); setProxEditada(true); }}
          data-atalho="proxima"
        />
        <div className="prox-data">
          <input type="datetime-local" value={proxData} onChange={(e) => { setProxData(e.target.value); setProxEditada(true); }} />
          <button type="button" className="chip" onClick={() => atalho(1)}>Amanhã</button>
          <button type="button" className="chip" onClick={() => atalho(3)}>3 dias</button>
          <button type="button" className="chip" onClick={() => atalho(7)}>1 semana</button>
        </div>
      </div>

      <div className="linha-flex">
        <div className="seg pequeno" title="Temperatura">
          {TEMPERATURAS.map((t) => (
            <button type="button" key={t.id} className={temp === t.id ? `on temp-${t.id}` : ''} onClick={() => setTemp(t.id)}>{t.label}</button>
          ))}
        </div>
        {etapaSugerida && (
          <label className="check">
            <input type="checkbox" checked={moverEtapa} onChange={(e) => setMoverEtapa(e.target.checked)} />
            Mover para <b>{ETAPA_LABEL[etapaSugerida]}</b>
          </label>
        )}
        <button type="submit" className="btn primary" disabled={!resultado || salvando} title="Ctrl+Enter">
          Salvar
        </button>
      </div>
    </form>
  );
}
