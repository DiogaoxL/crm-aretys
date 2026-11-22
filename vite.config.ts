import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Porta fixa: os dados do IndexedDB ficam ligados ao endereço (localhost:5173).
  // Mantendo a mesma porta, uma versão nova do app enxerga os dados da anterior no mesmo navegador.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
