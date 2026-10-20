/**
 * Devolução e troca: a compra devolvida deixa de contar.
 *
 * A TOTVS não diz de qual venda a peça voltou (referencedTaxInvoice vem vazio),
 * então o sistema procura a compra da cliente do mesmo dia ou antes. Quando as
 * duas notas têm os itens, vale a compra que tem a mesma peça; sem itens, a
 * mais recente. O valor devolvido é marcado na venda (`devolvido`): troca vira
 * uma compra só, e a compra devolvida inteira some do histórico da cliente.
 *
 * Se a compra gerou cashback, sai a parte proporcional ao que voltou (devolveu
 * R$ 100 de uma compra de R$ 200 com R$ 30 de cashback: sai R$ 15). Nunca tira
 * mais do que a cliente tem de saldo: o que ela já usou fica (e o registro diz).
 *
 * Venda cancelada: sai o cashback inteiro dela e a venda some da base.
 */

import { novoId, somarDias } from "./base";
import { saldoDe } from "./cashback";
import type { BaseCrm, Devolucao, MovimentoCashback, Venda } from "./tipos";

const arred = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Até quantos dias depois da compra uma devolução ainda é procurada nela. */
export const JANELA_DEVOLUCAO_DIAS = 180;

export interface DevolucaoLida {
  /** filial-sequência da nota de entrada */
  id: string;
  loja: string;
  data: string;
  valor: number;
  codigoCliente?: string;
  nomeNaNota?: string;
  /** Referências das peças que voltaram */
  itens?: string[];
}

/** Quanto ainda dá para devolver de uma venda. */
const aberto = (v: Pick<Venda, "valor" | "devolvido">) => arred(v.valor - (v.devolvido ?? 0));

/**
 * Compras de onde a devolução pode ter saído, na ordem em que o valor é
 * descontado: as que têm a mesma peça (se der para saber) e, entre elas, a
 * mais recente primeiro. Usado aqui e no dashboard (vendedora da venda original).
 */
export function comprasDaDevolucao<V extends Pick<Venda, "data" | "valor" | "devolvido" | "itens">>(
  compras: V[],
  dev: { data: string; itens?: string[] }
): V[] {
  const desde = somarDias(dev.data, -JANELA_DEVOLUCAO_DIAS);
  let c = compras
    .filter((v) => v.valor > 0 && v.data.slice(0, 10) <= dev.data && v.data.slice(0, 10) >= desde && aberto(v) >= 0.01)
    .sort((a, z) => z.data.localeCompare(a.data));
  if (dev.itens?.length) {
    const pecas = new Set(dev.itens);
    const mesmaPeca = c.filter((v) => v.itens?.some((i) => pecas.has(i)));
    // Nenhuma com a mesma peça: só as que não têm itens para comparar
    c = mesmaPeca.length ? mesmaPeca : c.filter((v) => !v.itens);
  }
  return c;
}

/** Cashback que ainda vale de uma venda: crédito menos o que já saiu por devolução. */
export function creditoLiquidoDaVenda(b: BaseCrm, vendaId: string): number {
  const cred = b.cashback.find((m) => m.tipo === "credito" && m.vendaId === vendaId);
  if (!cred) return 0;
  const saiu = b.cashback.filter((m) => m.devolucaoId && m.vendaId === vendaId).reduce((s, m) => s - m.valor, 0);
  return arred(cred.valor - saiu);
}

function lancar(b: BaseCrm, d: Devolucao, partes: { venda: Venda; valor: number }[], loja: string) {
  for (const p of partes) {
    if (p.valor < 0.01) continue;
    const mov: MovimentoCashback = {
      id: novoId(),
      clienteId: d.clienteId!,
      tipo: "ajuste",
      valor: -p.valor,
      vendaId: p.venda.id,
      devolucaoId: d.id,
      loja,
      obs:
        d.tipo === "cancelamento"
          ? `Venda cancelada na TOTVS (nota ${p.venda.id}, ${reais(p.venda.valor)})`
          : `Devolução de ${reais(d.valor)} em ${dataBr(d.data)} (${d.loja}), da compra de ${dataBr(p.venda.data)}`,
      criadoEm: new Date().toISOString(),
      por: "sistema",
    };
    b.cashback.push(mov);
    // Aviso de cashback dessa compra ainda na fila e não sobrou nada: não sai
    if (creditoLiquidoDaVenda(b, p.venda.id) < 0.01) {
      const cred = b.cashback.find((m) => m.tipo === "credito" && m.vendaId === p.venda.id);
      for (const msg of b.mensagens)
        if (cred && msg.chave === `cb-credito-${cred.id}` && msg.status === "fila") {
          msg.status = "cancelada";
          msg.erro = d.tipo === "cancelamento" ? "Venda cancelada" : "Compra devolvida";
        }
    }
  }
}

/** Corta o estorno ao saldo que ela tem hoje; devolve o que cabe e o que não coube. */
function caberNoSaldo(b: BaseCrm, clienteId: string, partes: { venda: Venda; valor: number }[]) {
  const total = arred(partes.reduce((s, p) => s + p.valor, 0));
  const saldo = saldoDe(b, clienteId);
  if (total <= saldo + 0.009) return { partes, faltou: 0 };
  let sobra = saldo;
  const cortadas = partes.map((p) => {
    const v = arred(Math.min(p.valor, Math.max(0, sobra)));
    sobra = arred(sobra - v);
    return { venda: p.venda, valor: v };
  });
  return { partes: cortadas, faltou: arred(total - saldo) };
}

/**
 * Confere uma devolução (uma vez só por nota): marca o valor devolvido na compra
 * e tira o cashback dela, se tiver. Devolve o registro, ou null se já tinha sido vista.
 * `estornar=false` só marca a compra (devoluções antigas, de antes do cashback).
 */
export function aplicarDevolucao(b: BaseCrm, dev: DevolucaoLida, estornar = true): Devolucao | null {
  b.devolucoes ??= [];
  if (b.devolucoes.some((d) => d.id === dev.id)) return null;
  const reg: Devolucao = { id: dev.id, tipo: "devolucao", loja: dev.loja, data: dev.data, valor: dev.valor, nomeNaNota: dev.nomeNaNota, estorno: 0, partes: [], vistoEm: new Date().toISOString() };
  b.devolucoes.push(reg);

  const c = dev.codigoCliente ? b.clientes.find((x) => x.codigoTotvs === dev.codigoCliente) : undefined;
  if (!c) {
    reg.obs = "Cliente fora do CRM";
    return reg;
  }
  reg.clienteId = c.id;

  const candidatas = comprasDaDevolucao(
    b.vendas.filter((v) => v.clienteId === c.id),
    dev
  );
  if (candidatas.length === 0) {
    reg.obs = "Não achei a compra de onde saiu a peça (compra antiga ou fora do CRM)";
    return reg;
  }

  // Reparte o valor devolvido entre as compras, na ordem acima
  let falta = dev.valor;
  const cashback: { venda: Venda; valor: number }[] = [];
  for (const v of candidatas) {
    if (falta < 0.01) break;
    const parte = arred(Math.min(falta, aberto(v)));
    if (parte < 0.01) continue;
    const cred = b.cashback.find((m) => m.tipo === "credito" && m.vendaId === v.id);
    const liquido = creditoLiquidoDaVenda(b, v.id);
    const estorno = cred && v.valor > 0 && estornar ? arred(Math.min((parte * cred.valor) / v.valor, liquido)) : 0;
    v.devolvido = arred((v.devolvido ?? 0) + parte);
    reg.partes!.push({ vendaId: v.id, valor: parte, estorno });
    if (estorno >= 0.01) cashback.push({ venda: v, valor: estorno });
    falta = arred(falta - parte);
  }
  reg.vendas = reg.partes!.map((p) => p.vendaId);

  if (cashback.length) {
    const { partes: cabem, faltou } = caberNoSaldo(b, c.id, cashback);
    lancar(b, reg, cabem, dev.loja);
    for (const p of reg.partes!) p.estorno = cabem.find((x) => x.venda.id === p.vendaId)?.valor ?? 0;
    reg.estorno = arred(cabem.reduce((s, p) => s + p.valor, 0));
    if (faltou > 0) reg.obs = `Ela já tinha usado ${reais(faltou)} desse cashback: isso não volta`;
  }
  return reg;
}

/** Venda que saiu cancelada na TOTVS: tira o cashback dela e tira a venda da base. */
export function aplicarCancelamento(b: BaseCrm, vendaId: string): Devolucao | null {
  b.devolucoes ??= [];
  const id = `cancelada-${vendaId}`;
  if (b.devolucoes.some((d) => d.id === id)) return null;
  const i = b.vendas.findIndex((v) => v.id === vendaId);
  if (i < 0) return null; // nunca entrou (cancelada antes da sincronização): nada a fazer
  const venda = b.vendas[i];
  const reg: Devolucao = {
    id,
    tipo: "cancelamento",
    loja: venda.loja,
    data: venda.data.slice(0, 10),
    valor: venda.valor,
    clienteId: venda.clienteId,
    nomeNaNota: venda.nomeNaNota,
    estorno: 0,
    vistoEm: new Date().toISOString(),
  };
  b.devolucoes.push(reg);
  b.vendas.splice(i, 1);
  const liquido = creditoLiquidoDaVenda(b, vendaId);
  if (venda.clienteId && liquido >= 0.01) {
    const { partes, faltou } = caberNoSaldo(b, venda.clienteId, [{ venda, valor: liquido }]);
    lancar(b, reg, partes, venda.loja);
    reg.estorno = arred(partes.reduce((s, p) => s + p.valor, 0));
    reg.vendas = [vendaId];
    if (faltou > 0) reg.obs = `Ela já tinha usado ${reais(faltou)} desse cashback: isso não volta`;
  }
  return reg;
}

/**
 * Pedido do site reembolsado em parte depois de entrar na base: a diferença
 * para o valor que ficou vira devolução da própria venda (desconta no
 * histórico e tira o cashback proporcional). Uma vez por valor novo.
 */
export function aplicarReembolsoParcial(b: BaseCrm, vendaId: string, valorAtual: number): Devolucao | null {
  const v = b.vendas.find((x) => x.id === vendaId);
  if (!v) return null;
  const diferenca = arred(aberto(v) - valorAtual);
  if (diferenca < 0.01) return null;
  b.devolucoes ??= [];
  const id = `reembolso-${vendaId}-${Math.round(valorAtual * 100)}`;
  if (b.devolucoes.some((d) => d.id === id)) return null;
  const reg: Devolucao = { id, tipo: "devolucao", loja: v.loja, data: new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10), valor: diferenca, clienteId: v.clienteId, nomeNaNota: v.nomeNaNota, estorno: 0, partes: [], vendas: [vendaId], obs: "Reembolso parcial no site", vistoEm: new Date().toISOString() };
  b.devolucoes.push(reg);
  const cred = b.cashback.find((m) => m.tipo === "credito" && m.vendaId === vendaId);
  const estorno = cred && v.valor > 0 ? arred(Math.min((diferenca * cred.valor) / v.valor, creditoLiquidoDaVenda(b, vendaId))) : 0;
  v.devolvido = arred((v.devolvido ?? 0) + diferenca);
  reg.partes!.push({ vendaId, valor: diferenca, estorno });
  if (estorno >= 0.01 && v.clienteId) {
    const { partes, faltou } = caberNoSaldo(b, v.clienteId, [{ venda: v, valor: estorno }]);
    lancar(b, reg, partes, v.loja);
    reg.partes![0].estorno = partes[0].valor;
    reg.estorno = partes[0].valor;
    if (faltou > 0) reg.obs += `. Ela já tinha usado ${reais(faltou)} desse cashback: isso não volta`;
  }
  return reg;
}
