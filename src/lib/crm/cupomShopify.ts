/**
 * Cashback do site vira cupom na Shopify, com o mesmo código que vale no
 * caixa da loja. Regra igual à da loja: valor fixo, compra de pelo menos N
 * vezes o cashback (o múltiplo configurado), só pra ela (pelo cadastro da
 * Shopify), uma vez, até a validade. Junta com desconto de produto e frete
 * (promoção, liquidação), não com outro cupom de pedido.
 *
 * - O cupom é criado na hora de mandar o aviso (3 dias depois da compra),
 *   nunca em modo sombra: nada de cupom de verdade que ninguém recebeu.
 * - Usado no site: a leitura de pedidos (a cada 10 min) vê o código no
 *   pedido pago e dá a baixa no cashback.
 * - Usado na loja, devolvido ou gasto de outro jeito: o cupom é desativado
 *   na Shopify, pra não valer duas vezes.
 */

import { env } from "../env";
import "../credenciais";
import { alterarBase, hojeSp, lerBase, novoId, somarDias } from "./base";
import { motivoBloqueio, viaOficial } from "./mensagens";
import { creditosAbertos, gerarCodigo } from "./cashback";
import { creditoLiquidoDaVenda } from "./devolucoes";
import { oficialDe, type BaseCrm, type Cliente, type MovimentoCashback, type TipoCampanha, type Venda } from "./tipos";

const VERSOES = ["2026-10", "2025-01"];

async function shopify(query: string, variables: Record<string, unknown>, versao: string): Promise<{ data?: Record<string, unknown>; errors?: { message: string }[] }> {
  const domain = env("SHOPIFY_STORE_DOMAIN") || "totvs-ibirapuera-viasolbrazil-dc.myshopify.com";
  const res = await fetch(process.env.SHOPIFY_GRAPHQL_URL ?? `https://${domain}/admin/api/${versao}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ADMIN_TOKEN") },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify respondeu ${res.status}`);
  return (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
}

/** Permissões do app da Shopify (cupom precisa de write_discounts). */
export async function escoposShopify(): Promise<string[]> {
  const r = await shopify("{ currentAppInstallation { accessScopes { handle } } }", {}, VERSOES[0]);
  if (r.errors?.length) throw new Error(r.errors.map((e) => e.message).join("; "));
  const inst = r.data?.currentAppInstallation as { accessScopes: { handle: string }[] } | undefined;
  return (inst?.accessScopes ?? []).map((s) => s.handle);
}

const CRIAR = `mutation Cria($d: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } }
}`;

/** Cria o cupom; devolve o id na Shopify ou o erro. */
export async function criarCupom(c: Cliente, codigo: string, valor: number, validade: string, multiplo: number): Promise<{ id?: string; erro?: string }> {
  if (!c.codigoShopify) return { erro: "cliente sem cadastro na Shopify" };
  const cliente = `gid://shopify/Customer/${c.codigoShopify}`;
  const base = {
    title: `Cashback ${c.nome.split(/\s+/)[0]} ${codigo} (R$ ${valor.toFixed(2).replace(".", ",")})`,
    code: codigo,
    startsAt: new Date().toISOString(),
    endsAt: `${validade}T23:59:59-03:00`,
    customerGets: { value: { discountAmount: { amount: valor.toFixed(2), appliesOnEachItem: false } }, items: { all: true } },
    ...(multiplo > 0 ? { minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: (Math.ceil(valor * multiplo * 100) / 100).toFixed(2) } } } : {}),
    usageLimit: 1,
    appliesOncePerCustomer: true,
    combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: true },
  };
  let ultimoErro = "";
  // Versão nova usa `context`; a antiga, `customerSelection`
  for (const [i, versao] of VERSOES.entries()) {
    const d = i === 0 ? { ...base, context: { customers: { add: [cliente] } } } : { ...base, customerSelection: { customers: { add: [cliente] } } };
    try {
      const r = await shopify(CRIAR, { d }, versao);
      if (r.errors?.length) {
        ultimoErro = r.errors.map((e) => e.message).join("; ");
        continue;
      }
      const p = r.data?.discountCodeBasicCreate as { codeDiscountNode?: { id: string }; userErrors: { message: string }[] } | undefined;
      if (p?.userErrors?.length) return { erro: p.userErrors.map((e) => e.message).join("; ") };
      if (p?.codeDiscountNode?.id) return { id: p.codeDiscountNode.id };
      ultimoErro = "resposta sem id";
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
    }
  }
  return { erro: /access|scope|permission/i.test(ultimoErro) ? `sem permissão de cupom (write_discounts): ${ultimoErro}` : ultimoErro };
}

/**
 * Cupom do 2º aviso de carrinho: % em tudo, uma vez, válido até `ate`. Vale pra
 * qualquer cadastro (muita gente fecha como convidada), mas o uso único segura.
 * Não junta com outro cupom.
 */
export async function criarCupomCarrinho(codigo: string, pct: number, ate: string): Promise<{ id?: string; erro?: string }> {
  const base = {
    title: `Carrinho ${codigo} (${pct}%)`,
    code: codigo,
    startsAt: new Date().toISOString(),
    endsAt: ate,
    customerGets: { value: { percentage: pct / 100 }, items: { all: true } },
    usageLimit: 1,
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
  };
  let ultimoErro = "";
  for (const [i, versao] of VERSOES.entries()) {
    const d = i === 0 ? { ...base, context: { all: "ALL" } } : { ...base, customerSelection: { all: true } };
    try {
      const r = await shopify(CRIAR, { d }, versao);
      if (r.errors?.length) {
        ultimoErro = r.errors.map((e) => e.message).join("; ");
        continue;
      }
      const p = r.data?.discountCodeBasicCreate as { codeDiscountNode?: { id: string }; userErrors: { message: string }[] } | undefined;
      if (p?.userErrors?.length) return { erro: p.userErrors.map((e) => e.message).join("; ") };
      if (p?.codeDiscountNode?.id) return { id: p.codeDiscountNode.id };
      ultimoErro = "resposta sem id";
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
    }
  }
  return { erro: ultimoErro };
}

export async function desativarCupom(id: string): Promise<{ ok: boolean; erro?: string }> {
  try {
    const r = await shopify(`mutation D($id: ID!) { discountCodeDeactivate(id: $id) { codeDiscountNode { id } userErrors { message } } }`, { id }, VERSOES[0]);
    if (r.errors?.length) return { ok: false, erro: r.errors.map((e) => e.message).join("; ") };
    const p = r.data?.discountCodeDeactivate as { userErrors: { message: string }[] } | undefined;
    if (p?.userErrors?.length) return { ok: false, erro: p.userErrors.map((e) => e.message).join("; ") };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Campanha de aviso de cashback de um crédito (loja ou site). */
export function campanhaDoCredito(mov: MovimentoCashback, c: Cliente, lojaNaCidade: (c: Cliente) => string | undefined): TipoCampanha {
  if (mov.loja !== "Site") return "cashback_creditado";
  return lojaNaCidade(c) ? "cashback_site_perto" : "cashback_site_longe";
}

/** A campanha está em modo sombra (o das lojas ou o do número oficial)? */
export function sombraDaCampanha(b: BaseCrm, campanha: TipoCampanha, loja?: string): boolean {
  return viaOficial(b, campanha, loja) ? oficialDe(b.config).sombra : b.config.modoSombra;
}

/** Crédito que foi avisado junto com outro da mesma cliente (ela recebe uma mensagem só). */
export const JUNTO = "Junto com outro aviso de cashback";

export interface CreditoParaAviso {
  mov: MovimentoCashback;
  cliente: Cliente;
  venda?: Venda;
  diaDaCompra: string;
  /** O que ainda vale desse crédito (devolução e uso já descontados) */
  valor: number;
}

/**
 * Créditos que já podem ser avisados: compra de pelo menos `cashbackAvisoDias`
 * atrás (dá tempo de trocar ou devolver) e de no máximo 30 dias, com valor
 * ainda em aberto, sem aviso que valha (o simulado só vale em modo sombra).
 */
export function creditosParaAviso(b: BaseCrm, hoje = hojeSp()): CreditoParaAviso[] {
  const dias = b.config.cashbackAvisoDias ?? 3;
  const ate = somarDias(hoje, -dias);
  const desde = somarDias(hoje, -30);
  const porId = new Map(b.clientes.map((c) => [c.id, c]));
  const vendaPorId = new Map(b.vendas.map((v) => [v.id, v]));
  const avisados = new Set(
    b.mensagens
      .filter((m) => m.chave?.startsWith("cb-credito-") && ((m.status !== "cancelada" && m.status !== "erro" && (m.status !== "simulada" || sombraDaCampanha(b, m.campanha, m.loja))) || (m.status === "cancelada" && m.erro === JUNTO)))
      .map((m) => m.chave!.slice("cb-credito-".length))
  );
  const restante = new Map<string, number>();
  const out: CreditoParaAviso[] = [];
  for (const mov of b.cashback) {
    if (mov.tipo !== "credito" || avisados.has(mov.id)) continue;
    const cliente = porId.get(mov.clienteId);
    if (!cliente) continue;
    const venda = mov.vendaId ? vendaPorId.get(mov.vendaId) : undefined;
    const diaDaCompra = (venda?.data ?? mov.criadoEm).slice(0, 10);
    if (diaDaCompra > ate || diaDaCompra < desde) continue;
    if (!restante.has(cliente.id)) for (const c of creditosAbertos(b, cliente.id, hoje)) restante.set(c.movimentoId, c.restante);
    const aberto = restante.get(mov.id) ?? 0;
    const liquido = mov.vendaId ? creditoLiquidoDaVenda(b, mov.vendaId) : mov.valor;
    const valor = Math.round(Math.min(aberto, liquido) * 100) / 100;
    if (valor < 0.01) continue;
    out.push({ mov, cliente, venda, diaDaCompra, valor });
  }
  return out;
}

/**
 * Antes das automações: cria na Shopify o cupom de cada crédito do site que
 * vai ser avisado hoje (fora do modo sombra). Devolve quantos criou e os erros.
 */
export async function prepararCuponsSite(lojaNaCidade: (c: Cliente) => string | undefined): Promise<{ criados: number; erros: string[] }> {
  // Uma rodada por vez (botão clicado duas vezes, agendador junto): senão sai cupom em dobro
  const trava = globalThis as unknown as { __cuponsSite?: Promise<{ criados: number; erros: string[] }> };
  if (trava.__cuponsSite) return trava.__cuponsSite;
  trava.__cuponsSite = criarCuponsSite(lojaNaCidade).finally(() => (trava.__cuponsSite = undefined));
  return trava.__cuponsSite;
}

async function criarCuponsSite(lojaNaCidade: (c: Cliente) => string | undefined): Promise<{ criados: number; erros: string[] }> {
  const r = { criados: 0, erros: [] as string[] };
  if (!env("SHOPIFY_ADMIN_TOKEN")) return r;
  const b = await lerBase();
  const pendentes = creditosParaAviso(b)
    .filter((x) => x.mov.loja === "Site")
    .filter((x) => !sombraDaCampanha(b, campanhaDoCredito(x.mov, x.cliente, lojaNaCidade), lojaNaCidade(x.cliente) ?? x.cliente.lojaOrigem))
    .filter((x) => !b.codigos.some((k) => k.movimentoId === x.mov.id && k.shopifyId))
    // Só cria cupom pra quem vai receber o aviso (com telefone, sem SAIR)
    .filter((x) => !motivoBloqueio(b, x.cliente, campanhaDoCredito(x.mov, x.cliente, lojaNaCidade)));
  for (const x of pendentes) {
    const codigo = gerarCodigo(b);
    const validade = x.mov.validade ?? somarDias(x.diaDaCompra, b.config.cashbackValidadeDias);
    const res = await criarCupom(x.cliente, codigo, x.valor, validade, b.config.cashbackMultiploCompra);
    if (!res.id) {
      r.erros.push(`${x.cliente.nome}: ${res.erro}`);
      continue;
    }
    const repetido = await alterarBase((bb) => {
      if (bb.codigos.some((k) => k.movimentoId === x.mov.id && k.shopifyId)) return true;
      bb.codigos.push({ codigo, clienteId: x.cliente.id, valor: x.valor, campanha: campanhaDoCredito(x.mov, x.cliente, lojaNaCidade), criadoEm: new Date().toISOString(), validade, movimentoId: x.mov.id, shopifyId: res.id });
      return false;
    });
    if (repetido) {
      await desativarCupom(res.id);
      continue;
    }
    r.criados++;
    b.codigos.push({ codigo, clienteId: x.cliente.id, valor: x.valor, criadoEm: "", validade }); // evita repetir o código no mesmo passo
  }
  if (r.erros.length) console.error("[crm] cupons do site:", r.erros.join(" | "));
  return r;
}

interface PedidoComCupom {
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  discountCodes?: string[];
  totalPriceSet: { shopMoney: { amount: string } };
}

const PAGO = new Set(["PAID", "PARTIALLY_REFUNDED", "PARTIALLY_PAID", "AUTHORIZED"]);

/**
 * Pedido pago no site com o cupom de cashback: dá a baixa no CRM. Devolve os
 * cupons que precisam ser desativados na Shopify (usados na loja ou cujo
 * crédito não está mais inteiro).
 */
export function conferirCupons(b: BaseCrm, pedidos: PedidoComCupom[]): { baixas: number; desativar: string[] } {
  let baixas = 0;
  const nossos = new Map(b.codigos.filter((k) => k.shopifyId && !k.usadoEm).map((k) => [k.codigo, k]));
  for (const p of pedidos) {
    if (p.cancelledAt || !PAGO.has(p.displayFinancialStatus ?? "")) continue;
    for (const usado of p.discountCodes ?? []) {
      const k = nossos.get(usado.trim().toUpperCase());
      if (!k) continue;
      k.usadoEm = p.createdAt;
      k.usadoNaLoja = "Site";
      k.compraValor = parseFloat(p.totalPriceSet.shopMoney.amount);
      nossos.delete(k.codigo);
      b.cashback.push({ id: novoId(), clienteId: k.clienteId, tipo: "resgate", valor: -k.valor, loja: "Site", codigo: k.codigo, obs: `Cupom usado no site, pedido ${p.name}`, criadoEm: new Date().toISOString(), por: "site" });
      baixas++;
    }
  }
  // Cupom que não pode mais valer: usado na loja, ou o crédito dele foi gasto, devolvido ou venceu
  const desativar: string[] = [];
  const abertosDe = new Map<string, Map<string, number>>();
  for (const k of b.codigos) {
    if (!k.shopifyId || k.shopifyDesativado || k.usadoNaLoja === "Site") continue;
    let morto = Boolean(k.usadoEm);
    if (!morto && k.movimentoId) {
      if (!abertosDe.has(k.clienteId)) abertosDe.set(k.clienteId, new Map(creditosAbertos(b, k.clienteId).map((c) => [c.movimentoId, c.restante])));
      morto = (abertosDe.get(k.clienteId)!.get(k.movimentoId) ?? 0) < k.valor - 0.01;
    }
    if (morto) desativar.push(k.shopifyId);
  }
  return { baixas, desativar };
}

/** Desativa na Shopify e marca na base. */
export async function desativarCupons(ids: string[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const r = await desativarCupom(id);
    if (!r.ok) {
      console.error("[crm] desativar cupom:", r.erro);
      continue;
    }
    n++;
    await alterarBase((b) => {
      const k = b.codigos.find((x) => x.shopifyId === id);
      if (k) k.shopifyDesativado = true;
    });
  }
  return n;
}
