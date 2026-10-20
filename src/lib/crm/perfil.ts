/**
 * Perfil de compra de cada cliente, calculado uma vez para a base toda:
 * loja dela, faixa (Ouro, Prata...), total gasto, compras, primeira e
 * última compra. Usado pela Análise, pelas Campanhas e pelo painel.
 */

import { diasEntre, hojeSp } from "./base";
import { contaComoCompra, valorLiquido, type BaseCrm, type FaixaCliente } from "./tipos";

export interface Perfil {
  /** Loja da última compra, senão a do cadastro */
  loja?: string;
  faixa: FaixaCliente;
  total: number;
  compras: number;
  primeira?: string;
  ultima?: string;
}

/** Regra das faixas, a mesma da aba Análise. */
export function faixaDe(compras: number, total: number, diasDesdeUltima: number | null): FaixaCliente {
  if (!compras || diasDesdeUltima === null) return "Sem compra";
  if (diasDesdeUltima > 365) return "Parada";
  if (compras >= 3 || total >= 1500) return "Ouro";
  if (compras === 2 || total >= 600) return "Prata";
  if (compras === 1 && diasDesdeUltima <= 180) return "Nova";
  return "Bronze";
}

export function perfis(base: BaseCrm, hoje = hojeSp()): Map<string, Perfil> {
  const agg = new Map<string, { total: number; compras: number; primeira: string; ultima: string; lojaUltima: string }>();
  for (const bruta of base.vendas) {
    if (!bruta.clienteId || !contaComoCompra(bruta)) continue;
    const v = { ...bruta, clienteId: bruta.clienteId, valor: valorLiquido(bruta) };
    const d = v.data.slice(0, 10);
    const a = agg.get(v.clienteId);
    if (!a) agg.set(v.clienteId, { total: v.valor, compras: 1, primeira: d, ultima: d, lojaUltima: v.loja });
    else {
      a.total += v.valor;
      a.compras++;
      if (d < a.primeira) a.primeira = d;
      if (d >= a.ultima) {
        a.ultima = d;
        a.lojaUltima = v.loja;
      }
    }
  }
  const r = new Map<string, Perfil>();
  for (const c of base.clientes) {
    const a = agg.get(c.id);
    r.set(c.id, {
      loja: a?.lojaUltima ?? c.lojaOrigem,
      faixa: faixaDe(a?.compras ?? 0, a?.total ?? 0, a ? diasEntre(a.ultima, hoje) : null),
      total: Math.round((a?.total ?? 0) * 100) / 100,
      compras: a?.compras ?? 0,
      primeira: a?.primeira,
      ultima: a?.ultima,
    });
  }
  return r;
}
