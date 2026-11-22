import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './components/AppContext';
import * as repo from './db/repo';
import { APP_VERSAO } from './domain/versao';
import { LeadDrawer } from './components/LeadDrawer';
import { BotaoTema } from './components/Tema';
import { Configuracoes } from './pages/Configuracoes';
import { Dashboard } from './pages/Dashboard';
import { Fila } from './pages/Fila';
import { Importar } from './pages/Importar';
import { Leads } from './pages/Leads';

const ROTAS = [
  { id: 'fila', label: 'Fila do dia', el: <Fila /> },
  { id: 'leads', label: 'Leads', el: <Leads /> },
  { id: 'dashboard', label: 'Dashboard', el: <Dashboard /> },
  { id: 'importar', label: 'Importar', el: <Importar /> },
  { id: 'config', label: 'Configurações', el: <Configuracoes /> },
];

function rotaAtual() {
  const h = window.location.hash.replace(/^#\/?/, '');
  return ROTAS.some((r) => r.id === h) ? h : 'fila';
}

export function App() {
  const [rota, setRota] = useState(rotaAtual);
  useEffect(() => {
    const h = () => setRota(rotaAtual());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return (
    <AppProvider>
      <nav className="topo">
        <span className="marca">📞 CRM Prospecção</span>
        <div className="abas">
          {ROTAS.map((r) => (
            <a key={r.id} href={`#/${r.id}`} className={rota === r.id ? 'on' : ''}>{r.label}</a>
          ))}
        </div>
        <span className="versao" title="Versão do app">v{APP_VERSAO}</span>
        <BotaoTema />
      </nav>
      <AtualizacaoLocal />
      <main>{ROTAS.find((r) => r.id === rota)!.el}</main>
      <LeadDrawer />
    </AppProvider>
  );
}

/** Ao abrir uma versão nova no mesmo navegador, atualiza os dados gravados pela versão anterior. */
let atualizacao: ReturnType<typeof repo.normalizarBancoLocal> | null = null; // roda uma única vez por carga

function AtualizacaoLocal() {
  const { toast } = useApp();
  useEffect(() => {
    if (atualizacao) return;
    atualizacao = repo.normalizarBancoLocal();
    atualizacao
      .then((r) => { if (r) toast(`App atualizado de ${r.de} para ${r.para}: seus dados foram preservados e convertidos.`); })
      .catch((e) => console.error('Falha ao atualizar dados locais', e));
  }, [toast]);
  return null;
}
