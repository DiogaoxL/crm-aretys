# Histórico de versões

Cada melhoria entregue gera uma versão nova (campo `version` do `package.json`, exibida no topo do app).

## 0.3.1
- Configurações reorganizadas em duas colunas independentes, sem espaços vazios entre os cards.

## 0.3.0
- Modo escuro: opções Claro, Escuro e Sistema (segue o Windows/navegador). Botão no topo e em Configurações → Aparência.
- A escolha fica salva no navegador e vai junto no backup (preferências). Nenhuma mudança nos dados: backups da 0.2.0 importam normalmente.

## 0.2.0
- Exportar o estado completo da plataforma (leads, atividades, reuniões, vendas, configurações e preferências) num único JSON com a versão do app.
- Importar de uma versão anterior: o arquivo é convertido para o formato atual e normalizado. Mostra a comparação de contagens, verifica a integridade depois de importar e baixa um backup de segurança antes de substituir.
- Atualização no mesmo navegador: ao abrir uma versão nova, os dados já gravados são atualizados sozinhos.
- Recusa backups gerados por uma versão mais nova do app, com uma mensagem clara.
- Porta fixa 5173, para que as versões compartilhem os dados do navegador.

## 0.1.0
- MVP: fila do dia, kanban e lista, ficha com diagnóstico e score, registro rápido, cadência, reuniões, vendas, perdas, dashboard com gargalo, importação CSV, configurações e backup.
