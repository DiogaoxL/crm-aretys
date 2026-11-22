import Dexie, { type Table } from 'dexie';
import type { Atividade, Config, Lead, Reuniao, Venda } from '../domain/types';

/**
 * Banco local (IndexedDB) via Dexie.
 * Para migrar o schema no futuro, adicione um novo `this.version(N).stores({...}).upgrade(tx => ...)`
 * mantendo as versões anteriores declaradas.
 */
export class CrmDB extends Dexie {
  leads!: Table<Lead, number>;
  atividades!: Table<Atividade, number>;
  reunioes!: Table<Reuniao, number>;
  vendas!: Table<Venda, number>;
  configuracoes!: Table<Config, string>;

  constructor() {
    super('crm-prospeccao');
    this.version(1).stores({
      leads: '++id, nome_empresa, telefone, dominio, etapa_pipeline, temperatura, fit, score, proxima_acao_data, cidade, segmento, criado_em',
      atividades: '++id, lead_id, data_hora, tipo, resultado',
      reunioes: '++id, lead_id, data_hora, status, criado_em',
      vendas: '++id, lead_id, data',
      configuracoes: 'chave',
    });
  }
}

export const db = new CrmDB();
