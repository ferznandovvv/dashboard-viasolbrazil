import { NextRequest, NextResponse } from "next/server";
import { LOJAS, type TotvsInvoice, fetchTotvsSales, isDevolucao, isVenda, totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";
import { type SwaggerDoc, contrato } from "@/lib/swagger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const INV = "/api/totvsmoda/fiscal/v2/invoices/search";
/** Módulos da TOTVS onde uma venda sem nota fiscal pode aparecer */
const MODULOS = ["sale-panel", "sales-order", "analytics", "accounts-receivable", "financial", "movement", "general", "retail", "pdv"];
const CAMINHO_DE_VENDA = /sale|order|transac|movement|moviment|total|panel|receivable|document/i;

type Nota = TotvsInvoice & Record<string, unknown>;

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (n: Nota) => (n.invoiceDate ?? "").slice(0, 10);
const somar = (l: Nota[], sinal = 1) => l.reduce((s, n) => s + sinal * Number(n.totalValue ?? 0), 0);
/** Código da operação, se a API mandar (o nome do campo varia) */
const codigoOp = (n: Nota) => n.operationCode ?? n.operatioCode ?? n.operationId ?? "";

/** Por que a nota de saída não entrou como venda no painel. */
function motivo(n: Nota): string {
  if (n.invoiceStatus !== "Issued") return `situação ${n.invoiceStatus}`;
  const op = n.operatioName ?? "";
  if (!/VENDA/i.test(op)) return "o nome da operação não tem VENDA";
  const m = /DEVOL|TRANSF|REMESSA|BONIFIC|BRINDE|COMODATO|AMOSTRA/i.exec(op);
  return m ? `o nome da operação tem "${m[0]}"` : "?";
}

/** Todas as notas de saída ou de entrada da filial alteradas na janela. */
async function notas(filial: number, tipo: "Output" | "Input", de: string, ate: string): Promise<Nota[]> {
  const corpo = (page: number) => ({
    filter: { branchCodeList: [filial], operationType: tipo, change: { startDate: `${de}T00:00:00`, endDate: `${ate}T23:59:59` } },
    page,
    pageSize: 100,
  });
  const primeira = await totvsFetch(INV, corpo(1));
  if (primeira.status !== 200) throw new Error(`Notas (${tipo}): HTTP ${primeira.status} — ${primeira.text.slice(0, 200)}`);
  const lista = [...((primeira.json?.items as Nota[] | undefined) ?? [])];
  const paginas = Math.min(Math.ceil(Number(primeira.json?.count ?? 0) / 100), 80);
  for (let ini = 2; ini <= paginas; ini += 8) {
    const lote = [];
    for (let p = ini; p < ini + 8 && p <= paginas; p++) lote.push(totvsFetch(INV, corpo(p)));
    for (const r of await Promise.all(lote)) lista.push(...((r.json?.items as Nota[] | undefined) ?? []));
  }
  return lista;
}

/** O que cada módulo da TOTVS oferece (pelo Swagger): onde procurar a venda sem nota. */
async function modulos(): Promise<string> {
  const partes = await Promise.all(
    MODULOS.map(async (m) => {
      const caminho = `/api/totvsmoda/${m}/v2/swagger/v1/swagger.json`;
      try {
        const r = await totvsFetch(caminho);
        if (r.status !== 200) return `<p><b>${m}</b>: não disponível (HTTP ${r.status})</p>`;
        const doc = JSON.parse(r.text) as SwaggerDoc;
        const caminhos = Object.keys(doc.paths ?? {});
        const interessantes = caminhos.filter((c) => CAMINHO_DE_VENDA.test(c)).slice(0, 8);
        return `<p><b>${m}</b>: ✓ ${caminhos.length} endereços</p><pre>${esc(caminhos.join("\n"))}</pre>${
          interessantes.length ? `<details><summary>Filtros dos que parecem de venda</summary><pre>${esc(interessantes.map((c) => contrato(doc, c)).join("\n\n"))}</pre></details>` : ""
        }`;
      } catch (e) {
        return `<p><b>${m}</b>: erro (${esc(e instanceof Error ? e.message : "?")})</p>`;
      }
    })
  );
  return partes.join("");
}

/**
 * Conferência de um mês de uma loja contra a TOTVS: busca as notas direto
 * (sem cache), mostra o que o painel conta, o que fica de fora e por quê, dia
 * a dia; e lista os módulos da TOTVS onde procurar as vendas sem nota fiscal.
 * Só o dono abre (rota de API fora da lista de áreas).
 */
export async function GET(req: NextRequest) {
  if (!totvsConfigured()) return NextResponse.json({ erro: "TOTVS não configurada" }, { status: 400 });
  const sp = req.nextUrl.searchParams;
  const nomeLoja = sp.get("loja") ?? "Centro";
  const filial = Number(Object.entries(LOJAS).find(([, n]) => n === nomeLoja)?.[0] ?? 0);
  if (!filial) return NextResponse.json({ erro: `Loja não encontrada. Use uma destas: ${Object.values(LOJAS).join(", ")}` }, { status: 400 });
  const hoje = new Date().toISOString().slice(0, 10);
  const mes = /^\d{4}-\d{2}$/.test(sp.get("mes") ?? "") ? sp.get("mes")! : hoje.slice(0, 7);
  const [a, m] = mes.split("-").map(Number);
  const inicio = `${mes}-01`;
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const limite = new Date(Date.UTC(a, m - 1, 1) + 92 * 86400000).toISOString().slice(0, 10);
  const ate = limite > hoje ? hoje : limite;

  let corpo: string;
  try {
    const [saidas, entradas, painel, mods] = await Promise.all([
      notas(filial, "Output", inicio, ate),
      notas(filial, "Input", inicio, ate),
      fetchTotvsSales(inicio, fim > hoje ? hoje : fim),
      modulos(),
    ]);
    const doMes = (l: Nota[]) => l.filter((n) => dia(n) >= inicio && dia(n) <= fim);
    const s = doMes(saidas);
    const vendas = s.filter(isVenda);
    const foraSaida = s.filter((n) => !isVenda(n));
    const devolucoes = doMes(entradas).filter(isDevolucao);
    const devolucoesFora = doMes(entradas).filter((n) => !isDevolucao(n) && /DEVOLU|\bVENDA/i.test(n.operatioName ?? ""));
    const liquido = somar(vendas) - somar(devolucoes);
    const noPainel = painel.orders.filter((o) => o.store === nomeLoja).reduce((t, o) => t + o.total, 0);

    // Dia a dia
    const dias = Array.from(new Set([...vendas, ...devolucoes, ...foraSaida].map(dia))).sort();
    const linhasDia = dias
      .map((d) => {
        const v = somar(vendas.filter((n) => dia(n) === d));
        const dv = somar(devolucoes.filter((n) => dia(n) === d));
        const f = foraSaida.filter((n) => dia(n) === d);
        return `<tr><td>${d.split("-").reverse().join("/")}</td><td class="n">${brl(v)}</td><td class="n">${dv ? `−${brl(dv)}` : ""}</td><td class="n"><b>${brl(v - dv)}</b></td><td class="n">${f.length ? `${f.length} · ${brl(somar(f))}` : ""}</td></tr>`;
      })
      .join("");

    // Saídas que não contaram, por operação
    const grupos = new Map<string, { cod: unknown; nome: string; motivo: string; n: number; valor: number }>();
    for (const n of foraSaida) {
      const k = `${codigoOp(n)}|${n.operatioName}|${motivo(n)}`;
      const g = grupos.get(k) ?? { cod: codigoOp(n), nome: n.operatioName ?? "", motivo: motivo(n), n: 0, valor: 0 };
      g.n += 1;
      g.valor += Number(n.totalValue ?? 0);
      grupos.set(k, g);
    }
    const linhasGrupo = Array.from(grupos.values())
      .sort((x, y) => y.valor - x.valor)
      .map((g) => `<tr><td>${esc(g.cod)}</td><td>${esc(g.nome)}</td><td>${esc(g.motivo)}</td><td class="n">${g.n}</td><td class="n">${brl(g.valor)}</td></tr>`)
      .join("");
    const linhaNota = (n: Nota, sinal = 1) =>
      `<tr><td>${dia(n).split("-").reverse().join("/")}</td><td>${esc(n.invoiceCode ?? n.invoiceSequence)}</td><td>${esc(n.personName)}</td><td>${esc(codigoOp(n))} ${esc(n.operatioName)}</td><td>${esc(n.invoiceStatus)}</td><td class="n">${sinal < 0 ? "−" : ""}${brl(Number(n.totalValue ?? 0))}</td></tr>`;
    const amostra = foraSaida[0] ?? s[0];

    corpo = `
<p>${esc(nomeLoja)}, ${String(m).padStart(2, "0")}/${a}. Notas buscadas agora direto na TOTVS (alteradas até ${ate.split("-").reverse().join("/")}).</p>
<table class="tot">
<tr><td>Vendas com nota fiscal (${vendas.length} notas)</td><td class="n">${brl(somar(vendas))}</td></tr>
<tr><td>Devoluções (${devolucoes.length} notas)</td><td class="n">−${brl(somar(devolucoes))}</td></tr>
<tr><td><b>Pela regra do painel</b></td><td class="n"><b>${brl(liquido)}</b></td></tr>
<tr><td>O que o painel mostra hoje (com o que está guardado)</td><td class="n">${brl(noPainel)}</td></tr>
</table>
<p class="obs">Venda sem nota fiscal não aparece em nenhuma linha acima: a busca do painel é de notas fiscais. Se o relatório da TOTVS der mais, a diferença está em transações sem nota.</p>
<h2>Dia a dia</h2>
<table><tr><th>Dia</th><th class="n">Vendas</th><th class="n">Devoluções</th><th class="n">Painel</th><th class="n">Notas de saída fora</th></tr>${linhasDia}</table>
<h2>Notas de saída que o painel não conta</h2>
${linhasGrupo ? `<table><tr><th>Cód.</th><th>Operação</th><th>Por que ficou fora</th><th class="n">Notas</th><th class="n">Valor</th></tr>${linhasGrupo}</table>
<details><summary>Ver as ${foraSaida.length} notas</summary><table>${foraSaida.map((n) => linhaNota(n)).join("")}</table></details>` : "<p>Nenhuma: toda nota de saída emitida do mês entrou como venda.</p>"}
<h2>Devoluções que o painel desconta</h2>
<table>${devolucoes.map((n) => linhaNota(n, -1)).join("") || "<tr><td>Nenhuma</td></tr>"}</table>
${devolucoesFora.length ? `<h2>Notas de entrada com DEVOL ou VENDA que não contaram</h2><table>${devolucoesFora.map((n) => linhaNota(n)).join("")}</table>` : ""}
<h2>Onde procurar as vendas sem nota fiscal</h2>
<p class="obs">O que a TOTVS de vocês oferece além das notas fiscais. Manda um print desta parte que eu vejo de onde puxar.</p>
${mods}
<details><summary>Campos que vêm numa nota</summary><pre>${esc(amostra ? Object.keys(amostra).join(", ") : "(nenhuma nota)")}</pre></details>`;
  } catch (e) {
    corpo = `<p class="erro">${esc(e instanceof Error ? e.message : "erro")}</p>`;
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Conferir com a TOTVS</title><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:20px 12px;max-width:860px;margin:0 auto}
h1{font-size:18px;margin:0 0 6px}h2{font-size:14px;margin:22px 0 6px;color:#9a4510}
p{font-size:13px;color:#3d3c39;margin:4px 0}.obs{color:#52514e}.erro{color:#b42318;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:left;color:#52514e;font-weight:600;border-bottom:1px solid #bbb;padding:4px 6px}
td{padding:4px 6px;border-bottom:1px solid #e1e0d9;vertical-align:top}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
table.tot{max-width:520px;font-size:13.5px}pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:8px;font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto}
summary{cursor:pointer;color:#9a4510;font-weight:600;font-size:13px;margin:6px 0}
</style></head><body><h1>Conferir vendas com a TOTVS</h1>
<p class="obs">Outra loja ou mês: troque no endereço, por exemplo <code>?loja=Fiusa&amp;mes=2026-10</code>.</p>
${corpo}</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
