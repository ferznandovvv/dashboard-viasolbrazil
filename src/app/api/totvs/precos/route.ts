import { NextResponse } from "next/server";
import { LOJAS, totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";
import { type SwaggerDoc, descrever } from "@/lib/swagger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SWAGGER = "/api/totvsmoda/product/v2/swagger/v1/swagger.json";
const PRECOS = "/api/totvsmoda/product/v2/prices/search";
const SALDO = "/api/totvsmoda/product/v2/balances/search";
/** Produto de exemplo, com preço diferente entre as tabelas */
const EXEMPLO = "BOLSA PALHA PREMIUM DIVERSOS U";

type Esq = Parameters<typeof descrever>[1];

/**
 * Diagnóstico dos preços: mostra só a parte "option" do contrato de
 * prices/search e pede o preço de um produto de exemplo em cada loja, com
 * todos os códigos de preço de 1 a 30 — o que vier com valor são as tabelas.
 */
export async function GET() {
  const linhas: string[] = [];
  if (!totvsConfigured()) linhas.push("TOTVS não configurada.");
  else {
    try {
      // 1. Contrato: só o "option" e a resposta, que é o que falta saber
      const sw = await totvsFetch(SWAGGER);
      const doc = JSON.parse(sw.text) as SwaggerDoc;
      const op = doc.paths?.[PRECOS]?.post as
        | {
            requestBody?: { content?: Record<string, { schema?: Esq }> };
            responses?: Record<string, { content?: Record<string, { schema?: Esq }> }>;
          }
        | undefined;
      const req = op?.requestBody?.content?.["application/json"]?.schema;
      const reqTxt = descrever(doc, req);
      const iOpt = reqTxt.search(/\n {2}option:/);
      const r200 = op?.responses?.["200"]?.content;
      const resp = r200?.["application/json"]?.schema ?? Object.values(r200 ?? {})[0]?.schema;
      linhas.push(
        "CONTRATO prices/search — parte option:",
        iOpt >= 0 ? reqTxt.slice(iOpt) : "(sem option)\n" + reqTxt.slice(-1500),
        "",
        "RESPOSTA:",
        descrever(doc, resp),
        ""
      );

      // 2. Código do produto de exemplo
      const saldo = await totvsFetch(SALDO, {
        filter: { productName: EXEMPLO },
        option: { balances: [{ branchCode: 1, stockCodeList: [1] }] },
        page: 1,
        pageSize: 1,
      });
      const item = (saldo.json?.items as { productCode?: number; productName?: string }[] | undefined)?.[0];
      const codigo = item?.productCode;
      linhas.push(`Produto de exemplo: ${item?.productName ?? EXEMPLO} → código ${codigo ?? "não achado"}`, "");

      // 3. Preço em cada loja, com todos os códigos de 1 a 30
      if (codigo) {
        const codigos = Array.from({ length: 30 }, (_, i) => i + 1);
        const corpo = {
          filter: { productCodeList: [codigo] },
          option: {
            prices: Object.keys(LOJAS).map((f) => ({ branchCode: Number(f), priceCodeList: codigos })),
          },
          page: 1,
          pageSize: 5,
        };
        const r = await totvsFetch(PRECOS, corpo);
        linhas.push(`CHAMADA prices/search: HTTP ${r.status}`);
        const itens = (r.json?.items as Record<string, unknown>[] | undefined) ?? [];
        if (itens.length) {
          const precos = (itens[0].prices as Record<string, unknown>[] | undefined) ?? [];
          linhas.push(
            `campos do preço: ${precos[0] ? Object.keys(precos[0]).join(", ") : "(nenhum preço)"}`,
            ...precos.map((p) =>
              [
                `loja ${p.branchCode} (${LOJAS[Number(p.branchCode)] ?? "?"})`,
                `código ${p.priceCode}`,
                `${p.priceName ?? p.priceDescription ?? ""}`,
                `= ${p.price ?? p.value ?? JSON.stringify(p)}`,
              ].join(" · ")
            ),
            "",
            "item cru:",
            JSON.stringify(itens[0]).slice(0, 2500)
          );
        } else linhas.push(r.text.slice(0, 1500));
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
</style></head><body><h1>Diagnóstico dos preços</h1>
<pre>${linhas.join("\n").replace(/</g, "&lt;")}</pre></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
