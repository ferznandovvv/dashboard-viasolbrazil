import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API = "https://business-api.tiktok.com/open_api/v1.3";

/**
 * Diagnóstico do TikTok Ads: mostra o que o servidor enxerga das variáveis de
 * ambiente e o que a API responde de fato, sem expor o token.
 */
export async function GET() {
  const token = process.env.TIKTOK_ADS_ACCESS_TOKEN ?? "";
  const advertiserId = process.env.TIKTOK_ADS_ADVERTISER_ID ?? "";

  const linhas: string[] = [
    `TIKTOK_ADS_ACCESS_TOKEN: ${
      token ? `presente (${token.length} caracteres, termina em …${token.slice(-4)})` : "AUSENTE"
    }`,
    `TIKTOK_ADS_ADVERTISER_ID: ${advertiserId || "AUSENTE"}`,
  ];

  if (token && advertiserId) {
    // Quais contas o token enxerga
    try {
      const r = await fetch(`${API}/oauth2/advertiser/get/?app_id=${process.env.TIKTOK_ADS_APP_ID ?? ""}&secret=${process.env.TIKTOK_ADS_APP_SECRET ?? ""}`, {
        headers: { "Access-Token": token },
        cache: "no-store",
      });
      const j = await r.json();
      const lista = (j.data?.list ?? []) as { advertiser_id?: string; advertiser_name?: string }[];
      linhas.push(
        "",
        `Contas do token: code=${j.code} ${j.message ?? ""}`,
        ...lista.map(
          (c) =>
            `  ${c.advertiser_id} ${c.advertiser_name ?? ""}${
              c.advertiser_id === advertiserId ? "   ← a configurada" : ""
            }`
        )
      );
      if (lista.length && !lista.some((c) => c.advertiser_id === advertiserId)) {
        linhas.push("  ⚠ o ID configurado não está entre as contas do token");
      }
    } catch (e) {
      linhas.push(`Contas do token: falhou — ${e instanceof Error ? e.message : "erro"}`);
    }

    // O relatório em si, no mês corrente
    const hoje = new Date().toISOString().slice(0, 10);
    const inicio = `${hoje.slice(0, 7)}-01`;
    const url = new URL(`${API}/report/integrated/get/`);
    url.searchParams.set("advertiser_id", advertiserId);
    url.searchParams.set("report_type", "BASIC");
    url.searchParams.set("data_level", "AUCTION_ADVERTISER");
    url.searchParams.set("dimensions", JSON.stringify(["stat_time_day"]));
    url.searchParams.set("metrics", JSON.stringify(["spend"]));
    url.searchParams.set("start_date", inicio);
    url.searchParams.set("end_date", hoje);
    url.searchParams.set("page_size", "50");
    try {
      const r = await fetch(url, { headers: { "Access-Token": token }, cache: "no-store" });
      const j = await r.json();
      const linhasRel = (j.data?.list ?? []) as {
        dimensions?: { stat_time_day?: string };
        metrics?: { spend?: string };
      }[];
      const total = linhasRel.reduce((s, l) => s + parseFloat(l.metrics?.spend ?? "0"), 0);
      linhas.push(
        "",
        `Relatório ${inicio} a ${hoje}: HTTP ${r.status}, code=${j.code} ${j.message ?? ""}`,
        `  ${linhasRel.length} dias, gasto total R$ ${total.toFixed(2)}`,
        ...linhasRel
          .slice(0, 10)
          .map((l) => `  ${l.dimensions?.stat_time_day ?? "?"}  ${l.metrics?.spend ?? "0"}`)
      );
      if (j.code !== 0) linhas.push(`  resposta crua: ${JSON.stringify(j).slice(0, 400)}`);
    } catch (e) {
      linhas.push(`Relatório: falhou — ${e instanceof Error ? e.message : "erro"}`);
    }
  } else {
    linhas.push("", "Sem as duas variáveis o conector nem tenta — e o card não aparece.");
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Diagnóstico TikTok Ads</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:24px 14px;max-width:700px;margin:0 auto}
h1{font-size:17px;margin:0 0 12px}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>Diagnóstico TikTok Ads</h1>
<pre>${linhas.join("\n").replace(/</g, "&lt;")}</pre></body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
