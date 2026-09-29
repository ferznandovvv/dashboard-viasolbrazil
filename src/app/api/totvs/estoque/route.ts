import { NextResponse } from "next/server";
import { LOJAS, totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SWAGGER = "/api/totvsmoda/product/v2/swagger/v1/swagger.json";
const BALANCES = "/api/totvsmoda/product/v2/balances/search";

/**
 * Descobre como consultar o saldo: lista todos os caminhos do módulo de
 * produto e tenta o balances/search com os códigos de depósito candidatos.
 */
export async function GET() {
  if (!totvsConfigured()) return NextResponse.json({ erro: "TOTVS não configurada" }, { status: 400 });

  const partes: string[] = [];

  // 1) Todos os caminhos do módulo, para achar quem lista os depósitos
  try {
    const r = await totvsFetch(SWAGGER);
    const doc = JSON.parse(r.text) as { paths?: Record<string, unknown> };
    partes.push(`TODOS OS CAMINHOS DO MÓDULO PRODUTO:\n  ${Object.keys(doc.paths ?? {}).join("\n  ")}`);
  } catch (e) {
    partes.push(`swagger falhou: ${e instanceof Error ? e.message : "erro"}`);
  }

  // 2) Saldo: o option exige filial + códigos de depósito, então varremos
  //    os códigos candidatos de 1 a 10 na primeira loja
  const filial = Number(Object.keys(LOJAS)[0]);
  const faixa = { startProductCode: 1, endProductCode: 99999999 };
  const tentativas: { rotulo: string; corpo: unknown }[] = [
    {
      rotulo: `depósitos 1..10 na filial ${filial}`,
      corpo: {
        filter: faixa,
        option: { balances: [{ branchCode: filial, stockCodeList: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }] },
        page: 1,
        pageSize: 3,
      },
    },
    {
      rotulo: `depósito 1 na filial ${filial}`,
      corpo: {
        filter: faixa,
        option: { balances: [{ branchCode: filial, stockCodeList: [1] }] },
        page: 1,
        pageSize: 3,
      },
    },
    {
      rotulo: "todas as filiais, depósitos 1..5",
      corpo: {
        filter: faixa,
        option: {
          balances: Object.keys(LOJAS).map((f) => ({
            branchCode: Number(f),
            stockCodeList: [1, 2, 3, 4, 5],
          })),
        },
        page: 1,
        pageSize: 3,
      },
    },
  ];

  for (const t of tentativas) {
    try {
      const r = await totvsFetch(BALANCES, t.corpo);
      if (r.status !== 200) {
        partes.push(`✗ ${t.rotulo} (HTTP ${r.status})\n  ${(r.json ? JSON.stringify(r.json) : r.text).slice(0, 320)}`);
        continue;
      }
      const j = r.json as { count?: number; items?: Record<string, unknown>[] } | null;
      const primeiro = j?.items?.[0];
      partes.push(
        `✓ ${t.rotulo} — count=${j?.count ?? "?"}\n` +
          `  campos: ${primeiro ? Object.keys(primeiro).join(", ") : "(sem itens)"}\n` +
          `  exemplo: ${JSON.stringify(primeiro ?? {}).slice(0, 1200)}`
      );
    } catch (e) {
      partes.push(`✗ ${t.rotulo}: ${e instanceof Error ? e.message.slice(0, 140) : "erro"}`);
    }
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Saldo de estoque</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:22px 12px;max-width:760px;margin:0 auto}
h1{font-size:17px;margin:0 0 10px}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:12px;font-size:11.5px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>Saldo de estoque — depósitos e amostra</h1>
<pre>${partes.join("\n\n").replace(/</g, "&lt;")}</pre></body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
