import { NextResponse } from "next/server";
import { LOJAS, totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SWAGGER = "/api/totvsmoda/product/v2/swagger/v1/swagger.json";
const BALANCES = "/api/totvsmoda/product/v2/balances/search";

type Esquema = {
  $ref?: string;
  type?: string;
  items?: Esquema;
  properties?: Record<string, Esquema>;
  required?: string[];
};
type Doc = {
  paths?: Record<string, Record<string, { requestBody?: { content?: Record<string, { schema?: Esquema }> } }>>;
  components?: { schemas?: Record<string, Esquema> };
};

/** Descreve um schema resolvendo os $ref, em texto indentado. */
function descrever(doc: Doc, s: Esquema | undefined, nivel = 0, vistos = new Set<string>()): string {
  if (!s || nivel > 3) return "";
  if (s.$ref) {
    const nome = s.$ref.split("/").pop() ?? "";
    if (vistos.has(nome)) return `${"  ".repeat(nivel)}(→ ${nome})`;
    vistos.add(nome);
    return descrever(doc, doc.components?.schemas?.[nome], nivel, vistos);
  }
  if (s.type === "array") return descrever(doc, s.items, nivel, vistos);
  if (!s.properties) return `${"  ".repeat(nivel)}(${s.type ?? "?"})`;
  const obrig = new Set(s.required ?? []);
  return Object.entries(s.properties)
    .map(([nome, prop]) => {
      const tipo = prop.$ref ? "objeto" : prop.type === "array" ? "lista" : prop.type ?? "?";
      const linha = `${"  ".repeat(nivel + 1)}${nome}: ${tipo}${obrig.has(nome) ? "  *obrigatório*" : ""}`;
      const filhos = prop.$ref || prop.type === "array" ? descrever(doc, prop, nivel + 1, new Set(vistos)) : "";
      return filhos ? `${linha}\n${filhos}` : linha;
    })
    .join("\n");
}

/** Contrato e amostra real do saldo de estoque, para montar a aba de produtos. */
export async function GET() {
  if (!totvsConfigured()) return NextResponse.json({ erro: "TOTVS não configurada" }, { status: 400 });

  const partes: string[] = [];

  try {
    const r = await totvsFetch(SWAGGER);
    const doc = JSON.parse(r.text) as Doc;
    const op = doc.paths?.[BALANCES] ?? {};
    const verbo = Object.keys(op)[0];
    const req = op[verbo]?.requestBody?.content?.["application/json"]?.schema;
    partes.push(`${verbo?.toUpperCase()} ${BALANCES}\nFILTROS ACEITOS:\n${descrever(doc, req) || "(sem corpo)"}`);
  } catch (e) {
    partes.push(`contrato falhou: ${e instanceof Error ? e.message : "erro"}`);
  }

  // Tentativas de chamada real, das mais prováveis às alternativas
  const filiais = Object.keys(LOJAS).map(Number);
  const hoje = new Date().toISOString().slice(0, 10);
  const tentativas: { rotulo: string; corpo: unknown }[] = [
    { rotulo: "branchCodeList + page", corpo: { filter: { branchCodeList: filiais }, page: 1, pageSize: 5 } },
    {
      rotulo: "branchCodeList + hasStock",
      corpo: { filter: { branchCodeList: filiais, hasStock: true }, page: 1, pageSize: 5 },
    },
    {
      rotulo: "com change (alteração)",
      corpo: {
        filter: {
          branchCodeList: filiais,
          change: { startDate: `${hoje}T00:00:00`, endDate: `${hoje}T23:59:59` },
        },
        page: 1,
        pageSize: 5,
      },
    },
  ];

  for (const t of tentativas) {
    try {
      const r = await totvsFetch(BALANCES, t.corpo);
      if (r.status !== 200) {
        partes.push(`✗ ${t.rotulo} (HTTP ${r.status})\n  ${(r.json ? JSON.stringify(r.json) : r.text).slice(0, 300)}`);
        continue;
      }
      const j = r.json as { count?: number; items?: Record<string, unknown>[] } | null;
      const primeiro = j?.items?.[0];
      partes.push(
        `✓ ${t.rotulo} — count=${j?.count ?? "?"}\n` +
          `  campos: ${primeiro ? Object.keys(primeiro).join(", ") : "(sem itens)"}\n` +
          `  exemplo: ${JSON.stringify(primeiro ?? {}).slice(0, 600)}`
      );
      break; // a primeira que funcionar já basta
    } catch (e) {
      partes.push(`✗ ${t.rotulo}: ${e instanceof Error ? e.message.slice(0, 120) : "erro"}`);
    }
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Saldo de estoque</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:22px 12px;max-width:760px;margin:0 auto}
h1{font-size:17px;margin:0 0 10px}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:12px;font-size:11.5px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>Saldo de estoque — contrato e amostra</h1>
<pre>${partes.join("\n\n").replace(/</g, "&lt;")}</pre></body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
