import { NextResponse } from "next/server";
import { getTotvsToken, totvsBaseUrl, totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";

export const dynamic = "force-dynamic";

function page(title: string, inner: string, ok: boolean): NextResponse {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f9f9f7;color:#0b0b0b;display:flex;justify-content:center;padding:40px 16px}
.card{background:#fcfcfb;border:1px solid rgba(11,11,11,.1);border-radius:16px;padding:28px;max-width:760px;width:100%}
h1{font-size:18px;margin:0 0 4px}
.s{color:${ok ? "#006300" : "#d03b3b"};font-size:13px;margin-bottom:16px}
p{font-size:14px;line-height:1.5;color:#52514e}
code{background:#f0efec;border:1px solid #e1e0d9;border-radius:4px;padding:2px 6px;font-size:12px;word-break:break-all}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:10px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
.row{margin:14px 0}
.ep{font-weight:600;font-size:13px}
</style></head><body><div class="card"><h1>Conexão TOTVS Moda</h1>${inner}</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Diagnóstico da integração TOTVS: autentica e sonda os endpoints candidatos
 * de filiais e de notas fiscais, mostrando o que cada um respondeu.
 */
export async function GET() {
  if (!totvsConfigured()) {
    return page(
      "Falta configurar",
      `<div class="s">Configuração incompleta</div>
       <p>Adicione nas variáveis de ambiente da Vercel e faça redeploy:</p>
       <p><code>TOTVS_API_URL</code> <code>TOTVS_CLIENT_ID</code> <code>TOTVS_CLIENT_SECRET</code>
       <code>TOTVS_USERNAME</code> <code>TOTVS_PASSWORD</code></p>
       <p>URL em uso quando não informada: <code>${totvsBaseUrl()}</code></p>`,
      false
    );
  }

  try {
    await getTotvsToken();
  } catch (e) {
    return page(
      "Erro de autenticação",
      `<div class="s">✗ ${e instanceof Error ? e.message : "Erro desconhecido"}</div>
       <p>Confira o usuário do ADMFM026 (usuário/senha), as credenciais do LOGFC006
       (client_id/client_secret) e a URL <code>${totvsBaseUrl()}</code>.</p>`,
      false
    );
  }

  // Sonda endpoints de filial e de faturamento, do mais provável ao alternativo
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const branches = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const probes: { label: string; path: string; body?: unknown }[] = [
    {
      label: "Notas fiscais — data de emissão",
      path: "/api/totvsmoda/fiscal/v2/invoices/search",
      body: {
        filter: {
          branchCodeList: branches,
          issueDate: { startDate: `${monthAgo}T00:00:00`, endDate: `${today}T23:59:59` },
        },
        expand: "items,shippingData",
        page: 1,
        pageSize: 2,
      },
    },
    {
      label: "Notas fiscais — sem filtro de data",
      path: "/api/totvsmoda/fiscal/v2/invoices/search",
      body: { filter: { branchCodeList: branches }, page: 1, pageSize: 2 },
    },
    {
      label: "Pedidos de venda",
      path: "/api/totvsmoda/sales-order/v2/orders/search",
      body: {
        filter: {
          branchCodeList: branches,
          issueDate: { startDate: `${monthAgo}T00:00:00`, endDate: `${today}T23:59:59` },
        },
        expand: "items",
        page: 1,
        pageSize: 2,
      },
    },
  ];

  const blocks: string[] = [];
  for (const p of probes) {
    try {
      const r = await totvsFetch(p.path, p.body);
      const preview = (r.json ? JSON.stringify(r.json) : r.text).slice(0, 2500);
      blocks.push(
        `<div class="row"><div class="ep">${r.status === 200 ? "✓" : "✗"} ${p.label} — <code>${p.path}</code> (HTTP ${r.status})</div>
         <pre>${preview.replace(/</g, "&lt;")}</pre></div>`
      );
    } catch (e) {
      blocks.push(
        `<div class="row"><div class="ep">✗ ${p.label} — <code>${p.path}</code></div>
         <pre>${(e instanceof Error ? e.message : "erro").replace(/</g, "&lt;")}</pre></div>`
      );
    }
  }

  return page(
    "Conectado!",
    `<div class="s">✓ Autenticação OK em ${totvsBaseUrl()}</div>
     <p>Resultado da sondagem dos endpoints — me mande esta tela no chat para eu
     finalizar o conector com os caminhos corretos:</p>
     ${blocks.join("")}`,
    true
  );
}
