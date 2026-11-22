import { useState } from 'react';
import * as repo from '../db/repo';
import { numeroBR } from '../domain/csv';
import type { Lead } from '../domain/types';
import { useApp } from './AppContext';
import { Modal } from './ui';

export function NovoLead({ onClose }: { onClose: () => void }) {
  const { abrirLead, toast } = useApp();
  const [f, setF] = useState({ nome_empresa: '', telefone: '', site: '', segmento: '', cidade: '', capital_social: '', decisor_nome: '' });
  const [erro, setErro] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nome_empresa.trim() || !f.telefone.trim() || !f.site.trim()) { setErro('Empresa, telefone e site são obrigatórios.'); return; }
    const dup = await repo.buscarDuplicado(f.telefone, f.site);
    if (dup && !confirm(`Possível duplicado: “${dup.nome_empresa}” tem o mesmo telefone ou site. Criar mesmo assim?`)) return;
    const dados: Partial<Lead> = { ...f, capital_social: numeroBR(f.capital_social), origem: 'manual' };
    const id = await repo.criarLead(dados);
    toast('Lead criado');
    onClose();
    abrirLead(id);
  }

  return (
    <Modal titulo="Novo lead" onClose={onClose}>
      <form onSubmit={salvar} className="form-grid">
        <label className="campo">Empresa *<input autoFocus value={f.nome_empresa} onChange={set('nome_empresa')} /></label>
        <label className="campo">Telefone *<input value={f.telefone} onChange={set('telefone')} placeholder="(11) 98765-4321" inputMode="tel" /></label>
        <label className="campo">Site *<input value={f.site} onChange={set('site')} placeholder="empresa.com.br" /></label>
        <label className="campo">Capital social (R$)<input value={f.capital_social} onChange={set('capital_social')} inputMode="decimal" /></label>
        <label className="campo">Segmento<input value={f.segmento} onChange={set('segmento')} /></label>
        <label className="campo">Cidade<input value={f.cidade} onChange={set('cidade')} /></label>
        <label className="campo">Decisor<input value={f.decisor_nome} onChange={set('decisor_nome')} /></label>
        {erro && <div className="aviso erro full">{erro}</div>}
        <div className="acoes full">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary">Criar e abrir ficha</button>
        </div>
      </form>
    </Modal>
  );
}
