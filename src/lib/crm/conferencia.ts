/**
 * Conferência do cashback manual: cruza as notas do TOTVS (com o desconto
 * de cada uma) com as baixas feitas no painel da loja.
 *
 * - Desconto sem baixa: a cliente tinha saldo, a nota saiu com desconto e
 *   ninguém deu baixa. Ou a vendedora esqueceu (e o cashback pode ser usado
 *   de novo), ou o desconto foi outra coisa. Vale a gerente olhar.
 * - Baixa sem desconto: deram baixa, mas nenhuma nota da cliente naquela
 *   loja, perto da data, tem desconto. Ou a nota ainda não chegou, ou a
 *   baixa foi feita sem o desconto ter sido dado.
 */

import { diasEntre, hojeSp, somarDias } from "./base";
import { saldoDe } from "./cashback";
import type { BaseCrm } from "./tipos";

export interface ItemConferencia {
  tipo: "desconto_sem_baixa" | "baixa_sem_desconto";
  data: string;
  loja: string;
  cliente: string;
  clienteId: string;
  vendedora?: string;
  compra?: number;
  desconto?: number;
  saldoNaHora?: number;
  baixa?: number;
}

export interface Conferencia {
  desde: string;
  /** Vendas do período que vieram com o desconto (sem isso não dá pra conferir) */
  vendasComDesconto: number;
  vendasConferiveis: number;
  baixas: number;
  itens: ItemConferencia[];
  porLoja: { loja: string; descontoSemBaixa: number; baixaSemDesconto: number; baixas: number }[];
}

const dentro = (n: number, de: number, ate: number) => n >= de && n <= ate;
const nomeVend = (base: BaseCrm, cpf?: string) =>
  cpf
    ? (base.vendedoras?.[cpf]
        ?.split(/\s+/)
        .slice(0, 2)
        .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
        .join(" ") ?? `CPF •••${cpf.slice(3, 9)}`)
    : undefined;

export function conferir(base: BaseCrm, dias = 14, loja?: string): Conferencia {
  const hoje = hojeSp();
  const desde = somarDias(hoje, -dias);
  const nomes = new Map(base.clientes.map((c) => [c.id, c.nome]));
  const movsPor = new Map<string, BaseCrm["cashback"]>();
  for (const m of base.cashback) (movsPor.get(m.clienteId) ?? movsPor.set(m.clienteId, []).get(m.clienteId)!).push(m);
  const baixas = base.cashback.filter((m) => m.tipo === "resgate" && m.criadoEm.slice(0, 10) > desde && (!loja || m.loja === loja));
  // Códigos de oferta usados (aniversário, campanha): o desconto da nota pode ser deles
  const ofertas = base.codigos.filter((k) => k.usadoEm && k.oferta);

  const vendas = base.vendas.filter((v) => v.origem === "totvs" && v.data.slice(0, 10) > desde && (!loja || v.loja === loja));
  const conferiveis = vendas.filter((v) => v.desconto !== undefined);
  const itens: ItemConferencia[] = [];
  const usadas = new Set<string>();

  for (const v of conferiveis) {
    if (!v.clienteId || !v.desconto || v.desconto < 1) continue;
    const dia = v.data.slice(0, 10);
    // Saldo que ela tinha antes desta compra
    const antes = (movsPor.get(v.clienteId) ?? []).filter((m) => m.criadoEm < v.data && m.vendaId !== v.id);
    const saldo = saldoDe({ ...base, cashback: antes }, v.clienteId, dia);
    if (saldo < 1) continue;
    // Baixa da mesma loja entre a véspera e uma semana depois (a gerente pode dar baixa atrasada)
    const baixa = baixas.find((m) => m.clienteId === v.clienteId && m.loja === v.loja && dentro(diasEntre(dia, m.criadoEm.slice(0, 10)), -1, 7) && !usadas.has(m.id));
    if (baixa) {
      usadas.add(baixa.id);
      continue;
    }
    const oferta = ofertas.some((k) => k.clienteId === v.clienteId && Math.abs(diasEntre(k.usadoEm!.slice(0, 10), dia)) <= 1);
    if (oferta) continue;
    itens.push({ tipo: "desconto_sem_baixa", data: v.data, loja: v.loja, cliente: nomes.get(v.clienteId) ?? "?", clienteId: v.clienteId, vendedora: nomeVend(base, v.vendedoraCpf), compra: v.valor, desconto: v.desconto, saldoNaHora: Math.round(saldo * 100) / 100 });
  }

  for (const m of baixas) {
    if (usadas.has(m.id)) continue;
    const dia = m.criadoEm.slice(0, 10);
    // Só acusa quando as notas desse dia já chegaram com desconto (sincronização com itens)
    const notasDoDia = conferiveis.filter((v) => v.loja === m.loja && dentro(diasEntre(v.data.slice(0, 10), dia), -1, 7));
    if (!notasDoDia.length) continue;
    const comDesconto = notasDoDia.some((v) => v.clienteId === m.clienteId && (v.desconto ?? 0) >= 1);
    if (comDesconto) continue;
    itens.push({ tipo: "baixa_sem_desconto", data: m.criadoEm, loja: m.loja ?? "", cliente: nomes.get(m.clienteId) ?? "?", clienteId: m.clienteId, baixa: Math.abs(m.valor) });
  }
  itens.sort((a, b) => b.data.localeCompare(a.data));

  const lojas = Array.from(new Set([...itens.map((i) => i.loja), ...baixas.map((b) => b.loja ?? "")])).filter(Boolean);
  return {
    desde,
    vendasComDesconto: conferiveis.filter((v) => (v.desconto ?? 0) >= 1).length,
    vendasConferiveis: conferiveis.length,
    baixas: baixas.length,
    itens,
    porLoja: lojas
      .map((l) => ({
        loja: l,
        descontoSemBaixa: itens.filter((i) => i.loja === l && i.tipo === "desconto_sem_baixa").length,
        baixaSemDesconto: itens.filter((i) => i.loja === l && i.tipo === "baixa_sem_desconto").length,
        baixas: baixas.filter((b) => b.loja === l).length,
      }))
      .sort((a, b) => b.descontoSemBaixa + b.baixaSemDesconto - (a.descontoSemBaixa + a.baixaSemDesconto)),
  };
}
