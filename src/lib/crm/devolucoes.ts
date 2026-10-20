/**
 * Devolução e venda cancelada tiram o cashback que a compra gerou.
 *
 * Devolução: a TOTVS não diz de qual venda a peça voltou (referencedTaxInvoice
 * vem vazio), então o sistema procura a compra dela que gerou cashback, do mesmo
 * dia ou antes, dentro da validade. Quando as duas notas têm os itens, só vale a
 * compra que tem a mesma peça; peça de compra antiga (de antes do cashback) não
 * tira nada. Sai a parte proporcional ao que voltou (devolveu R$ 100 de uma compra
 * de R$ 200 com R$ 30 de cashback: sai R$ 15).
 *
 * Venda cancelada: sai o cashback inteiro dela e a venda some da base.
 *
 * Nunca tira mais do que a cliente tem de saldo: se ela já usou, o que usou fica
 * (e aparece no registro, para o dono saber).
 */

import { novoId, somarDias } from "./base";
import { saldoDe } from "./cashback";
import type { BaseCrm, Devolucao, MovimentoCashback, Venda } from "./tipos";

const arred = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

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

/** Quanto do crédito de cada venda já saiu por devolução (R$). */
function estornadoPorVenda(b: BaseCrm): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of b.cashback) if (x.devolucaoId && x.vendaId) m.set(x.vendaId, arred((m.get(x.vendaId) ?? 0) - x.valor));
  return m;
}

/** Cashback que ainda vale de uma venda: crédito menos o que já saiu por devolução. */
export function creditoLiquidoDaVenda(b: BaseCrm, vendaId: string): number {
  const cred = b.cashback.find((m) => m.tipo === "credito" && m.vendaId === vendaId);
  if (!cred) return 0;
  return arred(cred.valor - (estornadoPorVenda(b).get(vendaId) ?? 0));
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

/** Confere uma devolução (uma vez só por nota). Devolve o registro, ou null se já tinha sido vista. */
export function aplicarDevolucao(b: BaseCrm, dev: DevolucaoLida): Devolucao | null {
  b.devolucoes ??= [];
  if (b.devolucoes.some((d) => d.id === dev.id)) return null;
  const reg: Devolucao = { id: dev.id, tipo: "devolucao", loja: dev.loja, data: dev.data, valor: dev.valor, nomeNaNota: dev.nomeNaNota, estorno: 0, vistoEm: new Date().toISOString() };
  b.devolucoes.push(reg);

  const c = dev.codigoCliente ? b.clientes.find((x) => x.codigoTotvs === dev.codigoCliente) : undefined;
  if (!c) {
    reg.obs = "Cliente fora do CRM: nada a tirar";
    return reg;
  }
  reg.clienteId = c.id;

  // Compras dela com cashback, do dia da devolução para trás, dentro da validade
  const desde = somarDias(dev.data, -b.config.cashbackValidadeDias);
  const creditadas = new Set(b.cashback.filter((m) => m.tipo === "credito" && m.clienteId === c.id && m.vendaId).map((m) => m.vendaId!));
  const estornado = estornadoPorVenda(b);
  let candidatas = b.vendas
    .filter((v) => v.clienteId === c.id && creditadas.has(v.id) && v.data.slice(0, 10) <= dev.data && v.data.slice(0, 10) >= desde)
    .filter((v) => creditoLiquidoDaVenda(b, v.id) >= 0.01)
    .sort((a, z) => z.data.localeCompare(a.data));
  if (candidatas.length === 0) {
    reg.obs = "Nenhuma compra dela com cashback antes da devolução (compra antiga)";
    return reg;
  }
  // Com os itens das duas notas, só vale a compra que tem a mesma peça
  if (dev.itens?.length) {
    const pecas = new Set(dev.itens);
    const mesmaPeca = candidatas.filter((v) => v.itens?.some((i) => pecas.has(i)));
    const semItens = candidatas.filter((v) => !v.itens);
    candidatas = mesmaPeca.length ? mesmaPeca : semItens;
    if (candidatas.length === 0) {
      reg.obs = "As peças devolvidas não são de nenhuma compra com cashback (compra antiga)";
      return reg;
    }
  }

  // Reparte o valor devolvido entre as compras, da mais recente para trás
  let falta = dev.valor;
  const partes: { venda: Venda; valor: number }[] = [];
  for (const v of candidatas) {
    if (falta < 0.01) break;
    const cred = b.cashback.find((m) => m.tipo === "credito" && m.vendaId === v.id)!;
    const taxa = v.valor > 0 ? cred.valor / v.valor : 0;
    const jaSaiu = estornado.get(v.id) ?? 0;
    const valorAindaComCashback = taxa > 0 ? v.valor - jaSaiu / taxa : 0;
    const parte = Math.min(falta, valorAindaComCashback);
    if (parte <= 0) continue;
    const valor = arred(Math.min(parte * taxa, cred.valor - jaSaiu));
    partes.push({ venda: v, valor });
    falta = arred(falta - parte);
  }
  const { partes: cabem, faltou } = caberNoSaldo(b, c.id, partes);
  lancar(b, reg, cabem, dev.loja);
  reg.estorno = arred(cabem.reduce((s, p) => s + p.valor, 0));
  reg.vendas = cabem.filter((p) => p.valor >= 0.01).map((p) => p.venda.id);
  if (faltou > 0) reg.obs = `Ela já tinha usado ${reais(faltou)} desse cashback: isso não volta`;
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

/** Registros mais velhos que isso saem da lista (o estorno fica no extrato). */
export function limparDevolucoes(b: BaseCrm, hoje: string) {
  const corte = somarDias(hoje, -180);
  if (b.devolucoes) b.devolucoes = b.devolucoes.filter((d) => d.data >= corte);
}
