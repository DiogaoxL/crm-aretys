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

## Arquitetura

```
src/
  domain/   regras puras: tipos, score, cadência, métricas, CSV, formatação, dados de exemplo
  db/
    schema.ts  schema Dexie versionado (adicione version(2)... para migrar)
    repo.ts    repositório: única camada que acessa o banco
    hooks.ts   hooks reativos (useLiveQuery) sobre o repositório
  components/ ficha, registro rápido, modais
  pages/      Fila, Leads, Dashboard, Importar, Configurações
```

Para trocar o IndexedDB por outro banco (por exemplo SQLite), reimplemente `db/repo.ts` e `db/hooks.ts` com as mesmas assinaturas. As telas não mudam.

> Os dados ficam só neste navegador e neste perfil. Exporte o backup JSON com frequência: a tela inicial avisa quando passam mais de 7 dias sem exportar.
