import { NextResponse } from "next/server";
import "@/lib/credenciais"; // chaves salvas em disco, quando roda fora da Vercel
import { env } from "@/lib/env";
import { getTotvsToken, totvsBaseUrl, totvsFetch } from "@/lib/connectors/totvs";

export const dynamic = "force-dynamic";

const final = (v: string) => (v ? `…${v.slice(-4)} (${v.length} caracteres)` : "AUSENTE");

/**
 * Teste rápido da TOTVS: quais credenciais o servidor está usando (só o
 * final, nunca o valor), se o login funciona e se a busca de notas responde.
 */
export async function GET() {
  const linhas = [
    `URL: ${totvsBaseUrl()}`,
    `Client ID: ${final(env("TOTVS_CLIENT_ID"))}`,
    `Client secret: ${final(env("TOTVS_CLIENT_SECRET"))}`,
    `Usuário: ${env("TOTVS_USERNAME") || "AUSENTE"}`,
    `Senha: ${env("TOTVS_PASSWORD") ? "preenchida" : "AUSENTE"}`,
    "",
  ];
  try {
    await getTotvsToken();
    linhas.push("Login na TOTVS: ✓ OK");
    const hoje = new Date().toISOString().slice(0, 10);
    const r = await totvsFetch("/api/totvsmoda/fiscal/v2/invoices/search", {
      filter: {
        branchCodeList: [1],
        operationType: "Output",
        change: { startDate: `${hoje}T00:00:00`, endDate: `${hoje}T23:59:59` },
      },
      page: 1,
      pageSize: 1,
    });
    linhas.push(
      r.status === 200
        ? `Busca de notas: ✓ OK (${(r.json?.totalItems as number | undefined) ?? (r.json?.count as number | undefined) ?? "?"} nota(s) alteradas hoje no Centro)`
        : `Busca de notas: ✗ HTTP ${r.status} — ${r.text.slice(0, 300)}`
    );
  } catch (e) {
    linhas.push(`Login na TOTVS: ✗ ${e instanceof Error ? e.message : "erro"}`);
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Teste TOTVS</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:24px 14px;max-width:700px;margin:0 auto}
h1{font-size:17px;margin:0 0 12px}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:12px;font-size:12.5px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>Teste da TOTVS</h1>
<pre>${linhas.join("\n").replace(/</g, "&lt;")}</pre></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
