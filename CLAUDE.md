# Regras para evoluir este projeto

O app roda localmente e os dados do usuário vivem no IndexedDB do navegador. **Toda mudança precisa preservar os dados de versões anteriores.**

A cada melhoria entregue:
1. Aumente `version` no `package.json` (patch para correções, minor para funcionalidades) e registre a mudança no `CHANGELOG.md`.
2. Campo novo com valor padrão: defina o padrão em `leadVazio()` (`src/domain/lead.ts`) ou em `CONFIG_PADRAO` (`src/domain/constants.ts`). A normalização (`src/db/migracoes.ts`) preenche os registros antigos. O formato não muda.
3. Campo renomeado ou removido, valor de enum trocado ou estrutura alterada: aumente `FORMATO_BACKUP` (`src/domain/versao.ts`) e adicione `MIGRACOES[n]` em `src/db/migracoes.ts`, convertendo do formato n para n+1. Nunca apague migrações antigas.
4. Índices novos no IndexedDB: adicione `this.version(N+1).stores(...)` em `src/db/schema.ts`, mantendo as versões anteriores, com `.upgrade()` se precisar converter dados.
5. Etapa nova no pipeline: garanta que ela entre em `etapas_visiveis` das configurações existentes (pela normalização ou por uma migração).
6. Teste importando um backup gerado pela versão anterior. O resultado deve mostrar todas as contagens com ✓.
7. Não mude a porta 5173 (`vite.config.ts`): os dados do navegador ficam ligados a ela.
