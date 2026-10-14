import { NextResponse } from "next/server";
import { totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";
import { type SwaggerDoc, contrato, retorno } from "@/lib/swagger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SWAGGER = "/api/totvsmoda/product/v2/swagger/v1/swagger.json";

/**
 * Diagnóstico das tabelas de preço: lê o Swagger do módulo de produto, mostra
 * o contrato de tudo que fala de preço e tenta listar as tabelas cadastradas.
 * Serve para descobrir os códigos e o formato antes de pôr o preço na tela.
 */
export async function GET() {
  const linhas: string[] = [];
  if (!totvsConfigured()) {
    linhas.push("TOTVS não configurada.");
  } else {
    try {
      const sw = await totvsFetch(SWAGGER);
      if (sw.status !== 200) {
        linhas.push(`Swagger: HTTP ${sw.status} — ${sw.text.slice(0, 200)}`);
      } else {
        const doc = JSON.parse(sw.text) as SwaggerDoc;
        const caminhos = Object.keys(doc.paths ?? {});
        const dePreco = caminhos.filter((c) => /price/i.test(c));
        linhas.push(
          `Caminhos do módulo de produto: ${caminhos.length}`,
          `Com "price": ${dePreco.length ? "" : "nenhum"}`,
          ...dePreco.map((c) => `  ${Object.keys(doc.paths![c]).join(",").toUpperCase()} ${c}`),
          ""
        );

        for (const c of dePreco) {
          linhas.push("────────", contrato(doc, c), retorno(doc, c));
          // Listas sem parâmetro no caminho: tenta chamar e mostra o que veio
          if (c.includes("{")) continue;
          const verbo = Object.keys(doc.paths![c])[0];
          const r =
            verbo === "get"
              ? await totvsFetch(c)
              : await totvsFetch(c, { page: 1, pageSize: 50 });
          linhas.push(`CHAMADA ${verbo.toUpperCase()}: HTTP ${r.status}`, r.text.slice(0, 2500), "");
        }

        // Quais campos vêm num item do saldo — às vezes o preço vem junto
        const saldo = await totvsFetch("/api/totvsmoda/product/v2/balances/search", {
          filter: { startProductCode: 1, endProductCode: 99999999 },
          option: { balances: [{ branchCode: 1, stockCodeList: [1] }] },
          page: 1,
          pageSize: 1,
        });
        const item = (saldo.json?.items as Record<string, unknown>[] | undefined)?.[0];
        linhas.push(
          "────────",
          `Item do saldo (HTTP ${saldo.status}):`,
          item ? JSON.stringify(item, null, 1).slice(0, 1500) : saldo.text.slice(0, 300)
        );
      }
    } catch (e) {
      linhas.push(`Falhou: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Diagnóstico preços</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:24px 14px;max-width:900px;margin:0 auto}
h1{font-size:17px;margin:0 0 12px}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:12px;font-size:11.5px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>Diagnóstico das tabelas de preço</h1>
<pre>${linhas.join("\n").replace(/</g, "&lt;")}</pre></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
