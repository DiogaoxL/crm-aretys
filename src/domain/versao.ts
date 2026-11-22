/** Versão do app (vem do package.json). Aumente a cada melhoria entregue. */
export const APP_VERSAO: string = __APP_VERSION__;

/**
 * Formato do arquivo de backup. Aumente SOMENTE quando a estrutura do JSON mudar
 * de um jeito que precise de conversão, e adicione o passo correspondente em src/db/migracoes.ts.
 * Campos novos com valor padrão não exigem novo formato: a normalização preenche sozinha.
 */
export const FORMATO_BACKUP = 2;

/** Compara versões "x.y.z". Retorna <0, 0 ou >0. */
export function compararVersao(a: string | undefined, b: string | undefined): number {
  const pa = (a ?? '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = (b ?? '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
