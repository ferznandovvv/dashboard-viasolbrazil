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
  const branches = [6]; // Ribeirão Preto, como amostra de loja física
  const INV = "/api/totvsmoda/fiscal/v2/invoices/search";
  const range = { startDate: `${monthAgo}T00:00:00`, endDate: `${today}T23:59:59` };
  const dOnly = { startDate: monthAgo, endDate: today };
  const probes: { label: string; path: string; body?: unknown; raw?: boolean }[] = [
    {
      label: "A) Base — filial 6, sem data",
      path: INV,
      body: { filter: { branchCodeList: branches }, page: 1, pageSize: 1 },
    },
    {
      label: "B) invoiceDate só data (sem hora)",
      path: INV,
      body: { filter: { branchCodeList: branches, invoiceDate: dOnly }, page: 1, pageSize: 1 },
    },
    {
      label: "C) issueDate só data",
      path: INV,
      body: { filter: { branchCodeList: branches, issueDate: dOnly }, page: 1, pageSize: 1 },
    },
    {
      label: "D) change inField=InvoiceDate (maiúsculo)",
      path: INV,
      body: {
        filter: { branchCodeList: branches, change: { ...range, inField: "InvoiceDate" } },
        page: 1,
        pageSize: 1,
      },
    },
    {
      label: "E) invoiceDateStart/End",
      path: INV,
      body: {
        filter: { branchCodeList: branches, invoiceDateStart: monthAgo, invoiceDateEnd: today },
        page: 1,
        pageSize: 1,
      },
    },
    {
      label: "F) VENDA COMPLETA (1 nota de saída, JSON cru)",
      path: INV,
      body: {
        filter: { branchCodeList: branches, operationType: "Output" },
        expand: "items,payments,person",
        page: 1,
        pageSize: 1,
      },
      raw: true,
    },
  ];

  // O swagger da própria API resolve o contrato do filtro sem chute
  const swaggerPaths = [
    "/api/totvsmoda/fiscal/v2/swagger.json",
    "/swagger/fiscal-v2/swagger.json",
    "/swagger/v1/swagger.json",
  ];
  for (const sp of swaggerPaths) {
    probes.push({ label: `S) swagger ${sp}`, path: sp, body: undefined, raw: true });
  }
  const blocks: string[] = [];
  for (const p of probes) {
    try {
      const r = await totvsFetch(p.path, p.body);
      const j = r.json as
        | { count?: number; items?: Record<string, unknown>[]; [k: string]: unknown }
        | null;
      let summary: string;
      if (r.status !== 200) {
        summary = (r.json ? JSON.stringify(r.json) : r.text).slice(0, 300);
      } else if (p.raw && p.label.startsWith("S)")) {
        // Swagger: extrai só o modelo de filtro das notas
        const txt = r.text;
        const idx = txt.search(/"[A-Za-z.]*Invoice[A-Za-z]*Filter"/);
        summary =
          idx >= 0
            ? txt.slice(idx, idx + 1800)
            : `swagger encontrado (${txt.length} bytes), sem modelo *InvoiceFilter*: ${txt.slice(0, 300)}`;
      } else if (p.raw) {
        summary = (r.json ? JSON.stringify(r.json.items ?? r.json) : r.text).slice(0, 2600);
      } else {
        const first = j?.items?.[0] ?? null;
        const pick = (k: string) => (first && k in first ? `${k}=${JSON.stringify(first[k])}` : "");
        const destaque = [
          "branchCode",
          "invoiceDate",
          "issueDate",
          "orderDate",
          "operationType",
          "operationName",
          "totalValue",
          "netValue",
          "sellerCpf",
          "sellerCode",
          "personName",
          "customerName",
        ]
          .map(pick)
          .filter(Boolean)
          .join("  ");
        summary =
          `count=${j?.count ?? "?"}\n${destaque}\n\n` +
          `campos: ${first ? Object.keys(first).join(", ") : "(sem itens)"}`;
      }
      blocks.push(
        `<div class="row"><div class="ep">${r.status === 200 ? "\u2713" : "\u2717"} ${p.label} (HTTP ${r.status})</div>
         <pre>${summary.replace(/</g, "&lt;")}</pre></div>`
      );
    } catch (e) {
      blocks.push(
        `<div class="row"><div class="ep">\u2717 ${p.label}</div>
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
