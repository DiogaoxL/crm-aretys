import { useEffect, useState } from 'react';
import * as repo from '../db/repo';
import { useConfig } from '../db/hooks';
import { CONFIG_PADRAO, ETAPAS, TIPOS_ATIVIDADE, TRANSICOES } from '../domain/constants';
import { baixarArquivo, csvAtividades, csvLeads, numeroBR } from '../domain/csv';
import { formatarDataHora, hojeSP } from '../domain/format';
import { gerarDadosExemplo } from '../domain/sample';
import type { Backup, Config, PassoCadencia, TipoAtividade } from '../domain/types';
import type { OrigemBackup } from '../db/migracoes';
import { APP_VERSAO, FORMATO_BACKUP } from '../domain/versao';
import { useApp } from '../components/AppContext';
import { Modal } from '../components/ui';
import { SeletorTema } from '../components/Tema';

export async function exportarTudo() {
  const b = await repo.exportarBackup();
  baixarArquivo(`crm-backup-${hojeSP()}-v${APP_VERSAO}.json`, JSON.stringify(b, null, 2), 'application/json');
  await repo.marcarBackupFeito();
}

export function Configuracoes() {
  const config = useConfig();
  const { toast } = useApp();
  const salvar = async (patch: Partial<Config>, msg = 'Configuração salva') => { await repo.salvarConfig(patch); toast(msg); };

  return (
    <div className="pagina">
      <div className="pagina-head"><h1>Configurações</h1></div>
      <div className="config">
        <Backup config={config} />
        <div className="config-cols">
          <div className="config-col">
            <section className="card">
            <h3>Aparência</h3>
            <SeletorTema />
            <p className="muted small">“Sistema” segue o tema claro ou escuro do Windows/navegador.</p>
          </section>
            <section className="card">
            <h3>Metas de conversão do funil</h3>
            {TRANSICOES.map((t) => (
              <label key={t.id} className="campo inline-espaco">
                <span>{t.label}</span>
                <span className="meta-input">
                  <input type="number" min={0} max={100} defaultValue={config.metas[t.id]} key={config.metas[t.id]}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (!isNaN(v) && v !== config.metas[t.id]) salvar({ metas: { ...config.metas, [t.id]: Math.max(0, Math.min(100, v)) } });
                    }} />%
                </span>
              </label>
            ))}
            <button className="btn-link" onClick={() => salvar({ metas: CONFIG_PADRAO.metas }, 'Metas restauradas')}>Restaurar padrão</button>
          </section>
            <section className="card">
            <h3>Fit</h3>
            <label className="campo">Capital social mínimo para fit forte (R$)
              <input defaultValue={config.limite_fit_forte} key={config.limite_fit_forte} inputMode="decimal"
                onBlur={(e) => {
                  const v = numeroBR(e.target.value);
                  if (v != null && v !== config.limite_fit_forte) salvar({ limite_fit_forte: v }, 'Limite salvo: fit recalculado');
                }} />
            </label>
            <p className="muted small">Leads com fit definido manualmente não são alterados.</p>
          </section>
            <section className="card">
            <h3>Etapas visíveis no kanban</h3>
            <div className="checks">
              {ETAPAS.map((e) => (
                <label key={e.id} className="check">
                  <input type="checkbox" checked={config.etapas_visiveis.includes(e.id)} onChange={(ev) => {
                    const nova = ev.target.checked ? [...config.etapas_visiveis, e.id] : config.etapas_visiveis.filter((x) => x !== e.id);
                    salvar({ etapas_visiveis: ETAPAS.map((x) => x.id).filter((x) => nova.includes(x)) });
                  }} /> {e.label}
                </label>
              ))}
            </div>
          </section>
          </div>
          <div className="config-col">
            <Cadencia config={config} />
            <Motivos config={config} />
          </div>
        </div>
        <Dados />
      </div>
    </div>
  );
}

function Cadencia({ config }: { config: Config }) {
  const { toast } = useApp();
  const [passos, setPassos] = useState<PassoCadencia[]>(config.cadencia);
  useEffect(() => setPassos(config.cadencia), [config.cadencia]);
  const mudou = JSON.stringify(passos) !== JSON.stringify(config.cadencia);
  const ultimoDia = passos.length ? Math.max(...passos.map((p) => p.dia)) : 0;
  return (
    <section className="card">
      <h3>Cadência padrão</h3>
      <p className="muted small">{passos.length} tentativas em {ultimoDia} dias. Após a última tentativa sem conexão, o app sugere Perdido ou pausar.</p>
      {passos.map((p, i) => (
        <div key={i} className="linha-flex passo">
          <span className="muted">#{i + 1}</span>
          <label className="campo inline">Dia
            <input type="number" min={1} value={p.dia} style={{ width: 64 }}
              onChange={(e) => setPassos(passos.map((x, j) => (j === i ? { ...x, dia: Math.max(1, Number(e.target.value) || 1) } : x)))} />
          </label>
          <select value={p.canal} onChange={(e) => setPassos(passos.map((x, j) => (j === i ? { ...x, canal: e.target.value as TipoAtividade } : x)))}>
            {TIPOS_ATIVIDADE.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button className="btn-icon" onClick={() => setPassos(passos.filter((_, j) => j !== i))} title="Remover" disabled={passos.length <= 1}>✕</button>
        </div>
      ))}
      <div className="linha-flex">
        <button className="btn small" onClick={() => setPassos([...passos, { dia: ultimoDia + 2, canal: 'ligacao' }])}>+ Tentativa</button>
        <button className="btn primary small" disabled={!mudou} onClick={async () => {
          await repo.salvarConfig({ cadencia: [...passos].sort((a, b) => a.dia - b.dia) }); toast('Cadência salva');
        }}>Salvar cadência</button>
        <button className="btn-link" onClick={() => setPassos(CONFIG_PADRAO.cadencia)}>Padrão (6 em 14 dias)</button>
      </div>
    </section>
  );
}

function Motivos({ config }: { config: Config }) {
  const { toast } = useApp();
  const [novo, setNovo] = useState('');
  const salvar = (m: string[]) => repo.salvarConfig({ motivos_perda: m }).then(() => toast('Motivos salvos'));
  return (
    <section className="card">
      <h3>Motivos de perda</h3>
      <ul className="lista-edit">
        {config.motivos_perda.map((m, i) => (
          <li key={m}>
            <span>{m}</span>
            <span>
              <button className="btn-icon mini" disabled={i === 0} onClick={() => {
                const a = [...config.motivos_perda]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; salvar(a);
              }} title="Subir">↑</button>
              <button className="btn-icon mini" onClick={() => {
                if (confirm(`Remover o motivo “${m}”? Leads já perdidos mantêm o texto.`)) salvar(config.motivos_perda.filter((x) => x !== m));
              }} title="Remover">✕</button>
            </span>
          </li>
        ))}
      </ul>
      <form className="linha-flex" onSubmit={(e) => {
        e.preventDefault();
        const v = novo.trim();
        if (v && !config.motivos_perda.includes(v)) { salvar([...config.motivos_perda, v]); setNovo(''); }
      }}>
        <input placeholder="Novo motivo" value={novo} onChange={(e) => setNovo(e.target.value)} style={{ flex: 1 }} />
        <button className="btn small">Adicionar</button>
      </form>
    </section>
  );
}

function Backup({ config }: { config: Config }) {
  const { toast } = useApp();
  const [pendente, setPendente] = useState<{
    nome: string; backup: Backup; origem: OrigemBackup; avisos: string[]; atual: Contagem;
  } | null>(null);
  const [resultado, setResultado] = useState<{ titulo: string; linhas: string[]; ok: boolean } | null>(null);
  const [processando, setProcessando] = useState(false);

  async function abrir(file?: File) {
    if (!file) return;
    let obj: unknown;
    try {
      obj = JSON.parse(await file.text());
    } catch {
      toast('Não foi possível ler o arquivo: não é um JSON válido');
      return;
    }
    const r = repo.prepararBackup(obj);
    if (!r.ok) { setResultado({ titulo: 'Importação não realizada', linhas: [r.erro], ok: false }); return; }
    setPendente({ nome: file.name, backup: r.backup, origem: r.origem, avisos: r.avisos, atual: await repo.contagemAtual() });
  }

  async function restaurar(modo: 'substituir' | 'mesclar') {
    if (!pendente || processando) return;
    const temDados = pendente.atual.leads + pendente.atual.atividades > 0;
    if (modo === 'substituir' && temDados
      && !confirm(`Substituir os dados atuais (${pendente.atual.leads} leads) pelo conteúdo do arquivo?\n\nAntes disso, um backup de segurança dos dados atuais será baixado.`)) return;
    setProcessando(true);
    try {
      if (modo === 'substituir' && temDados) {
        const seg = await repo.exportarBackup();
        baixarArquivo(`crm-backup-seguranca-${hojeSP()}-v${APP_VERSAO}.json`, JSON.stringify(seg, null, 2), 'application/json');
      }
      const r = await repo.importarBackup(pendente.backup, modo);
      const depois = await repo.contagemAtual();
      const esperado = pendente.backup.contagens!;
      const linhas: string[] = [];
      let ok = true;
      if (modo === 'substituir') {
        for (const k of ['leads', 'atividades', 'reunioes', 'vendas'] as const) {
          const bate = depois[k] === esperado[k];
          ok &&= bate;
          linhas.push(`${ROTULO[k]}: ${depois[k]} de ${esperado[k]} ${bate ? '✓' : '✗'}`);
        }
      } else {
        linhas.push(`${r.leads} leads novos adicionados com o histórico.`, `${r.ignorados} já existiam (mesmo telefone ou site) e foram mantidos como estavam.`);
      }
      setPendente(null);
      setResultado({
        titulo: ok ? 'Importação concluída' : 'Importação concluída com diferenças', ok,
        linhas: [`Origem: versão ${pendente.origem.app_versao} → atual ${APP_VERSAO}`, ...linhas, ...pendente.avisos],
      });
    } catch (e) {
      setResultado({ titulo: 'Erro na importação', ok: false, linhas: [String((e as Error)?.message ?? e), 'Nenhum dado foi alterado.'] });
    } finally {
      setProcessando(false);
    }
  }

  return (
    <section className="card">
      <h3>Versão, backup e atualização</h3>
      <p className="small">
        Versão do app: <b>{APP_VERSAO}</b> · formato de dados {FORMATO_BACKUP} · último backup: {config.ultimo_backup ? formatarDataHora(config.ultimo_backup) : 'nunca'}
      </p>
      <div className="passos-atualizacao">
        <div><b>1.</b> Na versão atual: <b>Exportar estado completo</b>. Leva leads, histórico, reuniões, vendas, configurações e preferências.</div>
        <div><b>2.</b> Instale a versão nova (mesma pasta ou outra) e rode <code>npm install</code> e <code>npm run dev</code>.</div>
        <div><b>3.</b> Na versão nova: <b>Importar de versão anterior</b> e escolha <b>Substituir</b>. Os dados são convertidos para o formato novo automaticamente.</div>
        <div className="muted small">Mesmo navegador e mesma porta (localhost:5173)? A versão nova já encontra os dados e os atualiza sozinha. O arquivo serve de garantia e para trocar de computador ou navegador.</div>
      </div>
      <div className="linha-flex wrap">
        <button className="btn primary" onClick={async () => { await exportarTudo(); toast('Estado completo exportado'); }}>Exportar estado completo (JSON)</button>
        <label className="btn">
          Importar de versão anterior / backup…
          <input type="file" accept=".json,application/json" hidden onChange={(e) => { abrir(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      <div className="linha-flex wrap" style={{ marginTop: 8 }}>
        <button className="btn" onClick={async () => baixarArquivo(`leads-${hojeSP()}.csv`, csvLeads(await repo.listarLeads()))}>Exportar leads (CSV)</button>
        <button className="btn" onClick={async () => {
          const [a, l] = await Promise.all([repo.listarAtividades(), repo.listarLeads()]);
          baixarArquivo(`atividades-${hojeSP()}.csv`, csvAtividades(a, l));
        }}>Exportar atividades (CSV)</button>
      </div>

      {pendente && (
        <Modal titulo="Importar dados" onClose={() => !processando && setPendente(null)} largura={600}>
          <p className="small"><b>{pendente.nome}</b> · exportado em {formatarDataHora(pendente.origem.exportado_em)}</p>
          <p className="small">
            Versão de origem <b>{pendente.origem.app_versao}</b> (formato {pendente.origem.formato}) → versão atual <b>{APP_VERSAO}</b> (formato {FORMATO_BACKUP})
            {pendente.origem.formato < FORMATO_BACKUP && ' · o arquivo será convertido automaticamente'}
          </p>
          <table className="tabela compacta" style={{ marginBottom: 10 }}>
            <thead><tr><th></th><th>No arquivo</th><th>Neste navegador agora</th></tr></thead>
            <tbody>
              {(['leads', 'atividades', 'reunioes', 'vendas'] as const).map((k) => (
                <tr key={k}><td>{ROTULO[k]}</td><td>{pendente.backup.contagens![k]}</td><td>{pendente.atual[k]}</td></tr>
              ))}
            </tbody>
          </table>
          {pendente.avisos.map((a) => <div key={a} className="aviso alerta">{a}</div>)}
          <ul className="small">
            <li><b>Substituir</b> (recomendado ao atualizar de versão): os dados deste navegador passam a ser exatamente os do arquivo, inclusive configurações. {pendente.atual.leads > 0 && 'Um backup de segurança dos dados atuais é baixado antes.'}</li>
            <li><b>Mesclar</b>: adiciona só os leads do arquivo que ainda não existem aqui (por telefone ou site), com o histórico. Mantém as configurações atuais.</li>
          </ul>
          <div className="acoes">
            <button className="btn" disabled={processando} onClick={() => setPendente(null)}>Cancelar</button>
            <button className="btn" disabled={processando} onClick={() => restaurar('mesclar')}>Mesclar</button>
            <button className="btn primary" disabled={processando} onClick={() => restaurar('substituir')}>Substituir</button>
          </div>
        </Modal>
      )}
      {resultado && (
        <Modal titulo={resultado.titulo} onClose={() => setResultado(null)} largura={520}>
          {resultado.linhas.map((l) => <div key={l} className="small" style={{ marginBottom: 4 }}>{l}</div>)}
          <div className="acoes"><button className="btn primary" onClick={() => setResultado(null)}>OK</button></div>
        </Modal>
      )}
    </section>
  );
}

type Contagem = Awaited<ReturnType<typeof repo.contagemAtual>>;
const ROTULO = { leads: 'Leads', atividades: 'Atividades', reunioes: 'Reuniões', vendas: 'Vendas' } as const;

function Dados() {
  const { toast } = useApp();
  const [apagar, setApagar] = useState(false);
  const [txt, setTxt] = useState('');
  return (
    <section className="card">
      <h3>Dados</h3>
      <div className="linha-flex wrap">
        <button className="btn" onClick={async () => {
          const r = await repo.gravarExemplo(gerarDadosExemplo());
          toast(r.ignorados ? `${r.importados} leads de exemplo carregados (${r.ignorados} já existiam)` : `${r.importados} leads de exemplo carregados`);
        }}>Carregar dados de exemplo</button>
        <button className="btn danger" onClick={() => {
          if (confirm('Apagar TODOS os dados (leads, atividades, reuniões, vendas e configurações)?')) { setApagar(true); setTxt(''); }
        }}>Apagar todos os dados</button>
      </div>
      {apagar && (
        <Modal titulo="Confirmação final" onClose={() => setApagar(false)} largura={420}>
          <p>Digite <b>APAGAR</b> para confirmar. Sem backup, os dados não podem ser recuperados.</p>
          <form onSubmit={async (e) => {
            e.preventDefault();
            if (txt !== 'APAGAR') return;
            await repo.apagarTudo();
            setApagar(false);
            toast('Todos os dados foram apagados');
          }}>
            <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} />
            <div className="acoes">
              <button type="button" className="btn" onClick={() => setApagar(false)}>Cancelar</button>
              <button className="btn danger" disabled={txt !== 'APAGAR'}>Apagar tudo</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
