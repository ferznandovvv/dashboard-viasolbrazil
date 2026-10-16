/**
 * Como uma conta se divide no DRE: entre empresas. Sem rateio, a conta
 * inteira fica com a empresa em que foi lançada (a que paga); com uma parte
 * só, ela é toda de outra empresa; com várias, cada uma leva a sua.
 */

import type { BaseFinanceira, Conta, ParteRateio } from "./tipos";

export interface Pedaco {
  empresaId: string;
  /** Fração da conta (0 a 1) */
  fracao: number;
}

export function pedacos(c: Conta): Pedaco[] {
  const partes = (c.rateio ?? []).filter((p) => p.empresaId && p.valor > 0);
  const soma = partes.reduce((s, p) => s + p.valor, 0);
  if (!partes.length || !(soma > 0)) return [{ empresaId: c.empresaId, fracao: 1 }];
  // Uma parte só: a despesa é toda de outra empresa (paga por esta)
  if (partes.length === 1) return [{ empresaId: partes[0].empresaId, fracao: 1 }];
  return partes.map((p) => ({ empresaId: p.empresaId, fracao: p.valor / soma }));
}

/**
 * Confere e arruma um rateio vindo da tela: só empresas que existem, valores
 * positivos, e a soma batendo com o valor da conta (diferença de centavos vai
 * para a última parte). Uma parte só = despesa toda de outra empresa.
 */
export function validarRateio(
  rateio: ParteRateio[] | undefined,
  valor: number,
  base: BaseFinanceira,
  pagadora: string
): { rateio?: ParteRateio[]; erro?: string } {
  const partes = (rateio ?? [])
    .map((p) => ({ empresaId: String(p.empresaId ?? ""), valor: Math.round(Number(p.valor) * 100) / 100 }))
    .filter((p) => base.empresas.some((e) => e.id === p.empresaId) && p.valor > 0);
  if (partes.length === 0) return { rateio: undefined };
  // Toda de outra empresa: guarda uma parte só, com o valor da conta
  if (partes.length === 1)
    return { rateio: partes[0].empresaId === pagadora ? undefined : [{ empresaId: partes[0].empresaId, valor }] };
  const soma = partes.reduce((s, p) => s + p.valor, 0);
  const diferenca = Math.round((valor - soma) * 100) / 100;
  if (Math.abs(diferenca) > 0.05)
    return { erro: `A divisão soma ${soma.toFixed(2).replace(".", ",")}, mas a conta é de ${valor.toFixed(2).replace(".", ",")}.` };
  partes[partes.length - 1].valor = Math.round((partes[partes.length - 1].valor + diferenca) * 100) / 100;
  return { rateio: partes };
}
