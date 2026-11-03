import { NextRequest, NextResponse } from "next/server";
import { hojeSp, lerBase, somarDias } from "@/lib/crm/base";
import { resumoSiteMes } from "@/lib/crm/ecommerce";
import { cashbackDoMes, voltaramPorLoja } from "@/lib/crm/resumoMes";
import { listarCampanhas } from "@/lib/crm/campanhas";
import { resumoIndicacoes } from "@/lib/crm/indicacao";
import { CAMPANHAS_SITE, type TipoCampanha } from "@/lib/crm/tipos";

export const dynamic = "force-dynamic";

/** Último dia do mês "AAAA-MM" */
const ultimoDia = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return somarDias(`${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
};

/**
 * Resultado do CRM num mês (?mes=AAAA-MM; sem mês, o atual): cashback das
 * lojas, clientes que voltaram, site, retorno das mensagens e indicações.
 */
export async function GET(req: NextRequest) {
  const base = await lerBase();
  const hojeReal = hojeSp();
  const atual = hojeReal.slice(0, 7);
  const pedido = req.nextUrl.searchParams.get("mes") ?? "";
  const mes = /^\d{4}-\d{2}$/.test(pedido) && pedido <= atual ? pedido : atual;
  const hoje = mes === atual ? hojeReal : ultimoDia(mes);
  const desde = new Date(`${mes}-01T00:00:00-03:00`).toISOString();
  const ate = new Date(`${somarDias(hoje, 1)}T00:00:00-03:00`).toISOString();

  // Meses com dado: do primeiro movimento do CRM até agora
  const primeiro = [base.cashback[0]?.criadoEm, base.mensagens[0]?.criadoEm, base.vendas.filter((v) => v.clienteId).map((v) => v.data).sort()[0]]
    .filter(Boolean)
    .sort()[0];
  const meses: string[] = [];
  let m = (primeiro ?? hojeReal).slice(0, 7);
  if (m < "2026-01") m = "2026-01";
  while (m <= atual) {
    meses.push(m);
    const [a, n] = m.split("-").map(Number);
    m = `${n === 12 ? a + 1 : a}-${String(n === 12 ? 1 : n + 1).padStart(2, "0")}`;
  }

  const c = listarCampanhas(base, { desde, ate });
  return NextResponse.json({
    mes,
    atual: mes === atual,
    meses,
    cashbackMes: cashbackDoMes(base, hoje),
    voltaram: voltaramPorLoja(base, hoje),
    siteMes: resumoSiteMes(base, hoje),
    indicacoes: resumoIndicacoes(base, hoje),
    // Retorno das mensagens das lojas no mês (carrinho e Pix ficam no quadro do site)
    retorno: [
      ...c.automaticas.filter((a) => !CAMPANHAS_SITE.includes(a.id as TipoCampanha)).map((a) => ({ id: a.id, nome: a.nome, manual: false, r: a.resultado })),
      ...c.manuais.filter((x) => x.criadaEm >= desde && x.criadaEm < ate).map((x) => ({ id: x.id, nome: x.nome, manual: true, r: x.resultado })),
    ].filter((x) => x.r.total > 0),
  });
}
