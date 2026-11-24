import { useEffect, useState, type ReactNode } from 'react';
import { BLOCO_LABEL, FAIXA_CURTA, FAIXA_LABEL, TEMP_LABEL } from '../domain/constants';
import { formatarTelefone } from '../domain/format';
import type { Bloco, FaixaScore, Fit, Temperatura } from '../domain/types';

export function Modal({ titulo, onClose, children, largura = 520 }: {
  titulo: string; onClose: () => void; children: ReactNode; largura?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: largura }} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-head">
          <h3>{titulo}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ScoreBadge({ score, faixa, completo = true, curto = true }: {
  score: number; faixa: FaixaScore; completo?: boolean; curto?: boolean;
}) {
  return (
    <span className={`badge faixa-${faixa}`} title={FAIXA_LABEL[faixa] + (completo ? '' : ' · diagnóstico incompleto')}>
      <b>{score}</b> {curto ? FAIXA_CURTA[faixa] : FAIXA_LABEL[faixa]}{!completo && ' *'}
    </span>
  );
}

export function FitBadge({ fit }: { fit: Fit }) {
  return <span className={`badge fit-${fit}`}>Fit {fit}</span>;
}

export function TempBadge({ t }: { t: Temperatura }) {
  return <span className={`badge temp-${t}`}>{TEMP_LABEL[t]}</span>;
}

export function LacunaTag({ b }: { b: Bloco | null }) {
  if (!b) return <span className="tag muted">Sem lacuna</span>;
  return <span className="tag">{BLOCO_LABEL[b]}</span>;
}

export function Telefone({ tel, compacto }: { tel: string; compacto?: boolean }) {
  if (!tel) return <span className="muted">—</span>;
  return (
    <span className="tel" onClick={(e) => e.stopPropagation()}>
      <a href={`tel:+${tel}`} title="Ligar">{formatarTelefone(tel)}</a>
      <a className="wa" href={`https://wa.me/${tel}`} target="_blank" rel="noreferrer" title="Abrir WhatsApp">
        {compacto ? 'WA' : 'WhatsApp'}
      </a>
    </span>
  );
}

/**
 * Barra de progresso para operações em andamento.
 * Com `total`: barra real (atual/total). Sem `total`: barra animada (a operação não informa o andamento),
 * sempre com o tempo decorrido para o usuário acompanhar.
 */
export function BarraProgresso({ rotulo, atual, total, detalhe }: {
  rotulo: string; atual?: number; total?: number; detalhe?: string;
}) {
  const [inicio] = useState(() => Date.now());
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const seg = Math.floor((agora - inicio) / 1000);
  const decorrido = seg < 60 ? `${seg}s` : `${Math.floor(seg / 60)}min ${String(seg % 60).padStart(2, '0')}s`;
  const pct = total ? Math.min(100, (100 * (atual ?? 0)) / total) : null;
  return (
    <div className="progresso" role="progressbar" aria-label={rotulo}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
      <div className="progresso-topo">
        <b>{rotulo}</b>
        <span className="muted small">
          {pct != null && <><b>{atual} de {total}</b> · {pct.toFixed(0)}% · </>}{decorrido}
        </span>
      </div>
      <div className={`barra${pct == null ? ' indeterminada' : ''}`}>
        <div style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
      {detalhe && <div className="muted small">{detalhe}</div>}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>;
}
