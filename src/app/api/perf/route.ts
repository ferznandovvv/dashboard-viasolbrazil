import { NextResponse } from "next/server";
import { fetchShopifyOrders } from "@/lib/connectors/shopify";
import { fetchMeliOrders } from "@/lib/connectors/mercadolivre";
import { fetchTikTokOrders } from "@/lib/connectors/tiktok";
import { fetchMetaSpend } from "@/lib/connectors/meta";
import { fetchTikTokAdsSpend } from "@/lib/connectors/tiktokAds";
import { fetchTotvsSales, medidas, zerarMedidas } from "@/lib/connectors/totvs";
import { addDays, todaySpKey } from "@/lib/types";
import { blobAvailable } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Executa uma etapa medindo o tempo, sem deixar erro derrubar a medição. */
async function medir<T>(nome: string, fn: () => Promise<T>): Promise<[string, number, string]> {
  const t0 = Date.now();
  try {
    const r = (await fn()) as { orders?: unknown[]; daily?: unknown[]; error?: string };
    const n = r?.orders?.length ?? r?.daily?.length ?? 0;
    return [nome, Date.now() - t0, r?.error ? `erro: ${r.error.slice(0, 60)}` : `${n} registros`];
  } catch (e) {
    return [nome, Date.now() - t0, `falhou: ${e instanceof Error ? e.message.slice(0, 60) : "?"}`];
  }
}

/**
 * Medição de desempenho: mostra quanto cada etapa demora e quanto do cache
 * está sendo aproveitado, para atacar o gargalo certo.
 */
export async function GET() {
  const hoje = todaySpKey();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const inicioBusca = addDays(inicioMes, -30); // como no filtro "Mês atual"
  const t0 = Date.now();

  zerarMedidas();
  const lojasFrio = await medir("TOTVS lojas (1ª vez)", () =>
    fetchTotvsSales(inicioBusca, hoje)
  );
  const frio = { ...medidas };

  zerarMedidas();
  const lojasQuente = await medir("TOTVS lojas (repetida)", () =>
    fetchTotvsSales(inicioBusca, hoje)
  );

  const outros = await Promise.all([
    medir("Shopify", () => fetchShopifyOrders(new Date(`${inicioBusca}T00:00:00-03:00`))),
    medir("TikTok Shop", () => fetchTikTokOrders(new Date(`${inicioBusca}T00:00:00-03:00`))),
    medir("Mercado Livre", () => fetchMeliOrders(new Date(`${inicioBusca}T00:00:00-03:00`))),
    medir("Meta Ads", () => fetchMetaSpend(inicioBusca, hoje)),
    medir("TikTok Ads", () => fetchTikTokAdsSpend(inicioBusca, hoje)),
  ]);

  const linhas = [lojasFrio, lojasQuente, ...outros]
    .sort((a, b) => b[1] - a[1])
    .map(([nome, ms, obs]) => `${nome.padEnd(24)} ${String(ms).padStart(6)} ms   ${obs}`)
    .join("\n");

  const diag =
    `Período medido: ${inicioBusca} a ${hoje}\n` +
    `Armazenamento (Blob): ${blobAvailable() ? "CONFIGURADO" : "AUSENTE — nenhum cache funciona"}\n\n` +
    `${linhas}\n\n` +
    `Na 1ª busca das lojas:\n` +
    `  páginas pedidas à TOTVS: ${frio.paginas}\n` +
    `  dias vindos do cache:    ${frio.diasDoCache}\n` +
    `  meses vindos do cache:   ${frio.mesesDoCache}\n\n` +
    `Total da medição: ${Date.now() - t0} ms`;

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Medição de desempenho</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:22px 12px;max-width:720px;margin:0 auto}
h1{font-size:17px;margin:0 0 10px}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>Medição de desempenho</h1>
<pre>${diag.replace(/</g, "&lt;")}</pre></body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
