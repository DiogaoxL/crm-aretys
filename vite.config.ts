import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { prospeccaoPlugin } from './src/server/prospeccao/vite-plugin';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => {
  // Lê o .env local (sem prefixo VITE_): as chaves ficam só no Node, nunca vão para o navegador.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      // Criação de lista (base da Receita em DuckDB local): API em /api/prospeccao/* neste mesmo servidor.
      prospeccaoPlugin({
        arquivoDb: path.resolve(env.RECEITA_DB || 'dados/receita.duckdb'),
        // Download automático: tudo dentro do projeto (dados/cnpj para os ZIPs, dados/tmp para a extração).
        pastaDados: path.resolve('dados'),
        ufs: (env.RECEITA_UFS || '').split(',').filter(Boolean), // vazio = Brasil inteiro
        tokenReceita: env.RECEITA_SHARE_TOKEN || undefined,
        googleKey: env.GOOGLE_PLACES_API_KEY || undefined,
        serperKey: env.SERPER_API_KEY || undefined,
      }),
    ],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    // Porta fixa: os dados do IndexedDB ficam ligados ao endereço (localhost:5173).
    // Mantendo a mesma porta, uma versão nova do app enxerga os dados da anterior no mesmo navegador.
    // O arquivo DuckDB muda a todo momento: fora do watcher para não disparar recargas.
    server: { port: 5173, strictPort: true, watch: { ignored: ['**/dados/**'] } },
    preview: { port: 5173, strictPort: true },
  };
});
