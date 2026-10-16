/**
 * Clientes: cadastro, deduplicação e os números que a tela e as automações
 * usam (saldo, última compra, total gasto, segmento).
 */

import { diasEntre, hojeSp, novoId, somarDias } from "./base";
import { creditarVenda, saldoDe, vencendoAte } from "./cashback";
import type { BaseCrm, Cliente, ClienteResumo, Venda } from "./tipos";
import { normalizarCpf, normalizarData, normalizarTelefone } from "./telefone";

export interface DadosCliente {
  nome: string;
  telefone?: string;
  cpf?: string;
  email?: string;
  nascimento?: string;
  lojaOrigem?: string;
  codigoTotvs?: string;
  codigoShopify?: string;
  optIn?: boolean;
  obs?: string;
}

const limpo = (s?: string) => (s ?? "").trim();
const chaveNome = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Acha a cliente por telefone, CPF, código TOTVS, id Shopify ou e-mail (nome sozinho não basta). */
export function acharCliente(base: BaseCrm, d: Partial<DadosCliente>): Cliente | undefined {
  const tel = normalizarTelefone(d.telefone);
  const cpf = normalizarCpf(d.cpf);
  const cod = limpo(d.codigoTotvs);
  const shop = limpo(d.codigoShopify);
  const email = limpo(d.email).toLowerCase();
  return (
    base.clientes.find((c) => (tel && c.telefone === tel) || (cpf && c.cpf === cpf) || (cod && c.codigoTotvs === cod) || (shop && c.codigoShopify === shop)) ??
    (email ? base.clientes.find((c) => c.email?.toLowerCase() === email) : undefined)
  );
}

/** Acha pelo nome exato normalizado, só quando a nota não traz nada melhor. */
export function acharPorNome(base: BaseCrm, nome: string): Cliente | undefined {
  const k = chaveNome(nome);
  if (k.split(" ").length < 2) return undefined; // nome só não identifica
  const candidatos = base.clientes.filter((c) => chaveNome(c.nome) === k);
  return candidatos.length === 1 ? candidatos[0] : undefined;
}

/**
 * Cria ou completa uma cliente. Nunca apaga dado que já existe com dado vazio;
 * dado novo preenche o que faltava. Devolve a cliente e se foi criada agora.
 */
export function salvarCliente(base: BaseCrm, d: DadosCliente, origem: "totvs" | "shopify" | "csv" | "loja" | "painel"): { cliente: Cliente; nova: boolean } {
  const agora = new Date().toISOString();
  const tel = normalizarTelefone(d.telefone);
  const cpf = normalizarCpf(d.cpf);
  const nasc = normalizarData(d.nascimento);
  const nome = limpo(d.nome);
  let c = acharCliente(base, d);
  if (!c && origem === "totvs" && nome) c = acharPorNome(base, nome);
  if (c) {
    if (nome && (!c.nome || c.nome.length < nome.length)) c.nome = nome;
    c.telefone ??= tel;
    c.cpf ??= cpf;
    c.email ??= limpo(d.email) || undefined;
    c.nascimento ??= nasc;
    c.lojaOrigem ??= limpo(d.lojaOrigem) || undefined;
    c.codigoTotvs ??= limpo(d.codigoTotvs) || undefined;
    c.codigoShopify ??= limpo(d.codigoShopify) || undefined;
    if (d.optIn) c.optIn = true;
    if (limpo(d.obs)) c.obs = limpo(d.obs);
    c.atualizadoEm = agora;
    return { cliente: c, nova: false };
  }
  if (!nome) throw new Error("Nome é obrigatório.");
  const nova: Cliente = {
    id: novoId(),
    nome,
    telefone: tel,
    cpf,
    email: limpo(d.email) || undefined,
    nascimento: nasc,
    lojaOrigem: limpo(d.lojaOrigem) || undefined,
    codigoTotvs: limpo(d.codigoTotvs) || undefined,
    codigoShopify: limpo(d.codigoShopify) || undefined,
    // Quem compra na loja ou no site aceita contato no cadastro; só fica de
    // fora quem pedir (optOut) ou, na Shopify, quem cancelou o SMS
    optIn: d.optIn ?? true,
    semResposta: 0,
    criadoEm: agora,
    atualizadoEm: agora,
    obs: limpo(d.obs) || undefined,
  };
  base.clientes.push(nova);
  return { cliente: nova, nova: true };
}

/**
 * Registra uma venda (sem repetir a mesma) e credita o cashback quando a
 * cliente está identificada. Devolve se a venda era nova.
 */
export function registrarVenda(base: BaseCrm, v: Venda): boolean {
  const existente = base.vendas.find((x) => x.id === v.id);
  if (existente) {
    existente.vendedoraCpf ??= v.vendedoraCpf;
    // Venda que chegou antes sem cliente e agora conseguimos ligar
    if (!existente.clienteId && v.clienteId) {
      existente.clienteId = v.clienteId;
      const c = base.clientes.find((x) => x.id === v.clienteId);
      if (c) creditarVenda(base, existente, c);
    }
    return false;
  }
  base.vendas.push(v);
  if (v.clienteId) {
    const c = base.clientes.find((x) => x.id === v.clienteId);
    if (c) creditarVenda(base, v, c);
  }
  return true;
}

/** Vendas sem cliente cujo nome agora bate com alguém: tenta ligar. */
export function conciliarVendas(base: BaseCrm): number {
  let n = 0;
  for (const v of base.vendas) {
    if (v.clienteId) continue;
    const c =
      (v.codigoClienteTotvs && base.clientes.find((x) => x.codigoTotvs === v.codigoClienteTotvs)) ||
      (v.cpfNaNota && base.clientes.find((x) => x.cpf === v.cpfNaNota)) ||
      (v.nomeNaNota ? acharPorNome(base, v.nomeNaNota) : undefined);
    if (c) {
      v.clienteId = c.id;
      creditarVenda(base, v, c);
      n++;
    }
  }
  return n;
}

export function podeMarketing(base: BaseCrm, c: Cliente): boolean {
  return Boolean(c.telefone && c.optIn && !c.optOut && c.semResposta < base.config.maxSemResposta);
}

/** Cliente com os números calculados. */
export function resumir(base: BaseCrm, c: Cliente, hoje = hojeSp()): ClienteResumo {
  const vendas = base.vendas.filter((v) => v.clienteId === c.id).sort((a, b) => b.data.localeCompare(a.data));
  const venc = vencendoAte(base, c.id, somarDias(hoje, base.config.avisoVencimentoDias), hoje);
  const ultimaMsg = base.mensagens
    .filter((m) => m.clienteId === c.id && m.status !== "cancelada")
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0];
  return {
    ...c,
    saldo: saldoDe(base, c.id, hoje),
    vencendo: venc.valor,
    vencendoEm: venc.em,
    totalGasto: Math.round(vendas.reduce((s, v) => s + v.valor, 0) * 100) / 100,
    compras: vendas.length,
    ultimaCompra: vendas[0]?.data.slice(0, 10),
    ultimaLoja: vendas[0]?.loja,
    ultimaMensagem: ultimaMsg?.criadoEm.slice(0, 10),
    podeMarketing: podeMarketing(base, c),
  };
}

export type Segmento =
  | "todos"
  | "aniversariantes"
  | "inativas"
  | "cashback_vencendo"
  | "com_saldo"
  | "compraram_recente"
  | "sem_telefone"
  | "funcionarias"
  | "opt_out";

export const SEGMENTOS: { id: Segmento; nome: string; dica: string }[] = [
  { id: "todos", nome: "Todas", dica: "A base inteira" },
  { id: "aniversariantes", nome: "Aniversariantes do mês", dica: "Fazem aniversário neste mês" },
  { id: "inativas", nome: "Boas clientes paradas", dica: "Gastaram acima do mínimo e não compram há tempo" },
  { id: "cashback_vencendo", nome: "Cashback vencendo", dica: "Têm crédito que vence nos próximos dias" },
  { id: "com_saldo", nome: "Com saldo", dica: "Têm cashback disponível" },
  { id: "compraram_recente", nome: "Compraram nos últimos 30 dias", dica: "" },
  { id: "sem_telefone", nome: "Sem telefone", dica: "Não dá pra mandar mensagem; completar no caixa" },
  { id: "funcionarias", nome: "Funcionárias", dica: "Cadastro com nome de funcionária ou venda registrada pela própria vendedora no CPF dela" },
  { id: "opt_out", nome: "Pediram para não receber", dica: "" },
];

export function noSegmento(base: BaseCrm, r: ClienteResumo, seg: Segmento, hoje = hojeSp()): boolean {
  const cfg = base.config;
  switch (seg) {
    case "todos":
      return true;
    case "aniversariantes":
      return Boolean(r.nascimento && r.nascimento.slice(5, 7) === hoje.slice(5, 7));
    case "inativas":
      return (
        r.totalGasto >= cfg.reativacaoTicketMinimo &&
        Boolean(r.ultimaCompra) &&
        diasEntre(r.ultimaCompra!, hoje) >= cfg.reativacaoDias
      );
    case "cashback_vencendo":
      return r.vencendo > 0;
    case "com_saldo":
      return r.saldo > 0;
    case "compraram_recente":
      return Boolean(r.ultimaCompra) && diasEntre(r.ultimaCompra!, hoje) <= 30;
    case "sem_telefone":
      return !r.telefone;
    case "funcionarias":
      return Boolean(r.obs && /Funcionária/.test(r.obs));
    case "opt_out":
      return Boolean(r.optOut);
  }
}

export function listarSegmento(base: BaseCrm, seg: Segmento, loja?: string): ClienteResumo[] {
  const hoje = hojeSp();
  return base.clientes
    .map((c) => resumir(base, c, hoje))
    .filter((r) => noSegmento(base, r, seg, hoje))
    .filter((r) => !loja || r.lojaOrigem === loja || r.ultimaLoja === loja)
    .sort((a, b) => b.totalGasto - a.totalGasto);
}
