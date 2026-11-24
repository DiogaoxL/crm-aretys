# CRM Prospecção (outbound por telefone)

MVP de CRM para um único vendedor. 100% local: sem login, sem backend, sem nuvem.
Os dados ficam no navegador (IndexedDB, via Dexie).

## Rodar

```bash
npm install
npm run dev
```

Abra o endereço mostrado (normalmente http://localhost:5173). Para testar, vá em **Configurações → Carregar dados de exemplo** (15 leads, com histórico, reuniões e venda).

`npm run build` gera a versão estática em `dist/`.

## Atualizar para uma versão nova sem perder dados

1. Na versão em uso: **Configurações → Exportar estado completo (JSON)**. O arquivo leva a versão no nome, por exemplo `crm-backup-2026-11-22-v0.2.0.json`.
2. Baixe a versão nova, descompacte (pode substituir a pasta antiga) e rode `npm install` e `npm run dev`.
3. Na versão nova: **Configurações → Importar de versão anterior / backup…** → **Substituir**. O app converte o arquivo para o formato novo, mostra as contagens e confere se tudo entrou (✓).

No mesmo navegador e na mesma porta (5173), a versão nova já enxerga os dados e os atualiza sozinha ao abrir (aparece o aviso “App atualizado de X para Y”). O arquivo exportado é a garantia, e também serve para trocar de navegador ou de computador.

Antes de substituir dados existentes, o app baixa um backup de segurança. Arquivos de uma versão mais nova que o app são recusados.

## Telas

- **Fila do dia** (inicial): ordem por próxima ação vencida ou de hoje, depois temperatura, score e fit. Telefone abre `tel:` e WhatsApp. O botão “Registrar ligação” abre o registro rápido na própria linha.
- **Leads**: Kanban (arrastar e soltar entre etapas) ou Lista (ordenação, filtros, busca e seleção em massa).
- **Ficha do lead** (painel lateral): dados, decisor, diagnóstico com score ao vivo, frases de abordagem, registro rápido, cadência, reuniões, venda, linha do tempo, “Marcar como perdido”.
- **Dashboard**: funil de 7 indicadores, conversão × meta por transição, detecção de gargalo, motivos de perda, conexão por faixa de score e segmento, ligações por dia, tentativas até a 1ª conexão.
- **Gerar lista**: lista de prospecção a partir da base da Receita (segmento, UF, município, porte, idade, decisor), verificação opcional no Google e importação dos selecionados no CRM. Veja “Criação de lista” abaixo.
- **Importar**: CSV com mapeamento de colunas, pré-visualização, relatório (importados, ignorados, duplicados) e CSV modelo.
- **Configurações**: metas, limite de fit, cadência, motivos de perda, etapas visíveis, backup JSON (exportar, mesclar, substituir), CSV de leads e atividades, dados de exemplo, apagar tudo.

## Atalhos na ficha

| Tecla | Ação |
|---|---|
| `L` | foca o registro de ligação |
| `1`–`8` | escolhe o resultado |
| `P` | foca a próxima ação |
| `Ctrl+Enter` | salva o registro |
| `Esc` | fecha a ficha |

## Regras implementadas

- **Score** (0–100): mídia paga 40, site/conversão 30, social 15, GMN/local 15. “Não verificado” vale 0 e marca “diagnóstico incompleto”.
- **Faixas**: 90–100 quase nada (só com fit forte), 70–89 prioridade alta, 40–69 lacunas pontuais, 0–39 não ligar (sugere Descartado, com confirmação).
- **Maior lacuna**: o bloco com maior proporção de pontos de lacuna em relação ao máximo do bloco (empate: mais pontos absolutos).
- **Fit**: forte se capital social ≥ limite (padrão R$ 100.000). Pode ser sobrescrito na ficha.
- **Registro de atividade**: atualiza o último contato, as tentativas (ligações) e a cadência; sugere a etapa (o usuário confirma pela caixa “Mover para …”); “Reunião marcada” cria a Reunião; “Sem interesse” sugere Perdido e pede o motivo.
- **Cadência**: padrão de 6 tentativas em 14 dias (ligação, WhatsApp, ligação, e-mail, ligação, WhatsApp). A próxima ação é pré-preenchida com o próximo passo. A cadência termina na primeira conexão. Ao esgotar sem conexão, a ficha oferece Perdido (“Sem contato após a cadência”) ou pausar.
- **Gargalo**: para cada transição, distância = (meta − taxa) / meta. A maior distância positiva é o gargalo.
- **Períodos do dashboard**: ligações pela data da atividade; reuniões marcadas pela data em que foram marcadas; realizadas pela data da reunião; vendas pela data da venda; perdas pela data em que o lead foi para Perdido.
- Telefones guardados só com dígitos e DDI 55, exibidos formatados. Datas no fuso America/Sao_Paulo.

## Criação de lista (base da Receita)

Roda no Node desta máquina, dentro do próprio `npm run dev` (ou `npm run preview`), em `/api/prospeccao/*` na porta 5173. Não há servidor extra nem nuvem. No `dist/` estático (sem Node) a tela avisa que precisa do `npm run dev`.

1. **Uma vez por mês:** em **Gerar lista**, clique em **Baixar e carregar a base** (depois, **Verificar mês novo e atualizar**). O app:
   - descobre o mês mais recente no compartilhamento público da Receita (`arquivos.receitafederal.gov.br`, WebDAV);
   - baixa os 33 ZIPs necessários (~7,8 GB) para `dados/cnpj/AAAA-MM`, retomando se a conexão cair;
   - descompacta um por vez em `dados/tmp` e carrega no banco `dados/receita.duckdb` (todas as UFs; para limitar, `RECEITA_UFS=PR,SC` no `.env`);
   - apaga os ZIPs e a pasta temporária **só depois** que a carga termina sem erro. Se já estiver no mês mais recente, não baixa nada.

   Tudo fica dentro do projeto, em `dados/` (fora do Git). Deixe o projeto fora de OneDrive/Dropbox. A recarga recria só as tabelas da Receita: o histórico de quem foi enviado ao CRM e o cache do Google ficam.

   Pelo terminal (com o app fechado): `npm run receita:atualizar` (opções `--uf PR`, `--manter-zips`, `--forcar`). Com ZIPs baixados à mão: `npm run receita:carregar -- --zips <pasta>`. Se a Receita trocar o compartilhamento, ajuste `RECEITA_SHARE_TOKEN` no `.env`.
2. **Gerar lista:** escolha o segmento: cada atividade (CNAE) da base com empresas é um segmento, agrupado por seção da CNAE e com a quantidade de empresas (busca por nome ou código). Há também a área “Nichos”, com recortes por nome em `src/server/prospeccao/segmentos.json` (dá para editar e acrescentar), a UF e os municípios, e clique em **Gerar lista**. Selecione e clique em **Enviar para o CRM**: os leads são criados direto no CRM, sem exportar nem importar arquivo. Quem entrou no CRM não volta nas próximas listas por 90 dias.
3. **Google (opcional):** crie `.env` na pasta do CRM com `GOOGLE_PLACES_API_KEY=sua-chave` (ou `SERPER_API_KEY`) e reinicie o `npm run dev`. A chave fica só no Node, nunca vai para o navegador. A verificação é a única parte que acessa a internet (`places.googleapis.com` / `google.serper.dev`), e para antes de passar de 4.800 (Text Search) e 950 (Details) chamadas por mês.

Também pela linha de comando: `npm run receita:lista -- --segmento dermatologia --uf PR --municipio Curitiba` e `npm run receita:google -- lista.csv`. Testes: `npm test`.

LGPD: nome de sócio e telefone/e-mail de empresário individual são dados pessoais. Registre o legítimo interesse e respeite pedidos de opt-out.

## Arquitetura

```
src/
  domain/   regras puras: tipos, score, cadência, métricas, CSV, formatação, dados de exemplo, conversão da lista em lead
  db/
    schema.ts  schema Dexie versionado (adicione version(2)... para migrar)
    repo.ts    repositório: única camada que acessa o banco
    hooks.ts   hooks reativos (useLiveQuery) sobre o repositório
    prospeccaoApi.ts  cliente da API local de criação de lista
  components/ ficha, registro rápido, modais
  pages/      Fila, Leads, Gerar lista, Dashboard, Importar, Configurações
  server/     roda no Node (nunca no navegador)
    prospeccao/  criação de lista: Receita → DuckDB, lista, verificação no Google, serviço e plugin do Vite
```

Para trocar o IndexedDB por outro banco (por exemplo SQLite), reimplemente `db/repo.ts` e `db/hooks.ts` com as mesmas assinaturas. As telas não mudam.

> Os dados ficam só neste navegador e neste perfil. Exporte o backup JSON com frequência: a tela inicial avisa quando passam mais de 7 dias sem exportar.
