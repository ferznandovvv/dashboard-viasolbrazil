import { NextResponse } from "next/server";
import { totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Módulos candidatos a ter saldo de estoque na APIv2. */
const MODULOS = ["product", "stock", "inventory", "warehouse", "purchase", "production"];
const INTERESSE = /balance|stock|estoque|saldo|inventory|available|quantity/i;

/**
 * Descobre se a API expõe saldo de estoque: lê o catálogo (swagger) de cada
 * módulo candidato e destaca os caminhos que falam de saldo.
 */
export async function GET() {
  if (!totvsConfigured()) {
    return NextResponse.json({ erro: "TOTVS não configurada" }, { status: 400 });
  }

  const blocos = await Promise.all(
    MODULOS.map(async (mod) => {
      const caminho = `/api/totvsmoda/${mod}/v2/swagger/v1/swagger.json`;
      try {
        const r = await totvsFetch(caminho);
        if (r.status !== 200) return `${mod}: não existe (HTTP ${r.status})`;
        const doc = JSON.parse(r.text) as { paths?: Record<string, unknown> };
        const todos = Object.keys(doc.paths ?? {});
        const quentes = todos.filter((c) => INTERESSE.test(c));
        return (
          `${mod}: ${todos.length} caminhos\n` +
          (quentes.length
            ? `  ★ SALDO/ESTOQUE:\n${quentes.map((c) => `      ${c}`).join("\n")}\n`
            : "  (nenhum caminho de saldo)\n") +
          `  outros: ${todos
            .filter((c) => !INTERESSE.test(c))
            .slice(0, 12)
            .join(", ")}`
        );
      } catch (e) {
        return `${mod}: falhou — ${e instanceof Error ? e.message.slice(0, 80) : "erro"}`;
      }
    })
  );

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Estoque na API</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:22px 12px;max-width:760px;margin:0 auto}
h1{font-size:17px;margin:0 0 10px}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:12px;font-size:11.5px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>A API tem saldo de estoque?</h1>
<pre>${blocos.join("\n\n").replace(/</g, "&lt;")}</pre></body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
