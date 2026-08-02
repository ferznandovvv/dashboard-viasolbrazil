import { NextResponse } from "next/server";
import { LOJAS, totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INV = "/api/totvsmoda/fiscal/v2/invoices/search";
const MESES = 6;

interface Nota {
  branchCode: number;
  invoiceDate: string;
  invoiceStatus: string;
  operatioName: string;
  totalValue: number;
  sellerCpf: string | null;
  terminalCode: number | null;
  userCode: number | null;
  documentType: number | null;
  inclusionComponentCode: string | null;
  versionPdv: string | null;
  mobileVersion: string | null;
}

/** Só as vendas que o dashboard conta, para o diagnóstico bater com o ranking. */
function isVenda(n: Nota): boolean {
  if (n.invoiceStatus !== "Issued") return false;
  const op = n.operatioName ?? "";
  if (!/VENDA/i.test(op)) return false;
  return !/DEVOL|TRANSF|REMESSA|BONIFIC|BRINDE|COMODATO|AMOSTRA/i.test(op);
}

function tabela(titulo: string, linhas: string[][]): string {
  const corpo = linhas
    .map((l) => `<tr>${l.map((c, i) => `<td${i ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<h2>${titulo}</h2><table>${corpo}</table>`;
}

/** Distribuição de um campo, separando notas com e sem vendedora. */
function cruzamento(notas: Nota[], campo: keyof Nota, titulo: string): string {
  const m = new Map<string, { com: number; sem: number }>();
  for (const n of notas) {
    const k = String(n[campo] ?? "—");
    const e = m.get(k) ?? { com: 0, sem: 0 };
    if (n.sellerCpf) e.com += 1;
    else e.sem += 1;
    m.set(k, e);
  }
  const linhas = Array.from(m.entries())
    .sort((a, b) => b[1].com + b[1].sem - (a[1].com + a[1].sem))
    .slice(0, 10)
    .map(([k, v]) => {
      const total = v.com + v.sem;
      const pct = Math.round((v.com / total) * 100);
      return [
        k.length > 34 ? `${k.slice(0, 34)}…` : k,
        String(total),
        `${pct}%`,
        pct === 100 ? "✓ sempre" : pct === 0 ? "✗ nunca" : "~ às vezes",
      ];
    });
  return tabela(`${titulo} — % com vendedora`, [
    ["valor", "notas", "com vend.", ""],
    ...linhas,
  ]);
}

export async function GET() {
  if (!totvsConfigured()) {
    return NextResponse.json({ erro: "TOTVS não configurada" }, { status: 400 });
  }

  const hoje = new Date();
  const desde = new Date(hoje.getTime() - MESES * 30 * 86400000);
  const filiais = Object.keys(LOJAS).map(Number);
  const notas: Nota[] = [];
  let aviso = "";

  try {
    // A API limita a janela de alteração a ~6 meses, então dividimos em duas
    const janelas: { a: Date; b: Date }[] = [];
    let cursor = new Date(desde);
    while (cursor < hoje) {
      const fim = new Date(Math.min(cursor.getTime() + 100 * 86400000, hoje.getTime()));
      janelas.push({ a: new Date(cursor), b: fim });
      cursor = new Date(fim.getTime() + 86400000);
    }

    for (const j of janelas) {
      const corpo = (pagina: number) => ({
        filter: {
          branchCodeList: filiais,
          operationType: "Output",
          change: {
            startDate: `${j.a.toISOString().slice(0, 10)}T00:00:00`,
            endDate: `${j.b.toISOString().slice(0, 10)}T23:59:59`,
          },
        },
        page: pagina,
        pageSize: 100,
      });
      const primeira = await totvsFetch(INV, corpo(1));
      notas.push(...((primeira.json?.items as Nota[] | undefined) ?? []));
      const paginas = Math.min(Math.ceil(Number(primeira.json?.count ?? 0) / 100), 40);
      for (let inicio = 2; inicio <= paginas; inicio += 8) {
        const lote = [];
        for (let p = inicio; p < inicio + 8 && p <= paginas; p++) lote.push(totvsFetch(INV, corpo(p)));
        for (const r of await Promise.all(lote)) {
          notas.push(...((r.json?.items as Nota[] | undefined) ?? []));
        }
      }
      if (paginas >= 40) aviso = "Amostra limitada a 4.000 notas por janela.";
    }
  } catch (e) {
    aviso = e instanceof Error ? e.message : "erro na busca";
  }

  const vendas = notas.filter(isVenda);

  // Por loja: quanto de cada uma tem vendedora
  const porLoja = new Map<number, { com: number; sem: number; valorSem: number }>();
  for (const n of vendas) {
    const e = porLoja.get(n.branchCode) ?? { com: 0, sem: 0, valorSem: 0 };
    if (n.sellerCpf) e.com += 1;
    else {
      e.sem += 1;
      e.valorSem += Number(n.totalValue ?? 0);
    }
    porLoja.set(n.branchCode, e);
  }
  const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  const linhasLoja = Array.from(porLoja.entries())
    .sort((a, b) => b[1].sem - a[1].sem)
    .map(([f, v]) => {
      const total = v.com + v.sem;
      return [
        LOJAS[f] ?? `Filial ${f}`,
        String(total),
        `${Math.round((v.com / total) * 100)}%`,
        brl(v.valorSem),
      ];
    });

  // Por mês: mostra se o preenchimento mudou em alguma data
  const porMes = new Map<string, { com: number; sem: number }>();
  for (const n of vendas) {
    const k = (n.invoiceDate ?? "").slice(0, 7);
    if (!k) continue;
    const e = porMes.get(k) ?? { com: 0, sem: 0 };
    if (n.sellerCpf) e.com += 1;
    else e.sem += 1;
    porMes.set(k, e);
  }
  const linhasMes = Array.from(porMes.entries())
    .sort()
    .map(([k, v]) => [
      k,
      String(v.com + v.sem),
      `${Math.round((v.com / (v.com + v.sem)) * 100)}%`,
      "",
    ]);

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Quem não registra a vendedora</title><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:20px 12px;max-width:720px;margin:0 auto}
h1{font-size:17px;margin:0 0 4px}h2{font-size:13px;margin:20px 0 6px;color:#bc5714}
p{font-size:13px;color:#52514e;margin:4px 0}
table{width:100%;border-collapse:collapse;font-size:12px}
td{padding:4px 6px;border-bottom:1px solid #e1e0d9}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr:first-child td{font-weight:600;color:#52514e;border-bottom:1px solid #bbb}
</style></head><body>
<h1>Quem não registra a vendedora</h1>
<p>${vendas.length} vendas analisadas nos últimos ${MESES} meses.
${aviso ? `<b>${aviso}</b>` : ""}</p>
${tabela("Por loja", [["loja", "vendas", "com vend.", "R$ sem dono"], ...linhasLoja])}
${tabela("Por mês", [["mês", "vendas", "com vend.", ""], ...linhasMes])}
${cruzamento(vendas, "terminalCode", "Terminal do caixa")}
${cruzamento(vendas, "userCode", "Usuário do PDV")}
${cruzamento(vendas, "operatioName", "Operação")}
${cruzamento(vendas, "inclusionComponentCode", "Componente que gerou")}
${cruzamento(vendas, "versionPdv", "Versão do PDV")}
</body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
