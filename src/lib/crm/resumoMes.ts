/**
 * Números do mês para a tela principal do CRM: o dinheiro do cashback
 * (creditado, usado e o que vence) e as clientes que voltaram a comprar.
 */

import { LOJAS } from "@/lib/connectors/totvs";
import { hojeSp, somarDias } from "./base";
import { vencendoAte } from "./cashback";
import { contaComoCompra, valorLiquido, type BaseCrm } from "./tipos";

const arred = (v: number) => Math.round(v);

export interface CashbackMes {
  mes: string;
  creditado: number;
  creditos: number;
  usado: number;
  resgates: number;
  /** Valor das compras em que ela usou (venda dela no mesmo dia, na mesma loja) */
  comprasComCashback: number;
  /** Vence nos próximos 10 dias, sem ter sido usado */
  vencendo10d: number;
  clientesVencendo: number;
  expirado: number;
}

export function cashbackDoMes(b: BaseCrm, hoje = hojeSp()): CashbackMes {
  const inicio = `${hoje.slice(0, 7)}-01`;
  const desdeIso = new Date(`${inicio}T00:00:00-03:00`).toISOString();
  let creditado = 0;
  let creditos = 0;
  let usado = 0;
  let resgates = 0;
  let expirado = 0;
  let compras = 0;
  const vendasDoDia = new Map<string, number>();
  for (const v of b.vendas) {
    if (!v.clienteId || v.data.slice(0, 10) < inicio || !contaComoCompra(v)) continue;
    const k = `${v.clienteId}|${v.data.slice(0, 10)}|${v.loja}`;
    vendasDoDia.set(k, (vendasDoDia.get(k) ?? 0) + valorLiquido(v));
  }
  const contadas = new Set<string>();
  for (const m of b.cashback) {
    if (m.criadoEm < desdeIso) continue;
    if (m.tipo === "credito") {
      creditado += m.valor;
      creditos++;
    } else if (m.tipo === "resgate") {
      usado += -m.valor;
      resgates++;
      const dia = new Date(new Date(m.criadoEm).getTime() - 3 * 3600000).toISOString().slice(0, 10);
      const k = `${m.clienteId}|${dia}|${m.loja}`;
      if (!contadas.has(k)) {
        contadas.add(k);
        compras += vendasDoDia.get(k) ?? 0;
      }
    } else if (m.tipo === "expiracao") expirado += -m.valor;
  }
  const ate = somarDias(hoje, 10);
  let vencendo = 0;
  let clientesVencendo = 0;
  for (const id of new Set(b.cashback.map((m) => m.clienteId))) {
    const v = vencendoAte(b, id, ate, hoje).valor;
    if (v > 0) {
      vencendo += v;
      clientesVencendo++;
    }
  }
  return {
    mes: inicio,
    creditado: arred(creditado),
    creditos,
    usado: arred(usado),
    resgates,
    comprasComCashback: arred(compras),
    vencendo10d: arred(vencendo),
    clientesVencendo,
    expirado: arred(expirado),
  };
}

export interface VoltaramLoja {
  loja: string;
  /** Clientes (identificadas) que compraram no mês */
  compradoras: number;
  /** Delas, quantas já tinham comprado antes do mês (em qualquer loja ou no site) */
  voltaram: number;
  pct: number | null;
  /** Primeira compra da vida no mês */
  novas: number;
  /** Mesmo % no mês passado, até o mesmo dia */
  pctAnterior: number | null;
}

/** Clientes que voltaram a comprar no mês, por loja (o número que mostra se o CRM está funcionando). */
export function voltaramPorLoja(b: BaseCrm, hoje = hojeSp()): { lojas: VoltaramLoja[]; total: Omit<VoltaramLoja, "loja"> } {
  const inicio = `${hoje.slice(0, 7)}-01`;
  const [a, m] = hoje.split("-").map(Number);
  const inicioAnt = `${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`;
  const fimAnt = somarDias(inicioAnt, Number(hoje.slice(8, 10)) - 1);
  const primeira = new Map<string, string>();
  const compras = b.vendas.filter((v) => v.clienteId && contaComoCompra(v));
  for (const v of compras) {
    const d = v.data.slice(0, 10);
    const p = primeira.get(v.clienteId!);
    if (!p || d < p) primeira.set(v.clienteId!, d);
  }
  const conta = (de: string, ate: string) => {
    const porLoja = new Map<string, Map<string, boolean>>();
    for (const v of compras) {
      const d = v.data.slice(0, 10);
      if (d < de || d > ate) continue;
      const mapa = porLoja.get(v.loja) ?? porLoja.set(v.loja, new Map()).get(v.loja)!;
      // Voltou = a primeira compra dela foi antes do começo do período
      mapa.set(v.clienteId!, (mapa.get(v.clienteId!) ?? false) || primeira.get(v.clienteId!)! < de);
    }
    return porLoja;
  };
  const atual = conta(inicio, hoje);
  const anterior = conta(inicioAnt, fimAnt);
  const pct = (x: number, y: number) => (y ? Math.round((x / y) * 100) : null);
  const linha = (mapa?: Map<string, boolean>) => {
    const compradoras = mapa?.size ?? 0;
    const voltaram = mapa ? [...mapa.values()].filter(Boolean).length : 0;
    return { compradoras, voltaram, novas: compradoras - voltaram, pct: pct(voltaram, compradoras) };
  };
  const lojas = [...Object.values(LOJAS), "Site"]
    .map((loja) => {
      const ant = linha(anterior.get(loja));
      return { loja, ...linha(atual.get(loja)), pctAnterior: ant.pct };
    })
    .filter((l) => l.compradoras > 0)
    .sort((x, y) => (y.pct ?? 0) - (x.pct ?? 0));
  const juntar = (mapas: Map<string, Map<string, boolean>>) => {
    const todas = new Map<string, boolean>();
    for (const mp of mapas.values()) for (const [k, v] of mp) todas.set(k, (todas.get(k) ?? false) || v);
    return linha(todas);
  };
  return { lojas, total: { ...juntar(atual), pctAnterior: juntar(anterior).pct } };
}
