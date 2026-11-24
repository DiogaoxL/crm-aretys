# Histórico de versões

Cada melhoria entregue gera uma versão nova (campo `version` do `package.json`, exibida no topo do app).

## 0.8.1
- Interface: barra de progresso em tudo que o usuário dispara e precisa esperar: **gerar lista**, **verificar no Google** (barra real, empresa “12 de 100”), **enviar para o CRM** e **importar CSV**. Mostra o tempo decorrido e uma explicação da etapa, e fica fixa no topo ao rolar a página. Operações que não informam o andamento usam barra animada (sem porcentagem inventada). Nenhuma mudança de funcionalidade.

## 0.8.0
- **Barra de progresso** na atualização da base: etapa 1 de 2 (download) e 2 de 2 (carga), percentual e tempo restante estimado. A carga avança pelo tamanho de cada ZIP e mostra o arquivo em andamento.
- Correção: “Invalid Input Error: File is not latin-1 encoded”. Os arquivos Estabelecimentos8 e 9 de nov/2026 têm alguns bytes de controle (0x8F) em campos vazios, e o DuckDB recusava o arquivo inteiro. Agora esses bytes são trocados por espaço só no arquivo afetado (2 e 3 bytes, respectivamente) e a leitura é refeita, sem duplicar linhas.
- Mensagens de erro da carga agora dizem qual arquivo falhou.

## 0.7.0
- Segmentos vêm da própria base da Receita: **um segmento por atividade (CNAE) que tenha empresas** — até 1.359, conforme a base carregada —, agrupados pelas 21 seções oficiais da CNAE e com a quantidade de empresas de cada um (matrizes ativas, sem MEI).
- A contagem é recalculada a cada carga mensal, então o catálogo acompanha a base. Bases carregadas antes desta versão calculam a contagem sozinhas na primeira abertura.
- Tela: escolha a **Área** (seção da CNAE) e o **Segmento**, ou use a **busca** por nome ou código em todas as áreas. Substitui a opção “Outra atividade” da 0.6.0.
- Carga interrompida (queda, reinício do servidor) agora é detectada: a carga grava uma marca de “carga completa” só no fim. Sem ela, a tela avisa que a base está incompleta e oferece refazer (sem baixar de novo), em vez de gerar listas parciais.
- Os 213 nichos de segmentos.json continuam como uma área própria (“Nichos”), para recortes que um CNAE sozinho não separa (ex.: Dermatologia = consultas médicas + nome com DERMA/PELE). O “Filtro pelo nome” só aparece para eles.

## 0.6.0
- Gerar lista: catálogo completo de segmentos do GRID (Anexo A do guia): **213 segmentos em 20 nichos**, agrupados por nicho no seletor.
- Nova opção **Outra atividade (escolher o CNAE)**: gera a lista por qualquer um dos 1.359 CNAEs da Receita, com busca por nome ou código.
- Correção na busca de CNAE por segmento: trechos com vírgula, hífen ou parênteses (ex.: “lanchonetes, casas de chá…”, “não-ferrosos”) não casavam com a descrição oficial. Validado contra a tabela real da Receita (nov/2026): sem a correção, 16 segmentos não achavam nenhum CNAE.
- Uma carga interrompida (tabela de estabelecimentos vazia) não conta mais como base carregada: a tela volta a oferecer o botão de carga.
- Correção: quando o Vite reiniciava o servidor sozinho (ao mudar um arquivo), o banco da Receita ficava travado (“arquivo já está sendo usado por outro processo”). Agora o banco é fechado e reaberto no reinício.
- Segmentos renomeados: Clínicas de estética, Imobiliárias e Software sob encomenda agora seguem os nomes do anexo (a tela ajusta a última escolha salva).

## 0.5.1
- Correção na carga da base: arquivos da Receita com quebra de linha dentro de um campo (caso real em Estabelecimentos de nov/2026) davam “Parameter Not Allowed Error … parallel=false”. O arquivo afetado agora é relido sem paralelismo, sem duplicar linhas; os demais continuam no modo rápido.

## 0.5.0
- Gerar lista: botão **Baixar e carregar a base** (e, depois, **Verificar mês novo e atualizar**). O app acha o mês mais recente publicado pela Receita, baixa os ZIPs com retomada, descompacta e carrega todas as UFs e municípios, e apaga os ZIPs ao terminar. Tudo dentro do projeto, em `dados/`. Progresso na tela; o CRM continua utilizável durante a atualização.
- A tela mostra o mês da Receita carregado e as UFs. Se a base já estiver no mês mais recente, não baixa nada.
- Terminal: `npm run receita:atualizar`. Configurável no `.env`: `RECEITA_UFS` e `RECEITA_SHARE_TOKEN`.
- Nenhuma mudança nos dados do CRM: backups da 0.4.x importam normalmente.

## 0.4.1
- Gerar lista: o botão passa a se chamar **Enviar para o CRM** (cria os leads direto, sem exportar e importar arquivo). O “Baixar CSV” continua opcional.

## 0.4.0
- Nova tela **Gerar lista**: monta listas de prospecção a partir da base pública de CNPJ da Receita (DuckDB local em `dados/receita.duckdb`), por segmento, UF e município, com score, decisor do quadro de sócios, telefone classificado (celular, fixo, contabilidade) e e-mail classificado.
- Verificação opcional no Google (Places API ou Serper) com cache de 90 dias e trava de cota mensal. Só roda com a chave no `.env` local.
- Importar a lista no CRM: entra pelo mesmo caminho do CSV, com deduplicação por telefone, site e agora também por CNPJ. Quem entrou no CRM não volta nas próximas listas por 90 dias.
- Ficha do lead: seção “Dados da Receita e do Google” para leads vindos de uma lista.
- Campo novo no lead: `dados_receita` (padrão `null`). Formato do backup inalterado: backups da 0.3.1 importam normalmente.
- Carga mensal da base: `npm run receita:carregar -- --zips <pasta> --uf PR`. Testes: `npm test`.

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
