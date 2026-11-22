import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import * as repo from '../db/repo';
import { useConfig } from '../db/hooks';
import { ETAPA_LABEL, MOTIVO_OUTRO } from '../domain/constants';
import type { Etapa } from '../domain/types';
import { Modal } from './ui';

export interface MotivoPerda { motivo: string; texto: string }

interface Ctx {
  leadAberto: number | null;
  focoInicial: 'ligacao' | null;
  abrirLead: (id: number, foco?: 'ligacao') => void;
  fecharLead: () => void;
  toast: (msg: string) => void;
  pedirMotivoPerda: (sugerido?: string) => Promise<MotivoPerda | null>;
  /** Muda a etapa de um ou mais leads, pedindo o motivo quando for "Perdido". */
  mudarEtapa: (ids: number[], etapa: Etapa, motivoSugerido?: string) => Promise<boolean>;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [leadAberto, setLeadAberto] = useState<number | null>(null);
  const [focoInicial, setFocoInicial] = useState<'ligacao' | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [pedido, setPedido] = useState<{ sugerido?: string; resolve: (m: MotivoPerda | null) => void } | null>(null);
  const seq = useRef(0);

  const toast = useCallback((msg: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const pedirMotivoPerda = useCallback((sugerido?: string) =>
    new Promise<MotivoPerda | null>((resolve) => setPedido({ sugerido, resolve })), []);

  const mudarEtapa = useCallback(async (ids: number[], etapa: Etapa, motivoSugerido?: string) => {
    if (!ids.length) return false;
    if (etapa === 'perdido') {
      const m = await pedirMotivoPerda(motivoSugerido);
      if (!m) return false;
      await repo.atualizarEmMassa(ids, { etapa_pipeline: 'perdido', motivo_perda: m.motivo, motivo_perda_texto: m.texto });
    } else {
      await repo.atualizarEmMassa(ids, { etapa_pipeline: etapa });
    }
    toast(ids.length > 1 ? `${ids.length} leads movidos para ${ETAPA_LABEL[etapa]}` : `Movido para ${ETAPA_LABEL[etapa]}`);
    return true;
  }, [pedirMotivoPerda, toast]);

  const value: Ctx = {
    leadAberto, focoInicial,
    abrirLead: (id, foco) => { setLeadAberto(id); setFocoInicial(foco ?? null); },
    fecharLead: () => { setLeadAberto(null); setFocoInicial(null); },
    toast, pedirMotivoPerda, mudarEtapa,
  };

  return (
    <AppCtx.Provider value={value}>
      {children}
      {pedido && (
        <MotivoPerdaModal
          sugerido={pedido.sugerido}
          onCancel={() => { pedido.resolve(null); setPedido(null); }}
          onOk={(m) => { pedido.resolve(m); setPedido(null); }}
        />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </AppCtx.Provider>
  );
}

function MotivoPerdaModal({ sugerido, onOk, onCancel }: {
  sugerido?: string; onOk: (m: MotivoPerda) => void; onCancel: () => void;
}) {
  const config = useConfig();
  const [motivo, setMotivo] = useState(sugerido ?? '');
  const [texto, setTexto] = useState('');
  const outro = motivo === MOTIVO_OUTRO || motivo.toLowerCase().startsWith('outro');
  const valido = !!motivo && (!outro || texto.trim().length > 0);
  return (
    <Modal titulo="Motivo da perda" onClose={onCancel} largura={460}>
      <form onSubmit={(e) => { e.preventDefault(); if (valido) onOk({ motivo, texto: texto.trim() }); }}>
        <p className="muted small">Obrigatório para mover para “Perdido”.</p>
        <div className="radio-lista">
          {config.motivos_perda.map((m) => (
            <label key={m} className={`radio ${motivo === m ? 'on' : ''}`}>
              <input type="radio" name="motivo" checked={motivo === m} onChange={() => setMotivo(m)} /> {m}
            </label>
          ))}
        </div>
        {outro && (
          <textarea autoFocus placeholder="Descreva o motivo" value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} />
        )}
        {!outro && motivo && (
          <input placeholder="Detalhe (opcional)" value={texto} onChange={(e) => setTexto(e.target.value)} />
        )}
        <div className="acoes">
          <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="btn danger" disabled={!valido}>Marcar como perdido</button>
        </div>
      </form>
    </Modal>
  );
}
