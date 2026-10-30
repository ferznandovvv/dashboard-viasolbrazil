/**
 * Repescagem do cashback: o que venceu sem uso nos últimos dias volta por
 * mais 7 dias, com aviso pra cliente. É manual (o dono manda num mês fraco)
 * pra o prazo do cashback continuar valendo; cada crédito vencido só volta
 * uma vez, e o que voltou e venceu de novo não volta mais.
 */

import { hojeSp, novoId, somarDias } from "./base";
import { enfileirar, motivoBloqueio } from "./mensagens";
import { lojaNaCidade } from "./automacoes";
import type { BaseCrm, Cliente, MovimentoCashback } from "./tipos";

export const DIAS_REPESCAGEM = 7;

interface Candidata {
  cliente: Cliente;
  loja: string;
  valor: number;
  expiracoes: MovimentoCashback[];
}

export interface PreviaRepescagem {
  dias: number;
  minimo: number;
  /** Quem recebe: clientes e valor que volta */
  clientes: number;
  valor: number;
  validade: string;
  porLoja: { loja: string; clientes: number; valor: number }[];
  fora: { motivo: string; n: number }[];
  /** Repescagens feitas antes (pra não repetir no mesmo mês sem querer) */
  ultima?: { em: string; clientes: number; valor: number };
}

const arred = (v: number) => Math.round(v * 100) / 100;

/** Loja do crédito que venceu: pelo id (novas) ou pela data no texto (antigas). */
function lojaDaExpiracao(b: BaseCrm, e: MovimentoCashback, c: Cliente): string {
  if (e.loja) return e.loja;
  const cred = e.creditoId ? b.cashback.find((m) => m.id === e.creditoId) : undefined;
  if (cred?.loja) return cred.loja;
  const [, de, venceu] = e.obs?.match(/Crédito de (\d{4}-\d{2}-\d{2}) venceu em (\d{4}-\d{2}-\d{2})/) ?? [];
  const achado = de ? b.cashback.find((m) => m.clienteId === e.clienteId && m.tipo === "credito" && m.criadoEm.slice(0, 10) === de && (!venceu || m.validade === venceu)) : undefined;
  return achado?.loja ?? c.lojaOrigem ?? "Site";
}

function selecionar(b: BaseCrm, dias: number, minimo: number, hoje: string) {
  const desde = new Date(`${somarDias(hoje, -dias)}T00:00:00-03:00`).toISOString();
  const jaVoltou = new Set(b.cashback.filter((m) => m.repescagemDe).map((m) => m.repescagemDe!));
  const daRepescagem = new Set(b.cashback.filter((m) => m.repescagemDe).map((m) => m.id));
  const porCliente = new Map<string, MovimentoCashback[]>();
  for (const m of b.cashback) {
    if (m.tipo !== "expiracao" || m.criadoEm < desde || jaVoltou.has(m.id)) continue;
    // O que já era repescagem e venceu de novo não volta
    if (m.creditoId && daRepescagem.has(m.creditoId)) continue;
    (porCliente.get(m.clienteId) ?? porCliente.set(m.clienteId, []).get(m.clienteId)!).push(m);
  }
  const clientes = new Map(b.clientes.map((c) => [c.id, c]));
  const podem: Candidata[] = [];
  const fora: Record<string, number> = {};
  for (const [id, exps] of porCliente) {
    const c = clientes.get(id);
    if (!c) continue;
    const valor = arred(exps.reduce((s, e) => s - e.valor, 0));
    if (valor < minimo) {
      fora[`menos de R$ ${minimo}`] = (fora[`menos de R$ ${minimo}`] ?? 0) + 1;
      continue;
    }
    const motivo = motivoBloqueio(b, c, "cashback_repescagem");
    if (motivo) {
      fora[motivo] = (fora[motivo] ?? 0) + 1;
      continue;
    }
    // Loja: a do maior crédito que venceu. Do site, vale no caixa da loja da cidade
    // dela (o cupom do site já foi desativado); sem loja perto fica de fora
    const maior = exps.reduce((a, e) => (e.valor < a.valor ? e : a));
    let loja: string | undefined = lojaDaExpiracao(b, maior, c);
    if (loja === "Site") loja = lojaNaCidade(c);
    if (!loja) {
      fora["do site, sem loja na cidade"] = (fora["do site, sem loja na cidade"] ?? 0) + 1;
      continue;
    }
    podem.push({ cliente: c, loja, valor, expiracoes: exps });
  }
  return { podem, fora };
}

export function previaRepescagem(b: BaseCrm, dias = 60, minimo = 10, hoje = hojeSp()): PreviaRepescagem {
  const { podem, fora } = selecionar(b, dias, minimo, hoje);
  const lojas = new Map<string, { loja: string; clientes: number; valor: number }>();
  for (const x of podem) {
    const l = lojas.get(x.loja) ?? lojas.set(x.loja, { loja: x.loja, clientes: 0, valor: 0 }).get(x.loja)!;
    l.clientes++;
    l.valor = arred(l.valor + x.valor);
  }
  const feitas = b.cashback.filter((m) => m.repescagemDe).sort((a, c) => c.criadoEm.localeCompare(a.criadoEm));
  const diaUltima = feitas[0]?.criadoEm.slice(0, 10);
  const daUltima = diaUltima ? feitas.filter((m) => m.criadoEm.slice(0, 10) === diaUltima) : [];
  return {
    dias,
    minimo,
    clientes: podem.length,
    valor: arred(podem.reduce((s, x) => s + x.valor, 0)),
    validade: somarDias(hoje, DIAS_REPESCAGEM),
    porLoja: [...lojas.values()].sort((a, c) => c.valor - a.valor),
    fora: Object.entries(fora)
      .map(([motivo, n]) => ({ motivo, n }))
      .sort((a, c) => c.n - a.n),
    ultima: daUltima.length ? { em: daUltima[0].criadoEm, clientes: new Set(daUltima.map((m) => m.clienteId)).size, valor: arred(daUltima.reduce((s, m) => s + m.valor, 0)) } : undefined,
  };
}

/**
 * Reativa e avisa. Só reativa de quem o aviso entrou na fila: cashback que
 * volta sem a cliente saber não traz ninguém.
 */
export function fazerRepescagem(b: BaseCrm, dias = 60, minimo = 10, hoje = hojeSp()): { clientes: number; valor: number; naoEntraram: Record<string, number> } {
  const { podem } = selecionar(b, dias, minimo, hoje);
  const validade = somarDias(hoje, DIAS_REPESCAGEM);
  let clientes = 0;
  let valor = 0;
  const naoEntraram: Record<string, number> = {};
  for (const x of podem) {
    const e = enfileirar(b, {
      cliente: x.cliente,
      campanha: "cashback_repescagem",
      loja: x.loja,
      chave: `repescagem-${hoje}-${x.cliente.id}`,
      variaveis: { valor: x.valor, validade },
    });
    if (!e.mensagem) {
      naoEntraram[e.motivo ?? "não entrou"] = (naoEntraram[e.motivo ?? "não entrou"] ?? 0) + 1;
      continue;
    }
    for (const exp of x.expiracoes) {
      b.cashback.push({
        id: novoId(),
        clienteId: x.cliente.id,
        tipo: "ajuste",
        valor: -exp.valor,
        validade,
        loja: x.loja,
        obs: `Repescagem: cashback vencido volta até ${validade}`,
        criadoEm: new Date().toISOString(),
        por: "repescagem",
        repescagemDe: exp.id,
      });
    }
    clientes++;
    valor = arred(valor + x.valor);
  }
  return { clientes, valor, naoEntraram };
}
