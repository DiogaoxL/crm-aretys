import { useEffect, useState } from 'react';

export type Tema = 'sistema' | 'claro' | 'escuro';
const CHAVE = 'crm-tema'; // prefixo "crm-": vai junto no backup (preferências)
const OPCOES: { id: Tema; label: string; icone: string }[] = [
  { id: 'sistema', label: 'Sistema', icone: '🖥' },
  { id: 'claro', label: 'Claro', icone: '☀' },
  { id: 'escuro', label: 'Escuro', icone: '☾' },
];

function lerTema(): Tema {
  try {
    const v = localStorage.getItem(CHAVE);
    return v === 'claro' || v === 'escuro' ? v : 'sistema';
  } catch { return 'sistema'; }
}

const midia = () => window.matchMedia?.('(prefers-color-scheme: dark)');

function aplicar(t: Tema) {
  const escuro = t === 'escuro' || (t === 'sistema' && !!midia()?.matches);
  document.documentElement.dataset.theme = escuro ? 'dark' : 'light';
}

const ouvintes = new Set<(t: Tema) => void>();

export function useTema(): [Tema, (t: Tema) => void] {
  const [tema, setLocal] = useState<Tema>(lerTema);
  useEffect(() => {
    ouvintes.add(setLocal);
    return () => { ouvintes.delete(setLocal); };
  }, []);
  useEffect(() => {
    aplicar(tema);
    if (tema !== 'sistema') return;
    const m = midia();
    const h = () => aplicar('sistema');
    m?.addEventListener?.('change', h);
    return () => m?.removeEventListener?.('change', h);
  }, [tema]);
  const setTema = (t: Tema) => {
    try { localStorage.setItem(CHAVE, t); } catch { /* ignore */ }
    ouvintes.forEach((f) => f(t));
  };
  return [tema, setTema];
}

/** Botão do topo: alterna Sistema → Claro → Escuro. */
export function BotaoTema() {
  const [tema, setTema] = useTema();
  const i = OPCOES.findIndex((o) => o.id === tema);
  const atual = OPCOES[i];
  const prox = OPCOES[(i + 1) % OPCOES.length];
  return (
    <button className="tema-btn" onClick={() => setTema(prox.id)} title={`Tema: ${atual.label}. Clique para ${prox.label}`} aria-label={`Tema: ${atual.label}`}>
      {atual.icone} {atual.label}
    </button>
  );
}

/** Seletor para a tela de Configurações. */
export function SeletorTema() {
  const [tema, setTema] = useTema();
  return (
    <div className="seg">
      {OPCOES.map((o) => (
        <button key={o.id} className={tema === o.id ? 'on' : ''} onClick={() => setTema(o.id)}>{o.icone} {o.label}</button>
      ))}
    </div>
  );
}
