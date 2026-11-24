/**
 * Expõe o serviço de prospecção ao CRM em /api/prospeccao/* no MESMO servidor local do Vite
 * (npm run dev / npm run preview, porta 5173). Não há servidor extra nem nuvem: o navegador
 * fala com o Node da própria máquina, e o Node lê o arquivo DuckDB local.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { criarServico, type ConfigServico } from "./servico.js";

const PREFIXO = "/api/prospeccao/";

async function lerJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let corpo = "";
  for await (const parte of req) corpo += parte;
  return corpo ? JSON.parse(corpo) : {};
}

function json(res: ServerResponse, status: number, dados: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(dados));
}

export function prospeccaoPlugin(cfg: ConfigServico): Plugin {
  const servico = criarServico(cfg);

  // Lê o corpo do pedido, chama o serviço e devolve JSON (erros viram { erro }).
  const rotas: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<unknown>> = {
    "GET status": () => servico.status(),
    "GET segmentos": () => servico.segmentos(),
    "POST lista": async (req) => {
      const { slug, ...opcoes } = await lerJson(req);
      return servico.novaLista(String(slug), opcoes as Parameters<typeof servico.novaLista>[1]);
    },
    "POST registrar": async (req) => {
      const { lista, cnpjs } = await lerJson(req);
      await servico.registrar(String(lista), (cnpjs as string[]) ?? []);
      return { ok: true };
    },
    "POST fechar": async () => { await servico.fechar(); return { ok: true }; },
    // Baixa o mês mais recente da Receita, carrega e apaga os ZIPs (em segundo plano).
    "POST atualizar": async (req) => {
      const { forcar } = await lerJson(req);
      return servico.atualizar({ forcar: !!forcar });
    },
    "GET atualizacao": async () => servico.progresso(),
    // Resposta em NDJSON: uma linha por empresa verificada (progresso) e a última com o resultado.
    "POST google": async (req, res) => {
      const { linhas, provedor, detalhes } = await lerJson(req);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      const escrever = (o: unknown) => res.write(JSON.stringify(o) + "\n");
      try {
        const r = await servico.verificarNoGoogle(
          linhas as Record<string, string>[],
          { provedor: provedor as "google" | "serper", detalhes: !!detalhes },
          (i, total, status) => escrever({ tipo: "progresso", i, total, status }),
        );
        escrever({ tipo: "fim", ...r });
      } catch (e) {
        escrever({ tipo: "erro", erro: (e as Error).message });
      }
      res.end();
      return undefined;
    },
  };

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0];
    if (!url.startsWith(PREFIXO)) return next();
    const rota = rotas[`${req.method} ${url.slice(PREFIXO.length)}`];
    if (!rota) return json(res, 404, { erro: "Rota não encontrada." });
    try {
      const dados = await rota(req, res);
      if (!res.writableEnded) json(res, 200, dados);
    } catch (e) {
      console.error("[prospeccao]", e);
      if (!res.headersSent) json(res, 500, { erro: (e as Error).message });
      else res.end();
    }
  };

  // O Vite reinicia o servidor no mesmo processo quando um arquivo daqui muda: sem fechar, a instância
  // antiga continua com o arquivo DuckDB aberto e a nova não consegue abri-lo.
  const liberar = () => servico.fechar(true).catch((e) => console.error("[prospeccao] ao fechar o banco", e));

  return {
    name: "crm-prospeccao-receita",
    configureServer: (server) => {
      server.middlewares.use(middleware);
      server.httpServer?.once("close", liberar);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(middleware);
      server.httpServer?.once("close", liberar);
    },
    closeBundle: liberar,
  };
}
