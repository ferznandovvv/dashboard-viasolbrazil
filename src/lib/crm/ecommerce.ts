/**
 * E-commerce: carrinho abandonado e Pix não pago, pelo número oficial do site.
 *
 * A cada 10 minutos lê na Shopify os checkouts das últimas 26 horas e os
 * pedidos dos últimos 2 dias:
 * - checkout parado há `carrinhoMinutos`, com telefone, sem pedido depois:
 *   uma mensagem com o link do carrinho (uma por checkout, e no máximo uma
 *   a cada `carrinhoIntervaloDias` pra mesma pessoa);
 * - pedido no Pix ainda pendente há `pixMinutos`: um lembrete com o link do
 *   pedido (uma por pedido);
 * - o que estava na fila e a cliente já comprou/pagou é cancelado;
 * - compra que veio depois da mensagem fica anotada nela (o resultado). Em
 *   modo sombra isso mostra quantas comprariam de qualquer jeito.
 */

import { env } from "../env";
import "../credenciais";
import { alterarBase } from "./base";
import { salvarCliente } from "./clientes";
import { enfileirar } from "./mensagens";
import { LOJA_OFICIAL, oficialDe, type BaseCrm, type Cliente, type Mensagem } from "./tipos";
import { normalizarTelefone } from "./telefone";

const API_VERSION = "2024-10";

async function graphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
  const domain = env("SHOPIFY_STORE_DOMAIN") || "totvs-ibirapuera-viasolbrazil-dc.myshopify.com";
  const res = await fetch(`${process.env.SHOPIFY_GRAPHQL_URL ?? `https://${domain}/admin/api/${API_VERSION}/graphql.json`}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ADMIN_TOKEN") },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify respondeu ${res.status}`);
  const json = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data ?? {};
}

interface Pessoa {
  id: string;
  displayName: string | null;
  firstName: string | null;
  email: string | null;
  phone: string | null;
  smsMarketingConsent: { marketingState: string } | null;
}

interface Endereco {
  phone: string | null;
  name: string | null;
  city: string | null;
  provinceCode: string | null;
}

interface Checkout {
  id: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  abandonedCheckoutUrl: string;
  totalPriceSet: { shopMoney: { amount: string } };
  customer: Pessoa | null;
  shippingAddress: Endereco | null;
  billingAddress: Endereco | null;
  lineItems: { nodes: { title: string | null; quantity: number }[] };
}

interface Pedido {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  statusPageUrl: string;
  paymentGatewayNames: string[];
  email: string | null;
  phone: string | null;
  totalPriceSet: { shopMoney: { amount: string } };
  customer: Pessoa | null;
  shippingAddress: Endereco | null;
  billingAddress: Endereco | null;
}

const PESSOA = "id displayName firstName email phone smsMarketingConsent { marketingState }";
const ENDERECO = "phone name city provinceCode";

const Q_CHECKOUTS = `query Carrinhos($query: String!, $cursor: String) {
  abandonedCheckouts(first: 100, query: $query, after: $cursor, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id createdAt updatedAt completedAt abandonedCheckoutUrl
      totalPriceSet { shopMoney { amount } }
      customer { ${PESSOA} }
      shippingAddress { ${ENDERECO} }
      billingAddress { ${ENDERECO} }
      lineItems(first: 5) { nodes { title quantity } }
    }
  }
}`;

const Q_PEDIDOS = `query Pedidos($query: String!, $cursor: String) {
  orders(first: 100, query: $query, after: $cursor, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt displayFinancialStatus statusPageUrl paymentGatewayNames email phone
      totalPriceSet { shopMoney { amount } }
      customer { ${PESSOA} }
      shippingAddress { ${ENDERECO} }
      billingAddress { ${ENDERECO} }
    }
  }
}`;

async function todas<T>(query: string, chave: string, filtro: string, paginas = 5): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let p = 0; p < paginas; p++) {
    const data = await graphql(query, { query: filtro, cursor });
    const c = data[chave] as { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: T[] };
    out.push(...c.nodes);
    if (!c.pageInfo.hasNextPage) break;
    cursor = c.pageInfo.endCursor;
  }
  return out;
}

const idCurto = (gid: string) => gid.split("/").pop()!.split("?")[0];
const PAGO = new Set(["PAID", "PARTIALLY_REFUNDED", "PARTIALLY_PAID", "AUTHORIZED"]);

function telefoneDe(x: { customer: Pessoa | null; shippingAddress: Endereco | null; billingAddress: Endereco | null; phone?: string | null }): string | undefined {
  return normalizarTelefone(x.customer?.phone) ?? normalizarTelefone(x.phone) ?? normalizarTelefone(x.shippingAddress?.phone) ?? normalizarTelefone(x.billingAddress?.phone);
}

const emailDe = (x: { customer: Pessoa | null; email?: string | null }) => (x.customer?.email ?? x.email ?? "").trim().toLowerCase() || undefined;

/** "Biquíni Ana" / "Biquíni Ana e mais 2 peças" */
export function resumoItens(itens: { title: string | null; quantity: number }[]): string {
  const validos = itens.filter((i) => i.title);
  if (!validos.length) return "suas peças";
  const total = validos.reduce((s, i) => s + i.quantity, 0);
  const primeiro = validos[0].title!.replace(/\s+-\s+.*$/, "").trim();
  const resto = total - 1;
  return resto <= 0 ? primeiro : `${primeiro} e mais ${resto} ${resto === 1 ? "peça" : "peças"}`;
}

function clienteDo(b: BaseCrm, x: { customer: Pessoa | null; shippingAddress: Endereco | null; billingAddress: Endereco | null; email?: string | null; phone?: string | null }, telefone: string): Cliente {
  const p = x.customer;
  const nome = (p?.displayName || p?.firstName || x.shippingAddress?.name || x.billingAddress?.name || "").trim() || "Cliente do site";
  return salvarCliente(
    b,
    {
      nome,
      telefone,
      email: emailDe(x),
      codigoShopify: p ? idCurto(p.id) : undefined,
      lojaOrigem: LOJA_OFICIAL,
      // Aceite de mensagem marcado no checkout (o de SMS da Shopify é o que temos)
      optIn: p?.smsMarketingConsent?.marketingState === "SUBSCRIBED",
      cidade: x.shippingAddress?.city ?? undefined,
      uf: x.shippingAddress?.provinceCode ?? undefined,
    },
    "shopify"
  ).cliente;
}

export interface ResultadoEcommerce {
  carrinhos: number;
  pixPendentes: number;
  enfileiradas: number;
  canceladas: number;
  recuperadas: number;
  motivos: Record<string, number>;
  erro?: string;
}

/** Junta o que importa de checkouts e pedidos e põe/cancela mensagens. Separado da busca para testar. */
export function aplicarEcommerce(b: BaseCrm, checkouts: Checkout[], pedidos: Pedido[], agora = Date.now()): ResultadoEcommerce {
  const of = oficialDe(b.config);
  const r: ResultadoEcommerce = { carrinhos: 0, pixPendentes: 0, enfileiradas: 0, canceladas: 0, recuperadas: 0, motivos: {} };
  const motivo = (m: string) => (r.motivos[m] = (r.motivos[m] ?? 0) + 1);
  const minutos = (iso: string) => (agora - Date.parse(iso)) / 60000;

  // Pedidos por telefone/e-mail (pra saber se o carrinho virou compra)
  const pedidosDe = new Map<string, Pedido[]>();
  for (const p of pedidos) {
    for (const k of [telefoneDe(p), emailDe(p)]) if (k) (pedidosDe.get(k) ?? pedidosDe.set(k, []).get(k)!).push(p);
  }
  const pedidoDepois = (tel: string | undefined, email: string | undefined, desde: string) =>
    [tel, email].flatMap((k) => (k ? (pedidosDe.get(k) ?? []) : [])).find((p) => !p.cancelledAt && Date.parse(p.createdAt) >= Date.parse(desde) - 5 * 60000);

  // 1. Carrinho abandonado
  const naoAntes = new Date(agora - of.carrinhoIntervaloDias * 86400000).toISOString();
  for (const ck of checkouts) {
    if (ck.completedAt) continue;
    const parado = minutos(ck.updatedAt);
    if (parado > 24 * 60) continue;
    r.carrinhos++;
    const tel = telefoneDe(ck);
    if (!tel) {
      motivo("carrinho sem telefone");
      continue;
    }
    if (parado < of.carrinhoMinutos) {
      motivo("carrinho esperando o tempo");
      continue;
    }
    if (parseFloat(ck.totalPriceSet.shopMoney.amount) < of.carrinhoMinimo) {
      motivo("carrinho abaixo do mínimo");
      continue;
    }
    if (pedidoDepois(tel, emailDe(ck), ck.createdAt)) {
      motivo("carrinho virou pedido");
      continue;
    }
    const chave = `carrinho-${idCurto(ck.id)}`;
    if (b.mensagens.some((m) => m.chave === chave)) continue;
    const c = clienteDo(b, ck, tel);
    if (b.mensagens.some((m) => m.clienteId === c.id && m.campanha === "carrinho_abandonado" && m.criadoEm >= naoAntes && m.status !== "cancelada")) {
      motivo("já recebeu carrinho há pouco");
      continue;
    }
    const e = enfileirar(b, {
      cliente: c,
      campanha: "carrinho_abandonado",
      chave,
      variaveis: { valor: parseFloat(ck.totalPriceSet.shopMoney.amount), itens: resumoItens(ck.lineItems.nodes), link: ck.abandonedCheckoutUrl },
    });
    if (e.mensagem) r.enfileiradas++;
    else motivo(`carrinho: ${e.motivo}`);
  }

  // 2. Pix (ou outro pagamento) pendente
  for (const p of pedidos) {
    if (p.cancelledAt || p.displayFinancialStatus !== "PENDING") continue;
    const ehPix = p.paymentGatewayNames.some((g) => /pix/i.test(g));
    if (!ehPix && !of.pagamentoTodos) continue;
    const idade = minutos(p.createdAt);
    if (idade > 24 * 60) continue;
    r.pixPendentes++;
    if (idade < of.pixMinutos) {
      motivo("Pix esperando o tempo");
      continue;
    }
    const tel = telefoneDe(p);
    if (!tel) {
      motivo("Pix sem telefone");
      continue;
    }
    const chave = `pix-${idCurto(p.id)}`;
    if (b.mensagens.some((m) => m.chave === chave)) continue;
    const e = enfileirar(b, {
      cliente: clienteDo(b, p, tel),
      campanha: "pix_pendente",
      chave,
      variaveis: { valor: parseFloat(p.totalPriceSet.shopMoney.amount), pedido: p.name, link: p.statusPageUrl },
    });
    if (e.mensagem) r.enfileiradas++;
    else motivo(`Pix: ${e.motivo}`);
  }

  // 3. Na fila e já resolvido: não manda
  const porId = new Map(pedidos.map((p) => [idCurto(p.id), p]));
  const porCheckout = new Map(checkouts.map((c) => [idCurto(c.id), c]));
  for (const m of b.mensagens) {
    if (m.status !== "fila" || !m.chave) continue;
    if (m.chave.startsWith("pix-")) {
      const p = porId.get(m.chave.slice(4));
      if (p && (p.cancelledAt || PAGO.has(p.displayFinancialStatus ?? ""))) {
        m.status = "cancelada";
        m.erro = p.cancelledAt ? "Pedido cancelado" : "Já pagou";
        r.canceladas++;
      }
    } else if (m.chave.startsWith("carrinho-")) {
      const ck = porCheckout.get(m.chave.slice(9));
      const cli = b.clientes.find((c) => c.id === m.clienteId);
      if (ck?.completedAt || (ck && pedidoDepois(cli?.telefone, cli?.email?.toLowerCase(), ck.createdAt))) {
        m.status = "cancelada";
        m.erro = "Já comprou";
        r.canceladas++;
      }
    }
  }

  // 4. Resultado: pedido pago depois da mensagem (até 3 dias), pelo telefone ou e-mail dela
  const pagos = pedidos.filter((p) => !p.cancelledAt && PAGO.has(p.displayFinancialStatus ?? ""));
  const desde = new Date(agora - 3 * 86400000).toISOString();
  for (const m of b.mensagens) {
    if (m.resultado || m.provedor !== "oficial" || m.criadoEm < desde) continue;
    if (m.status === "cancelada" || m.status === "erro" || m.status === "fila") continue;
    const cli = b.clientes.find((c) => c.id === m.clienteId);
    const quando = m.enviadoEm ?? m.criadoEm;
    const pedido = m.chave?.startsWith("pix-")
      ? pagos.find((p) => idCurto(p.id) === m.chave!.slice(4))
      : pagos.find((p) => Date.parse(p.createdAt) >= Date.parse(quando) && Date.parse(p.createdAt) - Date.parse(quando) <= 3 * 86400000 && (telefoneDe(p) === m.telefone || (cli?.email && emailDe(p) === cli.email.toLowerCase())));
    if (pedido) {
      m.resultado = { pedido: pedido.name, valor: parseFloat(pedido.totalPriceSet.shopMoney.amount), em: pedido.createdAt };
      r.recuperadas++;
    }
  }
  return r;
}

let rodando = false;
/** Último resultado, para a tela. No globalThis: o agendador e as rotas podem ter cópias separadas do módulo. */
const memoria = globalThis as unknown as { __ultimoEcommerce?: ResultadoEcommerce & { em: string } };
const guardar = (r: ResultadoEcommerce & { em: string }) => (memoria.__ultimoEcommerce = r);

/** Passo do agendador (a cada 10 min). */
export async function conferirEcommerce(): Promise<ResultadoEcommerce | null> {
  if (rodando || !env("SHOPIFY_ADMIN_TOKEN")) return null;
  rodando = true;
  try {
    const agora = Date.now();
    const desde = new Date(agora - 26 * 3600000).toISOString();
    const desdePedidos = new Date(agora - 4 * 86400000).toISOString();
    let checkouts: Checkout[] = [];
    let pedidos: Pedido[] = [];
    let erro: string | undefined;
    try {
      [checkouts, pedidos] = await Promise.all([
        todas<Checkout>(Q_CHECKOUTS, "abandonedCheckouts", `created_at:>='${desde}'`),
        todas<Pedido>(Q_PEDIDOS, "orders", `created_at:>='${desdePedidos}'`, 10),
      ]);
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
    if (erro) {
      return guardar({ carrinhos: 0, pixPendentes: 0, enfileiradas: 0, canceladas: 0, recuperadas: 0, motivos: {}, erro, em: new Date().toISOString() });
    }
    const r = await alterarBase((b) => aplicarEcommerce(b, checkouts, pedidos, agora));
    guardar({ ...r, em: new Date().toISOString() });
    return r;
  } finally {
    rodando = false;
  }
}

export interface ResumoEcommerce {
  dias: number;
  carrinho: { mensagens: number; simuladas: number; compraram: number; valor: number };
  pix: { mensagens: number; simuladas: number; pagaram: number; valor: number };
  ultimo: (ResultadoEcommerce & { em: string }) | null;
  sombra: boolean;
  configurado: boolean;
}

/** Números do e-commerce para a tela principal. */
export function resumoEcommerce(b: BaseCrm, dias = 7): ResumoEcommerce {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const of = oficialDe(b.config);
  const vazio = () => ({ mensagens: 0, simuladas: 0, compraram: 0, valor: 0 });
  const car = vazio();
  const pix = vazio();
  const conta = (alvo: typeof car, m: Mensagem) => {
    if (m.status === "simulada") alvo.simuladas++;
    else if (!["cancelada", "erro", "fila", "enviando"].includes(m.status)) alvo.mensagens++;
    else return;
    if (m.resultado) {
      alvo.compraram++;
      alvo.valor += m.resultado.valor;
    }
  };
  for (const m of b.mensagens) {
    if (m.criadoEm < desde || m.provedor !== "oficial") continue;
    if (m.campanha === "carrinho_abandonado") conta(car, m);
    if (m.campanha === "pix_pendente") conta(pix, m);
  }
  return {
    dias,
    carrinho: { ...car, valor: Math.round(car.valor) },
    pix: { mensagens: pix.mensagens, simuladas: pix.simuladas, pagaram: pix.compraram, valor: Math.round(pix.valor) },
    ultimo: memoria.__ultimoEcommerce ?? null,
    sombra: of.sombra,
    configurado: Boolean(of.token && of.phoneNumberId),
  };
}

