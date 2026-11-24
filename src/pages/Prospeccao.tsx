import { useEffect, useState } from 'react';
import * as repo from '../db/repo';
import * as api from '../db/prospeccaoApi';
import { baixarArquivo, gerarCsv } from '../domain/csv';
import { linhaParaLeadCrm, PORTES, STATUS_GOOGLE_LABEL, UFS, type LinhaLista } from '../domain/prospeccao';
import { useApp } from '../components/AppContext';
import { BarraProgresso, Vazio } from '../components/ui';

const FORM_PADRAO = {
  slug: '', area: '', uf: 'PR', municipios: '', limite: 100, portes: [] as string[], idadeMinAnos: 0,
  incluirSecundarios: false, incluirFiliais: false, excluirSimples: false, exigirDecisor: false,
  esconderContabilidade: false, filtroNome: 'auto' as 'auto' | 'sim' | 'nao',
};
/** Texto de apoio exibido sob a barra de cada operação. */
const DETALHE_OPERACAO: Record<string, string> = {
  'Gerando lista…': 'Buscando na base da Receita as empresas do segmento e da região, e calculando o score. Com o Brasil inteiro carregado, pode levar alguns segundos.',
  'Verificando no Google…': 'Conferindo cada empresa no Google. Resultados já consultados vêm do cache e não gastam cota.',
  'Enviando para o CRM…': 'Criando os leads no CRM e registrando no histórico para não repetirem nas próximas listas.',
};

const CHAVE_FORM = 'crm-prospeccao-form'; // preferência local (vai junto no backup, como as outras "crm-*")

/** Texto para busca: minúsculas, sem acento. */
const chaveBusca = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** " · ~12 min restantes", estimado pelo ritmo desde o início da fase (só depois de 2%). */
function tempoRestante(inicio: string | undefined, pct: number): string {
  if (!inicio || pct < 2 || pct >= 100) return '';
  const passado = Date.now() - new Date(inicio).getTime();
  const min = Math.round((passado * (100 - pct)) / pct / 60000);
  return min < 1 ? ' · menos de 1 min' : min < 90 ? ` · ~${min} min restantes` : ` · ~${(min / 60).toFixed(1)} h restantes`;
}

function formSalvo(): typeof FORM_PADRAO {
  try { return { ...FORM_PADRAO, ...JSON.parse(localStorage.getItem(CHAVE_FORM) ?? '{}') }; } catch { return FORM_PADRAO; }
}

export function Prospeccao() {
  const { toast } = useApp();
  const [status, setStatus] = useState<api.StatusBase | null>(null);
  const [erroServidor, setErroServidor] = useState('');
  const [segmentos, setSegmentos] = useState<api.Segmento[]>([]);
  const [f, setF] = useState(formSalvo);
  const [lista, setLista] = useState<api.ListaGerada | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState('');
  // Andamento real, quando a operação informa (verificação no Google: empresa i de total).
  const [andamento, setAndamento] = useState<{ atual: number; total: number } | null>(null);
  const [detalhes, setDetalhes] = useState(false);
  const [colunasGoogle, setColunasGoogle] = useState<string[]>([]);
  const [rel, setRel] = useState<repo.RelatorioImportacao & { empresas: string[] } | null>(null);
  // Catálogo vindo da base: áreas (seções da CNAE + nichos) → segmentos, com busca por texto.
  const [busca, setBusca] = useState('');
  const areas = [...segmentos.reduce((m, s) => {
    const a = m.get(s.area) ?? { segmentos: 0, empresas: 0 };
    return m.set(s.area, { segmentos: a.segmentos + 1, empresas: a.empresas + (s.empresas ?? 0) });
  }, new Map<string, { segmentos: number; empresas: number }>())];
  const termo = chaveBusca(busca);
  const visiveis = segmentos.filter((s) => (termo
    ? chaveBusca(`${s.nome} ${s.codigo ?? ''} ${s.grupo ?? ''}`).includes(termo)
    : s.area === f.area));
  // Agrupa as opções visíveis (por nicho, por área quando há busca, ou uma lista só).
  const grupos = [...visiveis.reduce((m, s) => {
    const g = s.tipo === 'nicho' ? s.grupo ?? '' : termo ? s.area : '';
    return m.set(g, [...(m.get(g) ?? []), s]);
  }, new Map<string, api.Segmento[]>())];
  const escolhido = segmentos.find((s) => s.slug === f.slug);

  async function atualizarStatus() {
    try {
      const [s, segs] = await Promise.all([api.status(), api.segmentos()]);
      setStatus(s); setSegmentos(segs); setErroServidor('');
      // Última escolha salva que não existe mais no catálogo (slug renomeado ou CNAE sem empresas): volta para o primeiro.
      setF((x) => {
        const atual = segs.find((g) => g.slug === x.slug) ?? segs[0];
        return atual ? { ...x, slug: atual.slug, area: atual.area } : x;
      });
    } catch (e) {
      setErroServidor((e as Error).message);
    }
  }
  useEffect(() => { atualizarStatus(); }, []);
  useEffect(() => { try { localStorage.setItem(CHAVE_FORM, JSON.stringify(f)); } catch { /* ignore */ } }, [f]);

  // Atualização automática da base: acompanha o progresso a cada 2 s enquanto roda no servidor local.
  const [progresso, setProgresso] = useState<api.Atualizacao | null>(null);
  const rodando = !!(progresso ?? status?.atualizacao)?.rodando;
  useEffect(() => { if (status?.atualizacao) setProgresso(status.atualizacao); }, [status]);
  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(async () => {
      try {
        const p = await api.progressoAtualizacao();
        setProgresso(p);
        if (p && !p.rodando) {
          toast(p.fase === 'erro' ? `Falha na atualização: ${p.mensagem}` : p.mensagem);
          atualizarStatus();
        }
      } catch { /* servidor reiniciando: tenta de novo */ }
    }, 2000);
    return () => clearInterval(t);
  }, [rodando]); // eslint-disable-line react-hooks/exhaustive-deps

  async function baixarBase(forcar = false) {
    try { setProgresso(await api.atualizarBase(forcar)); } catch (e) { toast((e as Error).message); }
  }

  const pct = Math.max(0, Math.min(100, progresso?.percentual ?? 0));
  const painelAtualizacao = progresso && (progresso.rodando || progresso.fase === 'erro') && (
    <div className={`aviso ${progresso.fase === 'erro' ? 'erro' : 'info'}`} style={{ marginTop: 10 }}>
      {progresso.rodando && progresso.etapa ? (
        <div className="linha-flex" style={{ justifyContent: 'space-between' }}>
          <b>Etapa {progresso.etapa} de 2 · {progresso.etapa === 1 ? 'Download dos arquivos da Receita' : 'Carga no banco local'}</b>
          <span><b>{pct.toFixed(pct < 10 ? 1 : 0)}%</b>{tempoRestante(progresso.inicioFase, pct)}</span>
        </div>
      ) : null}
      <div>{progresso.competencia && <b>{progresso.competencia} · </b>}{progresso.mensagem}</div>
      {progresso.rodando && progresso.etapa ? (
        <div className="barra" style={{ marginTop: 6, height: 12 }}>
          <div style={{ width: `${pct}%`, transition: 'width .6s' }} />
        </div>
      ) : null}
      {progresso.rodando && (
        <div className="small muted" style={{ marginTop: 4 }}>
          Pode continuar usando o CRM. Não feche o terminal do <code>npm run dev</code> até terminar.
          {progresso.fase === 'baixando' && ' Se cair, clique de novo: o download continua de onde parou.'}
        </div>
      )}
    </div>
  );

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function gerar() {
    setOcupado('Gerando lista…'); setRel(null); setColunasGoogle([]);
    try {
      const r = await api.gerarLista(f.slug, {
        uf: f.uf,
        municipios: f.municipios.split(/[,;\n]/).map((m) => m.trim()).filter(Boolean),
        limite: f.limite, portes: f.portes, idadeMinAnos: f.idadeMinAnos,
        incluirSecundarios: f.incluirSecundarios, soMatriz: !f.incluirFiliais, excluirSimples: f.excluirSimples,
        exigirDecisor: f.exigirDecisor, esconderContabilidade: f.esconderContabilidade, filtroNome: f.filtroNome,
      });
      setLista(r);
      setSel(new Set(r.linhas.map((l) => l.cnpj)));
      toast(`${r.linhas.length} empresas na lista`);
    } catch (e) {
      toast((e as Error).message);
    } finally { setOcupado(''); }
  }

  async function verificar(provedor: 'google' | 'serper') {
    if (!lista) return;
    const alvo = lista.linhas.filter((l) => sel.has(l.cnpj));
    setOcupado('Verificando no Google…');
    setAndamento({ atual: 0, total: alvo.length });
    try {
      const r = await api.verificarNoGoogle(alvo, { provedor, detalhes },
        (i, total) => setAndamento({ atual: i, total }));
      const porCnpj = new Map(r.linhas.map((l) => [l.cnpj, l]));
      setLista({ ...lista, linhas: lista.linhas.map((l) => porCnpj.get(l.cnpj) ?? l) });
      setColunasGoogle(r.colunas);
      // Fechados no Google saem da seleção (a empresa encerrou, mesmo ativa na Receita).
      setSel(new Set([...sel].filter((c) => porCnpj.get(c)?.google_status !== 'fechado')));
      if (r.erroCota) toast(`Parou: ${r.erroCota}`);
      else toast('Verificação concluída');
      atualizarStatus();
    } catch (e) {
      toast((e as Error).message);
    } finally { setOcupado(''); setAndamento(null); }
  }

  async function enviarParaCrm() {
    if (!lista) return;
    const alvo = lista.linhas.filter((l) => sel.has(l.cnpj));
    setOcupado('Enviando para o CRM…');
    try {
      const r = await repo.importarLeads(
        alvo.map((l) => linhaParaLeadCrm(l, lista.segmento, lista.nome)), `receita:${lista.nome}`, { exigirSite: false });
      // Histórico: quem entrou (ou já estava) no CRM não volta nas próximas listas.
      const ignoradas = new Set(r.ignorados.map((x) => x.linha - 2));
      await api.registrar(lista.nome, alvo.filter((_, i) => !ignoradas.has(i)).map((l) => l.cnpj));
      setRel({ ...r, empresas: alvo.map((l) => l.nome_fantasia || l.razao_social) });
      setLista(null);
      toast(`${r.importados} leads enviados para o CRM`);
    } catch (e) {
      toast((e as Error).message);
    } finally { setOcupado(''); }
  }

  async function liberar() {
    await api.liberarBanco();
    toast('Banco liberado. Rode a carga mensal; ele reabre sozinho no próximo uso.');
    setStatus((s) => (s ? { ...s, aberto: false } : s));
  }

  const baixarCsv = () => lista && baixarArquivo(`${lista.nome}.csv`, gerarCsv(lista.linhas, [...lista.colunas, ...colunasGoogle]));
  const toggle = (cnpj: string) => setSel((s) => { const n = new Set(s); n.has(cnpj) ? n.delete(cnpj) : n.add(cnpj); return n; });

  if (erroServidor) {
    return (
      <div className="pagina">
        <div className="pagina-head"><h1>Gerar lista</h1></div>
        <div className="aviso erro">{erroServidor}</div>
        <p className="muted small">A lista é gerada pelo Node desta máquina, a partir da base da Receita em <code>dados/receita.duckdb</code>.</p>
        <button className="btn" onClick={atualizarStatus}>Tentar de novo</button>
      </div>
    );
  }

  return (
    <div className="pagina">
      <div className="pagina-head">
        <h1>Gerar lista</h1>
      </div>
      {ocupado && (
        <BarraProgresso key={ocupado} rotulo={ocupado} atual={andamento?.atual} total={andamento?.total}
          detalhe={DETALHE_OPERACAO[ocupado]} />
      )}

      {status && !status.carregado && (
        <section className="card">
          <h3>{rodando ? 'Atualizando a base da Receita' : status.incompleta ? 'A última carga da base não terminou' : 'Base da Receita ainda não carregada'}</h3>
          {!rodando && status.incompleta && (
            <div className="aviso alerta">A carga foi interrompida no meio (queda ou reinício do servidor) e a base está incompleta.
              Clique em <b>Baixar e carregar a base</b> para refazer: os arquivos já baixados são reaproveitados.</div>
          )}
          {!rodando && (
            <>
              <p className="small">O CRM baixa sozinho o mês mais recente da base pública de CNPJ da Receita (cerca de 7,8 GB),
                descompacta, carrega {status.ufsCarregadas && status.ufsCarregadas !== 'todas' ? status.ufsCarregadas : 'todas as UFs e municípios'} e apaga os ZIPs.
                Tudo fica dentro do projeto, em <code>dados/</code>. Repita uma vez por mês.</p>
              <div className="linha-flex">
                <button className="btn primary" onClick={() => baixarBase()}>Baixar e carregar a base</button>
                <button className="btn" onClick={atualizarStatus}>Atualizar</button>
              </div>
            </>
          )}
          {painelAtualizacao}
          {!rodando && (
            <details style={{ marginTop: 10 }}>
              <summary className="small">Prefere baixar à mão?</summary>
              <p className="small">Baixe em <a href="https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9" target="_blank" rel="noreferrer">arquivos.receitafederal.gov.br</a> (pasta do mês mais recente)
                os ZIPs Empresas, Estabelecimentos, Socios, Simples, Cnaes e Municipios, coloque numa pasta e rode:</p>
              <pre className="small">npm run receita:carregar -- --zips D:\caminho\da\pasta</pre>
              <p className="muted small">Com o app aberto, use “Liberar banco” antes. O banco fica em {status.arquivo}.</p>
              {status.aberto && <button className="btn" onClick={liberar}>Liberar banco</button>}
            </details>
          )}
        </section>
      )}

      {status?.carregado && (
        <section className="card">
          <h3>Filtros</h3>
          <div className="form-grid">
            <label className="campo">Área ({segmentos.length.toLocaleString('pt-BR')} segmentos na base)
              <select value={f.area} disabled={!!termo} onChange={(e) => {
                const primeiro = segmentos.find((s) => s.area === e.target.value);
                setF((x) => ({ ...x, area: e.target.value, slug: primeiro?.slug ?? x.slug }));
              }}>
                {areas.map(([area, a]) => (
                  <option key={area} value={area}>
                    {area} · {a.segmentos} {a.empresas ? `· ${a.empresas.toLocaleString('pt-BR')} empresas` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">Buscar segmento (nome ou código CNAE, em todas as áreas)
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex.: fisioterapia, padaria, 8630503" />
            </label>
            <label className="campo">Segmento {termo && `(${visiveis.length} encontrados)`}
              <select value={visiveis.some((s) => s.slug === f.slug) ? f.slug : ''} onChange={(e) => {
                const s = segmentos.find((x) => x.slug === e.target.value);
                if (s) setF((x) => ({ ...x, slug: s.slug, area: s.area }));
              }}>
                {!visiveis.some((s) => s.slug === f.slug) && <option value="" disabled>{visiveis.length ? 'Escolha…' : 'Nada encontrado'}</option>}
                {grupos.map(([grupo, itens]) => {
                  const opcoes = itens.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {s.nome}{s.codigo ? ` (${s.codigo})` : ''}{s.empresas != null ? ` · ${s.empresas.toLocaleString('pt-BR')}` : ''}
                    </option>
                  ));
                  return grupo ? <optgroup key={grupo} label={grupo}>{opcoes}</optgroup> : opcoes;
                })}
              </select>
            </label>
            <label className="campo">UF
              <select value={f.uf} onChange={(e) => set('uf', e.target.value)}>
                {UFS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
            <label className="campo">Municípios (separados por vírgula; vazio = UF inteira)
              <input value={f.municipios} onChange={(e) => set('municipios', e.target.value)} placeholder="Curitiba, São José dos Pinhais" />
            </label>
            <label className="campo">Quantidade
              <input type="number" min={1} max={1000} value={f.limite} onChange={(e) => set('limite', Number(e.target.value) || 100)} />
            </label>
            <label className="campo">Idade mínima da empresa (anos)
              <input type="number" min={0} value={f.idadeMinAnos} onChange={(e) => set('idadeMinAnos', Number(e.target.value) || 0)} />
            </label>
            {escolhido?.tipo === 'nicho' && (
              <label className="campo">Filtro pelo nome (radicais do nicho)
                <select value={f.filtroNome} onChange={(e) => set('filtroNome', e.target.value as typeof f.filtroNome)}>
                  <option value="auto">Automático (só se o CNAE for genérico)</option>
                  <option value="sim">Sempre</option>
                  <option value="nao">Nunca</option>
                </select>
              </label>
            )}
          </div>
          <div className="checks" style={{ marginTop: 10 }}>
            <span className="linha-flex">Porte:
              {PORTES.map(([id, label]) => (
                <label key={id} className="check">
                  <input type="checkbox" checked={f.portes.includes(id)}
                    onChange={(e) => set('portes', e.target.checked ? [...f.portes, id] : f.portes.filter((p) => p !== id))} /> {label}
                </label>
              ))}
            </span>
            <label className="check"><input type="checkbox" checked={f.esconderContabilidade} onChange={(e) => set('esconderContabilidade', e.target.checked)} /> Esconder quem só tem telefone de contabilidade</label>
            <label className="check"><input type="checkbox" checked={f.exigirDecisor} onChange={(e) => set('exigirDecisor', e.target.checked)} /> Só com decisor no quadro de sócios</label>
            <label className="check"><input type="checkbox" checked={f.excluirSimples} onChange={(e) => set('excluirSimples', e.target.checked)} /> Excluir optantes do Simples</label>
            <label className="check"><input type="checkbox" checked={f.incluirSecundarios} onChange={(e) => set('incluirSecundarios', e.target.checked)} /> Incluir CNAE secundário</label>
            <label className="check"><input type="checkbox" checked={f.incluirFiliais} onChange={(e) => set('incluirFiliais', e.target.checked)} /> Incluir filiais</label>
          </div>
          <div className="acoes">
            <span className="muted small">Empresas que entraram no CRM nos últimos 90 dias não voltam na lista.</span>
            <button className="btn primary" disabled={!escolhido || !!ocupado} onClick={gerar}>Gerar lista</button>
          </div>
        </section>
      )}

      {rel && (
        <section className="card">
          <h3>Enviado para o CRM</h3>
          <div className="kpis-mini">
            <div><b>{rel.importados}</b><span>novos leads no CRM</span></div>
            <div><b>{rel.ignorados.length}</b><span>ignorados</span></div>
            <div><b>{rel.duplicados.length}</b><span>já estavam no CRM</span></div>
          </div>
          {rel.ignorados.length > 0 && (
            <details><summary>Ignorados</summary>
              <ul className="small">{rel.ignorados.map((x) => <li key={x.linha}>{rel.empresas[x.linha - 2]}: {x.motivo}</li>)}</ul>
            </details>
          )}
          {rel.duplicados.length > 0 && (
            <details><summary>Já estavam no CRM</summary>
              <ul className="small">{rel.duplicados.map((x) => <li key={x.linha}>{x.empresa}: {x.motivo}</li>)}</ul>
            </details>
          )}
          <p><a href="#/fila">Ir para a fila do dia →</a></p>
        </section>
      )}

      {lista && (
        <section className="card">
          <div className="card-head">
            <h3>{lista.segmento} · {f.uf}</h3>
            <span className="muted small">CNAEs {lista.cnaes.join(', ')}{lista.stems.length > 0 && ` · nome contém ${lista.stems.join('/')}`}</span>
          </div>
          <div className="kpis-mini">
            <div><b>{lista.encontrados}</b><span>encontradas</span></div>
            <div><b>{lista.linhas.length}</b><span>na lista</span></div>
            <div><b>{sel.size}</b><span>selecionadas</span></div>
          </div>
          {lista.linhas.length === 0 ? <Vazio>Nenhuma empresa com esses filtros.</Vazio> : (
            <>
              <div className="barra-massa" style={{ marginTop: 10 }}>
                <label className="check">
                  <input type="checkbox" checked={sel.size === lista.linhas.length}
                    onChange={(e) => setSel(new Set(e.target.checked ? lista.linhas.map((l) => l.cnpj) : []))} /> Todas
                </label>
                {(status?.google || status?.serper) && (
                  <>
                    <label className="check"><input type="checkbox" checked={detalhes} onChange={(e) => setDetalhes(e.target.checked)} /> Telefone, site e nota (cota menor)</label>
                    {status.google && <button className="btn" disabled={!sel.size || !!ocupado} onClick={() => verificar('google')}>Verificar no Google</button>}
                    {status.serper && <button className="btn" disabled={!sel.size || !!ocupado} onClick={() => verificar('serper')}>Verificar (Serper)</button>}
                  </>
                )}
                <button className="btn" onClick={baixarCsv}>Baixar CSV</button>
                <button className="btn primary" disabled={!sel.size || !!ocupado} onClick={enviarParaCrm} title="Cria os leads direto no CRM, sem precisar exportar e importar arquivo">Enviar {sel.size} para o CRM</button>
              </div>
              <div className="tabela-wrap">
                <table className="tabela compacta">
                  <thead>
                    <tr>
                      <th></th><th>#</th><th>Score</th><th>Empresa</th><th>Decisor</th><th>Telefone</th><th>E-mail</th>
                      <th>Cidade</th><th>Abertura</th>{colunasGoogle.length > 0 && <th>Google</th>}<th>Por que entrou</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.linhas.map((l: LinhaLista) => (
                      <tr key={l.cnpj} onClick={() => toggle(l.cnpj)} style={{ cursor: 'pointer' }}>
                        <td><input type="checkbox" checked={sel.has(l.cnpj)} onChange={() => toggle(l.cnpj)} onClick={(e) => e.stopPropagation()} /></td>
                        <td>{l.posicao}</td>
                        <td><b>{l.score}</b></td>
                        <td>{l.nome_fantasia || l.razao_social}{l.nome_fantasia && <div className="muted small">{l.razao_social}</div>}</td>
                        <td>{l.decisor || <span className="muted">—</span>}</td>
                        <td>{l.telefone_principal}
                          <div className="muted small">{l.tipo_telefone}{l.telefone_contabilidade === 'sim' && ' · contabilidade'}</div>
                        </td>
                        <td>{l.email ? <span className="tag">{l.email_tipo}</span> : <span className="muted">—</span>}</td>
                        <td>{l.municipio}</td>
                        <td>{l.data_inicio_atividade?.slice(0, 4)}</td>
                        {colunasGoogle.length > 0 && (
                          <td>{l.google_status ? (l.google_maps
                            ? <a href={l.google_maps} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{STATUS_GOOGLE_LABEL[l.google_status] ?? l.google_status}</a>
                            : STATUS_GOOGLE_LABEL[l.google_status] ?? l.google_status) : ''}</td>
                        )}
                        <td className="small">{l.motivos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {status?.existe && (
        <section className="card">
          <div className="card-head">
            <h3>Base local</h3>
            <div className="linha-flex">
              <button className="btn-link" onClick={atualizarStatus}>Atualizar</button>
              {status.aberto && <button className="btn" onClick={liberar}>Liberar banco para a carga mensal</button>}
            </div>
          </div>
          <p className="small">
            {status.competencia ? <>Receita de <b>{status.competencia}</b> · </> : null}
            {status.ufsCarregadas === 'todas' ? 'todas as UFs' : status.ufsCarregadas ?? ''}{status.ufsCarregadas ? ' · ' : ''}
            {status.estabelecimentos.toLocaleString('pt-BR')} estabelecimentos ativos · {status.arquivo}
          </p>
          {status.carregado && (
            <div className="linha-flex">
              <button className="btn" disabled={rodando} onClick={() => baixarBase()}>Verificar mês novo e atualizar</button>
              <span className="muted small">A Receita publica um mês novo por mês. O histórico e o cache do Google são mantidos.</span>
            </div>
          )}
          {status.carregado && painelAtualizacao}
          {status.uso && (
            <p className="small muted">Uso do Google em {status.mes}: {Object.entries(status.uso)
              .map(([sku, u]) => `${sku} ${u.usado}/${u.limite}`).join(' · ')}</p>
          )}
          {!status.google && !status.serper && (
            <p className="small muted">Verificação no Google desligada: crie o arquivo <code>.env</code> na pasta do CRM com
              <code> GOOGLE_PLACES_API_KEY=sua-chave</code> e reinicie o <code>npm run dev</code>.</p>
          )}
        </section>
      )}
    </div>
  );
}
