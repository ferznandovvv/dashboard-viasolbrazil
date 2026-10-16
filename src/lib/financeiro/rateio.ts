/**
 * Como uma conta se divide para o DRE: entre lojas (rateio) e, por elas,
 * entre empresas — cada loja pertence a uma empresa. Sem rateio, a conta
 * inteira fica com a empresa em que foi lançada.
 */

import type { BaseFinanceira, Conta, ParteRateio } from "./tipos";

export interface Pedaco {
  empresaId: string;
  /** Loja/canal, quando a conta tem rateio */
  unidade?: string;
  /** Fração da conta (0 a 1) */
  fracao: number;
}

export function pedacos(c: Conta, base: BaseFinanceira): Pedaco[] {
  const partes = (c.rateio ?? []).filter((p) => p.valor > 0);
  const soma = partes.reduce((s, p) => s + p.valor, 0);
  if (!partes.length || !(soma > 0)) {
    // Empresa de uma loja só: a conta é daquela loja, sem precisar escolher
    const lojas = base.empresas.find((e) => e.id === c.empresaId)?.unidades ?? [];
    return [{ empresaId: c.empresaId, unidade: lojas.length === 1 ? lojas[0] : undefined, fracao: 1 }];
  }
  const dona = (u: string) => base.empresas.find((e) => e.unidades.includes(u))?.id ?? c.empresaId;
  return partes.map((p) => ({ empresaId: dona(p.unidade), unidade: p.unidade, fracao: p.valor / soma }));
}

/**
 * Confere e arruma um rateio vindo da tela: só lojas conhecidas, valores
 * positivos, e a soma batendo com o valor da conta (diferença de centavos
 * vai para a última parte).
 */
export function validarRateio(
  rateio: ParteRateio[] | undefined,
  valor: number,
  unidades: string[]
): { rateio?: ParteRateio[]; erro?: string } {
  const partes = (rateio ?? [])
    .map((p) => ({ unidade: String(p.unidade), valor: Math.round(Number(p.valor) * 100) / 100 }))
    .filter((p) => unidades.includes(p.unidade) && p.valor > 0);
  if (partes.length === 0) return { rateio: undefined };
  if (partes.length === 1) return { rateio: [{ unidade: partes[0].unidade, valor }] };
  const soma = partes.reduce((s, p) => s + p.valor, 0);
  const diferenca = Math.round((valor - soma) * 100) / 100;
  if (Math.abs(diferenca) > 0.05)
    return { erro: `O rateio soma ${soma.toFixed(2).replace(".", ",")}, mas a conta é de ${valor.toFixed(2).replace(".", ",")}.` };
  partes[partes.length - 1].valor = Math.round((partes[partes.length - 1].valor + diferenca) * 100) / 100;
  return { rateio: partes };
}
