import { useState } from 'react';
import * as repo from '../db/repo';
import { baixarArquivo, CAMPOS_IMPORTACAO, csvModelo, lerCsv, linhaParaLead, sugerirMapeamento } from '../domain/csv';
import { useApp } from '../components/AppContext';
import { NovoLead } from '../components/NovoLead';
import { BarraProgresso } from '../components/ui';

interface Arquivo { nome: string; cabecalhos: string[]; linhas: Record<string, string>[] }

export function Importar() {
  const { toast } = useApp();
  const [arq, setArq] = useState<Arquivo | null>(null);
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [rel, setRel] = useState<repo.RelatorioImportacao | null>(null);
  const [novo, setNovo] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  async function abrir(file: File | undefined) {
    if (!file) return;
    try {
      const r = await lerCsv(file);
      if (!r.cabecalhos.length) { toast('Arquivo sem cabeçalho'); return; }
      setArq({ nome: file.name, ...r });
      setMapa(sugerirMapeamento(r.cabecalhos));
      setRel(null);
    } catch {
      toast('Não foi possível ler o arquivo CSV');
    }
  }

  const obrigatoriosOk = CAMPOS_IMPORTACAO.filter((c) => c.obrigatorio).every((c) => mapa[c.campo]);

  async function confirmar() {
    if (!arq || !obrigatoriosOk) return;
    setCarregando(true);
    try {
      const linhas = arq.linhas.map((l) => linhaParaLead(l, mapa));
      const r = await repo.importarLeads(linhas, 'csv');
      setRel(r);
      setArq(null);
      toast(`${r.importados} leads importados`);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="pagina">
      <div className="pagina-head">
        <h1>Importar leads</h1>
        <div className="linha-flex">
          <button className="btn" onClick={() => baixarArquivo('modelo-leads.csv', csvModelo())}>Baixar CSV modelo</button>
          <button className="btn" onClick={() => setNovo(true)}>+ Criar lead manualmente</button>
        </div>
      </div>

      {carregando && (
        <BarraProgresso rotulo="Importando leads…"
          detalhe="Conferindo duplicados (telefone, site e CNPJ) e gravando os leads no CRM." />
      )}

      {!arq && (
        <label
          className={`dropzone ${arrastando ? 'on' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); abrir(e.dataTransfer.files[0]); }}
        >
          <input type="file" accept=".csv,text/csv" onChange={(e) => { abrir(e.target.files?.[0]); e.target.value = ''; }} hidden />
          <b>Arraste um arquivo CSV aqui ou clique para escolher</b>
          <span className="muted small">Obrigatórios: nome da empresa, telefone e site. Separador vírgula ou ponto e vírgula. As demais colunas são reconhecidas pelo nome do cabeçalho.</span>
        </label>
      )}

      {rel && (
        <section className="card">
          <h3>Relatório da importação</h3>
          <div className="kpis-mini">
            <div><b>{rel.importados}</b><span>importados</span></div>
            <div><b>{rel.ignorados.length}</b><span>ignorados</span></div>
            <div><b>{rel.duplicados.length}</b><span>duplicados</span></div>
          </div>
          {rel.ignorados.length > 0 && (
            <details open={rel.ignorados.length <= 10}><summary>Linhas ignoradas (faltam campos obrigatórios)</summary>
              <ul className="small">{rel.ignorados.map((x) => <li key={x.linha}>Linha {x.linha}: {x.motivo}</li>)}</ul>
            </details>
          )}
          {rel.duplicados.length > 0 && (
            <details open={rel.duplicados.length <= 10}><summary>Duplicados (não importados)</summary>
              <ul className="small">{rel.duplicados.map((x) => <li key={x.linha}>Linha {x.linha}: {x.empresa}: {x.motivo}</li>)}</ul>
            </details>
          )}
          <p><a href="#/leads">Ver leads →</a></p>
        </section>
      )}

      {arq && (
        <>
          <section className="card">
            <div className="card-head">
              <h3>Mapeamento de colunas: {arq.nome} <span className="muted">({arq.linhas.length} linhas)</span></h3>
              <button className="btn-link" onClick={() => setArq(null)}>Trocar arquivo</button>
            </div>
            <div className="mapa-grid">
              {CAMPOS_IMPORTACAO.map((c) => (
                <label key={c.campo} className={`campo ${c.obrigatorio && !mapa[c.campo] ? 'falta' : ''}`}>
                  {c.label}{c.obrigatorio && ' *'}
                  <select value={mapa[c.campo] ?? ''} onChange={(e) => setMapa({ ...mapa, [c.campo]: e.target.value })}>
                    <option value="">(não importar)</option>
                    {arq.cabecalhos.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="card">
            <h3>Pré-visualização (5 primeiras linhas)</h3>
            <div className="tabela-wrap">
              <table className="tabela compacta">
                <thead>
                  <tr>{CAMPOS_IMPORTACAO.filter((c) => mapa[c.campo]).map((c) => <th key={c.campo}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {arq.linhas.slice(0, 5).map((l, i) => (
                    <tr key={i}>
                      {CAMPOS_IMPORTACAO.filter((c) => mapa[c.campo]).map((c) => (
                        <td key={c.campo} className={c.obrigatorio && !String(l[mapa[c.campo]] ?? '').trim() ? 'celula-erro' : ''}>
                          {l[mapa[c.campo]]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="acoes">
            {!obrigatoriosOk && <span className="vencida small">Mapeie os três campos obrigatórios.</span>}
            <button className="btn primary" disabled={!obrigatoriosOk || carregando} onClick={confirmar}>
              Importar {arq.linhas.length} linhas
            </button>
          </div>
        </>
      )}
      {novo && <NovoLead onClose={() => setNovo(false)} />}
    </div>
  );
}
