/**
 * Cashback como extrato: créditos (com validade) e débitos. O saldo nunca é
 * editado à mão, é sempre a soma do extrato. Resgate consome os créditos mais
 * antigos primeiro; o que não for usado até a validade vira expiração.
 */

import { hojeSp, novoId, somarDias } from "./base";
import type { BaseCrm, Cliente, CodigoResgate, MovimentoCashback, Venda } from "./tipos";

const arred = (v: number) => Math.round(v * 100) / 100;

export interface CreditoAberto {
  movimentoId: string;
  valorOriginal: number;
  restante: number;
  validade: string;
  criadoEm: string;
  vendaId?: string;
}

/** Créditos ainda válidos e não consumidos de uma cliente, do mais antigo ao mais novo. */
export function creditosAbertos(base: BaseCrm, clienteId: string, hoje = hojeSp()): CreditoAberto[] {
  const movs = base.cashback.filter((m) => m.clienteId === clienteId).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  const creditos: CreditoAberto[] = [];
  let debitoPendente = 0;
  for (const m of movs) {
    if (m.tipo === "credito" || (m.tipo === "ajuste" && m.valor > 0)) {
      creditos.push({
        movimentoId: m.id,
        valorOriginal: m.valor,
        restante: m.valor,
        validade: m.validade ?? somarDias(m.criadoEm.slice(0, 10), base.config.cashbackValidadeDias),
        criadoEm: m.criadoEm,
        vendaId: m.vendaId,
      });
    } else if (m.devolucaoId && m.vendaId) {
      // Estorno de devolução sai primeiro do crédito da compra devolvida
      let falta = -m.valor;
      const daVenda = creditos.find((c) => c.vendaId === m.vendaId);
      if (daVenda) {
        const usa = Math.min(daVenda.restante, falta);
        daVenda.restante = arred(daVenda.restante - usa);
        falta = arred(falta - usa);
      }
      debitoPendente += falta;
    } else {
      debitoPendente += -m.valor;
    }
    // Consome do mais antigo
    for (const c of creditos) {
      if (debitoPendente <= 0) break;
      const usa = Math.min(c.restante, debitoPendente);
      c.restante = arred(c.restante - usa);
      debitoPendente = arred(debitoPendente - usa);
    }
  }
  return creditos.filter((c) => c.restante > 0.009 && c.validade >= hoje);
}

export function saldoDe(base: BaseCrm, clienteId: string, hoje = hojeSp()): number {
  return arred(creditosAbertos(base, clienteId, hoje).reduce((s, c) => s + c.restante, 0));
}

/** Soma e data do crédito que vence até `ate`. */
export function vencendoAte(base: BaseCrm, clienteId: string, ate: string, hoje = hojeSp()): { valor: number; em?: string } {
  const lista = creditosAbertos(base, clienteId, hoje).filter((c) => c.validade <= ate);
  return { valor: arred(lista.reduce((s, c) => s + c.restante, 0)), em: lista[0]?.validade };
}

/**
 * Credita o cashback de uma venda, se a regra permitir e ainda não tiver
 * sido creditado. Devolve o movimento criado ou null.
 */
export function creditarVenda(base: BaseCrm, venda: Venda, cliente: Cliente): MovimentoCashback | null {
  const cfg = base.config;
  if (cfg.cashbackPct <= 0) return null;
  if (venda.valor < cfg.cashbackCompraMinima) return null;
  if (base.cashback.some((m) => m.vendaId === venda.id && m.tipo === "credito")) return null;
  const valor = arred((venda.valor * cfg.cashbackPct) / 100);
  if (valor < 0.01) return null;
  const dia = venda.data.slice(0, 10);
  const mov: MovimentoCashback = {
    id: novoId(),
    clienteId: cliente.id,
    tipo: "credito",
    valor,
    vendaId: venda.id,
    validade: somarDias(dia, cfg.cashbackValidadeDias),
    loja: venda.loja,
    criadoEm: new Date().toISOString(),
    por: "sistema",
  };
  base.cashback.push(mov);
  return mov;
}

/** Marca como expirado o que passou da validade sem ser usado. Devolve quantos movimentos criou. */
export function expirarCreditos(base: BaseCrm, hoje = hojeSp()): number {
  let n = 0;
  const clientes = new Set(base.cashback.map((m) => m.clienteId));
  for (const clienteId of clientes) {
    // Créditos abertos ignorando a validade, para achar os vencidos com saldo
    const abertos = creditosAbertos(base, clienteId, "0000-00-00").filter((c) => c.validade < hoje);
    for (const c of abertos) {
      base.cashback.push({
        id: novoId(),
        clienteId,
        tipo: "expiracao",
        valor: -c.restante,
        criadoEm: new Date().toISOString(),
        obs: `Crédito de ${c.criadoEm.slice(0, 10)} venceu em ${c.validade}`,
        por: "sistema",
      });
      n++;
    }
  }
  return n;
}

/** Quanto de cashback cabe numa compra deste valor, pela regra configurada (null = sem teto). */
export function tetoNaCompra(cfg: BaseCrm["config"], valorCompra: number): number | null {
  if (cfg.cashbackMultiploCompra > 0) return arred(valorCompra / cfg.cashbackMultiploCompra);
  if (cfg.cashbackMaxPctDaCompra > 0) return arred((valorCompra * cfg.cashbackMaxPctDaCompra) / 100);
  return null;
}

/** Marca um código de oferta (aniversário, reativação) como usado numa compra. */
export function usarOferta(base: BaseCrm, codigo: string, loja: string, compraValor?: number): CodigoResgate {
  const hoje = hojeSp();
  const cod = base.codigos.find((c) => c.codigo === codigo.trim().toUpperCase());
  if (!cod) throw new Error("Código não encontrado.");
  if (!cod.oferta) throw new Error("Esse código é de cashback, não de oferta.");
  if (cod.usadoEm) throw new Error("Esse código já foi usado.");
  if (cod.validade < hoje) throw new Error("Esse código venceu.");
  cod.usadoEm = new Date().toISOString();
  cod.usadoNaLoja = loja;
  cod.compraValor = compraValor;
  return cod;
}

const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I

export function gerarCodigo(base: BaseCrm): string {
  for (;;) {
    let c = "";
    for (let i = 0; i < 6; i++) c += LETRAS[Math.floor(Math.random() * LETRAS.length)];
    if (!base.codigos.some((x) => x.codigo === c)) return c;
  }
}

export interface PedidoResgate {
  clienteId: string;
  /** Quanto quer usar */
  valor: number;
  /** Valor total da compra, para respeitar o teto percentual */
  valorCompra?: number;
  loja: string;
  por?: string;
  codigo?: string;
}

/** Valida e registra um resgate. Lança erro com mensagem amigável se não puder. */
export function resgatar(base: BaseCrm, pedido: PedidoResgate): MovimentoCashback {
  const cfg = base.config;
  const hoje = hojeSp();
  const saldo = saldoDe(base, pedido.clienteId, hoje);
  const valor = arred(pedido.valor);
  if (valor <= 0) throw new Error("Informe o valor a resgatar.");
  // Código gerado pelo painel já é a autorização: dispensa o saldo mínimo
  let cod: CodigoResgate | undefined;
  if (pedido.codigo) {
    cod = base.codigos.find((c) => c.codigo === pedido.codigo);
    if (!cod) throw new Error("Código não encontrado.");
    if (cod.clienteId !== pedido.clienteId) throw new Error("Esse código é de outra cliente.");
    if (cod.usadoEm) throw new Error("Esse código já foi usado.");
    if (cod.validade < hoje) throw new Error("Esse código venceu.");
    if (cod.oferta && cod.valor === 0) throw new Error(`Esse código é da oferta "${cod.oferta}", não de cashback. Use "Usar código de oferta".`);
    if (valor > cod.valor + 0.009) throw new Error(`Esse código vale R$ ${cod.valor.toFixed(2)}.`);
  } else if (saldo < cfg.cashbackResgateMinimo) {
    throw new Error(`Saldo de R$ ${saldo.toFixed(2)} ainda não atinge o mínimo de R$ ${cfg.cashbackResgateMinimo.toFixed(2)} para resgate.`);
  }
  if (valor > saldo + 0.009) throw new Error(`Saldo disponível é R$ ${saldo.toFixed(2)}.`);
  if (pedido.valorCompra) {
    const teto = tetoNaCompra(cfg, pedido.valorCompra);
    if (teto !== null && valor > teto + 0.009) {
      throw new Error(
        cfg.cashbackMultiploCompra > 0
          ? `A compra precisa ser pelo menos ${cfg.cashbackMultiploCompra}x o cashback usado: nesta dá pra usar no máximo R$ ${teto.toFixed(2)}.`
          : `Nesta compra dá pra usar no máximo R$ ${teto.toFixed(2)} (${cfg.cashbackMaxPctDaCompra}% do valor).`
      );
    }
  }
  if (cod) {
    cod.usadoEm = new Date().toISOString();
    cod.usadoNaLoja = pedido.loja;
  }
  const mov: MovimentoCashback = {
    id: novoId(),
    clienteId: pedido.clienteId,
    tipo: "resgate",
    valor: -valor,
    loja: pedido.loja,
    codigo: pedido.codigo,
    criadoEm: new Date().toISOString(),
    por: pedido.por,
  };
  base.cashback.push(mov);
  return mov;
}
