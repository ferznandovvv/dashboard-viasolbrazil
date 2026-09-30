import { NextRequest, NextResponse } from "next/server";
import { LOJAS, totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BALANCES = "/api/totvsmoda/product/v2/balances/search";

/**
 * O filtro por nome do saldo funciona mesmo?
 *
 * Se ele for ignorado, pedir "BOLSA LARI" devolve o catálogo inteiro — e a
 * tela de produtos fica lenta achando que pediu um produto só.
 */
export async function GET(req: NextRequest) {
  if (!totvsConfigured()) return NextResponse.json({ erro: "TOTVS não configurada" }, { status: 400 });
  const nome = (req.nextUrl.searchParams.get("nome") ?? "BOLSA LARI").trim();

  const corpo = (filtro: Record<string, unknown>) => ({
    filter: { startProductCode: 1, endProductCode: 99999999, ...filtro },
    option: {
      balances: Object.keys(LOJAS).map((f) => ({ branchCode: Number(f), stockCodeList: [1] })),
    },
    page: 1,
    pageSize: 5,
  });

  const testes: { rotulo: string; filtro: Record<string, unknown> }[] = [
    { rotulo: `productName = "${nome}"`, filtro: { productName: nome } },
    { rotulo: "sem filtro de nome (referência)", filtro: {} },
  ];

  const linhas: string[] = [];
  for (const t of testes) {
    const t0 = Date.now();
    try {
      const r = await totvsFetch(BALANCES, corpo(t.filtro));
      const j = r.json as { count?: number; items?: { productName?: string }[] } | null;
      const nomes = (j?.items ?? []).map((i) => i.productName ?? "?");
      const batem = nomes.filter((n) => n.toUpperCase().includes(nome.toUpperCase())).length;
      linhas.push(
        `${t.rotulo}\n` +
          `  HTTP ${r.status} em ${Date.now() - t0} ms\n` +
          `  count = ${j?.count ?? "?"}   (quantos produtos a consulta encontrou)\n` +
          `  ${batem} de ${nomes.length} da amostra contêm "${nome}"\n` +
          `  amostra: ${nomes.join(" | ")}`
      );
    } catch (e) {
      linhas.push(`${t.rotulo}\n  falhou em ${Date.now() - t0} ms: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  linhas.push(
    "LEITURA: se os dois count forem iguais e a amostra do primeiro não contiver\n" +
      "o nome buscado, o filtro está sendo ignorado pela API."
  );

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Filtro de nome no estoque</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:22px 12px;max-width:760px;margin:0 auto}
h1{font-size:17px;margin:0 0 10px}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>O filtro por nome funciona?</h1>
<pre>${linhas.join("\n\n").replace(/</g, "&lt;")}</pre></body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
