// Hooks reativos: re-renderizam quando os dados mudam. Usam apenas funções do repositório.
import { useLiveQuery } from 'dexie-react-hooks';
import * as repo from './repo';
import { CONFIG_PADRAO } from '../domain/constants';
import type { Config } from '../domain/types';

export function useConfig(): Config {
  return useLiveQuery(() => repo.getConfig(), [], CONFIG_PADRAO);
}
export function useLeads() {
  return useLiveQuery(() => repo.listarLeads(), []);
}
export function useLead(id: number | null) {
  return useLiveQuery(() => (id == null ? undefined : repo.getLead(id)), [id]);
}
export function useAtividadesDoLead(id: number) {
  return useLiveQuery(() => repo.atividadesDoLead(id), [id], []);
}
export function useReunioesDoLead(id: number) {
  return useLiveQuery(() => repo.reunioesDoLead(id), [id], []);
}
export function useVendasDoLead(id: number) {
  return useLiveQuery(() => repo.vendasDoLead(id), [id], []);
}
export function useTudo() {
  return useLiveQuery(async () => {
    const [leads, atividades, reunioes, vendas] = await Promise.all([
      repo.listarLeads(), repo.listarAtividades(), repo.listarReunioes(), repo.listarVendas(),
    ]);
    return { leads, atividades, reunioes, vendas };
  }, []);
}
