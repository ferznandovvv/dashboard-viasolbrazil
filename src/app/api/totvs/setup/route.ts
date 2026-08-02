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

type Esquema = {
  $ref?: string;
  type?: string;
  format?: string;
  items?: Esquema;
  properties?: Record<string, Esquema>;
  required?: string[];
};
type Operacao = {
  requestBody?: { content?: Record<string, { schema?: Esquema }> };
  responses?: Record<string, { content?: Record<string, { schema?: Esquema }> }>;
};
type SwaggerDoc = {
  paths?: Record<string, Record<string, Operacao>>;
  components?: { schemas?: Record<string, Esquema> };
  definitions?: Record<string, Esquema>;
};

/** Descreve um schema do Swagger em texto indentado, resolvendo os $ref. */
function descrever(doc: SwaggerDoc, s: Esquema | undefined, nivel = 0, vistos: Set<string> = new Set()): string {
  if (!s || nivel > 3) return "";
  if (s.$ref) {
    const nome = s.$ref.split("/").pop() ?? "";
    if (vistos.has(nome)) return `${"  ".repeat(nivel)}(→ ${nome}, recursivo)`;
    vistos.add(nome);
    const alvo = doc.components?.schemas?.[nome] ?? doc.definitions?.[nome];
    return descrever(doc, alvo, nivel, vistos);
  }
  if (s.type === "array") return descrever(doc, s.items, nivel, vistos);
  if (!s.properties) return `${"  ".repeat(nivel)}(${s.type ?? "?"})`;
  const obrigatorios = new Set(s.required ?? []);
  return Object.entries(s.properties)
    .map(([nome, prop]) => {
      const tipo = prop.$ref ? "objeto" : prop.type === "array" ? "lista" : (prop.type ?? "?");
      const linha = `${"  ".repeat(nivel + 1)}${nome}: ${tipo}${obrigatorios.has(nome) ? "  *obrigatório*" : ""}`;
      const filhos = prop.$ref || prop.type === "array" ? descrever(doc, prop, nivel + 1, new Set(vistos)) : "";
      return filhos ? `${linha}\n${filhos}` : linha;
    })
    .join("\n");
}

/** Corpo aceito por um caminho do Swagger, em texto. */
function contrato(doc: SwaggerDoc, caminho: string): string {
  const ops = doc.paths?.[caminho];
  if (!ops) return `${caminho}\n  (não existe neste swagger)`;
  const verbo = Object.keys(ops)[0];
  const req = ops[verbo].requestBody?.content?.["application/json"]?.schema;
  return `${verbo.toUpperCase()} ${caminho}\nFILTROS ACEITOS:\n${descrever(doc, req) || "  (sem corpo)"}`;
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
  const TODAS_FILIAIS = [1, 2, 3, 5, 6, 7, 8, 9];
  const INV = "/api/totvsmoda/fiscal/v2/invoices/search";
  const range = { startDate: `${monthAgo}T00:00:00`, endDate: `${today}T23:59:59` };
  const probes: {
    label: string;
    path: string;
    body?: unknown;
    raw?: boolean;
    nomes?: boolean;
    /** Swagger a ler: mostra o contrato dos caminhos indicados e varre por vendedor */
    schemaDe?: { caminhos: string[]; varrer?: boolean };
  }[] = [
    {
      label: "Contrato — filtro do invoices/search",
      path: "/api/totvsmoda/fiscal/v2/swagger/v1/swagger.json",
      schemaDe: { caminhos: [INV], varrer: true },
    },
    {
      label: "Varredura de vendedor — sales-order",
      path: "/api/totvsmoda/sales-order/v2/swagger/v1/swagger.json",
      schemaDe: { caminhos: [], varrer: true },
    },
    {
      label: "Vendedoras cadastradas (todas as lojas)",
      path: "/api/totvsmoda/seller/v2/search",
      body: { filter: { branchCodeList: TODAS_FILIAIS }, page: 1, pageSize: 100 },
      nomes: true,
    },
    {
      label: "Campos que a nota realmente devolve",
      path: INV,
      body: {
        filter: { branchCodeList: branches, operationType: "Output", change: range },
        page: 1,
        pageSize: 1,
      },
    },
  ];

  /**
   * Pergunta decisiva: a venda das lojas grava a vendedora?
   * Varre notas das 8 filiais e conta quantas trazem cada campo candidato
   * preenchido — se todos vierem vazios, o dado não existe na origem.
   */
  const amostra: Record<string, unknown>[] = [];
  let amostraErro = "";
  try {
    const desde = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const paginas = await Promise.all(
      [1, 2, 3, 4].map((pagina) =>
        totvsFetch(INV, {
          filter: {
            branchCodeList: TODAS_FILIAIS,
            operationType: "Output",
            change: { startDate: `${desde}T00:00:00`, endDate: `${today}T23:59:59` },
          },
          page: pagina,
          pageSize: 100,
        })
      )
    );
    for (const r of paginas) {
      amostra.push(...((r.json?.items as Record<string, unknown>[] | undefined) ?? []));
    }
  } catch (e) {
    amostraErro = e instanceof Error ? e.message : "erro";
  }

  /** Quantas notas têm o campo preenchido, e com quantos valores distintos. */
  const preenchimento = (campo: string) => {
    const valores = new Map<string, number>();
    let cheios = 0;
    for (const it of amostra) {
      const v = it[campo];
      if (v === null || v === undefined || v === "") continue;
      cheios += 1;
      const k = String(v);
      valores.set(k, (valores.get(k) ?? 0) + 1);
    }
    const amostraValores = Array.from(valores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => `${k}(${n}×)`)
      .join(" ");
    return `  ${campo.padEnd(20)} ${String(cheios).padStart(4)}/${amostra.length} preenchidos, ${
      valores.size
    } valores distintos${amostraValores ? `: ${amostraValores}` : ""}`;
  };

  const resumoAmostra = amostraErro
    ? `erro: ${amostraErro}`
    : `${amostra.length} notas de saída, todas as 8 lojas, últimos 60 dias\n\n` +
      ["sellerCpf", "userCode", "terminalCode", "personCode"].map(preenchimento).join("\n");

  const blocks: string[] = [
    `<div class="row"><div class="ep">★ A VENDA GRAVA A VENDEDORA?</div><pre>${resumoAmostra.replace(
      /</g,
      "&lt;"
    )}</pre></div>`,
  ];
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
      } else if (p.schemaDe) {
        try {
          const doc = JSON.parse(r.text) as SwaggerDoc;
          const partes = p.schemaDe.caminhos.map((c) => contrato(doc, c));
          if (p.schemaDe.varrer) {
            // Todo nome de campo do swagger que cite vendedor/comissão
            const achados = new Set<string>();
            for (const m of r.text.matchAll(/"([A-Za-z]*(?:seller|Seller|comission|Comission|comiss|salesman|Salesman)[A-Za-z]*)"\s*:/g)) {
              achados.add(m[1]);
            }
            partes.push(
              achados.size
                ? `CAMPOS COM VENDEDOR/COMISSÃO:\n  ${Array.from(achados).sort().join("\n  ")}`
                : "CAMPOS COM VENDEDOR/COMISSÃO: nenhum"
            );
          }
          summary = partes.join("\n\n");
        } catch {
          summary = `não é JSON (${r.text.length} bytes): ${r.text.slice(0, 200)}`;
        }
      } else if (p.nomes) {
        const itens =
          (j?.items as
            | {
                sellerCode?: number;
                sellerName?: string;
                personCode?: number;
                personName?: string;
                branchInformations?: { branchCode?: number; auxiliaryCode?: number; isInactive?: boolean }[];
              }[]
            | undefined) ?? [];
        summary =
          `count=${j?.count ?? "?"}  totalItems=${j?.totalItems ?? "?"}\n` +
          itens
            .map((x) => {
              const filiais = (x.branchInformations ?? [])
                .map((b) => `f${b.branchCode}${b.auxiliaryCode ? `/aux${b.auxiliaryCode}` : ""}${b.isInactive ? " (inativo)" : ""}`)
                .join(" ");
              return `  cod ${String(x.sellerCode ?? "?").padStart(5)}  pessoa ${String(
                x.personCode ?? "?"
              ).padStart(10)}  ${(x.sellerName ?? x.personName ?? "").padEnd(28)} ${filiais}`;
            })
            .join("\n");
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
