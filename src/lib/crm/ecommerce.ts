/**
 * E-commerce: carrinho abandonado e Pix não pago, pelo número oficial do site.
 *
 * A cada 10 minutos lê na Shopify os checkouts das últimas 26 horas e os
 * pedidos dos últimos 2 dias:
 * - checkout parado há `carrinhoMinutos`, com telefone, sem pedido depois:
 *   uma mensagem com o link do carrinho (uma por checkout, e no máximo uma
 *   a cada `carrinhoIntervaloDias` pra mesma pessoa);
 * - pedido no Pix ainda pendente há `pixMinutos`: um lembrete com o código Pix
 *   copia e cola (mandado logo depois, sozinho), enquanto ele vale (o da
 *   PagBrasil vence em 30 min);
 * - Pix que venceu sem lembrete (de noite, por exemplo) e ela não comprou de
 *   novo: uma mensagem com o carrinho montado pra refazer o pedido. Uma
 *   mensagem por pedido, nunca as duas;
 * - o que estava na fila e a cliente já comprou/pagou é cancelado;
 * - compra que veio depois da mensagem fica anotada nela (o resultado). Em
 *   modo sombra isso mostra quantas comprariam de qualquer jeito.
 */

import { env } from "../env";
import "../credenciais";
import { alterarBase, lerBase } from "./base";
import { salvarCliente } from "./clientes";
import { enfileirar, viaOficial } from "./mensagens";
import { conferirCupons, criarCupomCarrinho, desativarCupons, escoposShopify } from "./cupomShopify";
import { gerarCodigo } from "./cashback";
import { CloudApi } from "./envio/cloudApi";

/** Confere uma vez por processo as permissões do app da Shopify e guarda na base. */
let escoposConferidos = false;
async function conferirEscopos() {
  if (escoposConferidos) return;
  escoposConferidos = true;
  try {
    const escopos = await escoposShopify();
    await alterarBase((b) => {
      b.config.shopifyEscopos = escopos;
    });
    if (!escopos.includes("write_discounts")) console.error("[crm] Shopify: falta write_discounts, o cupom de cashback do site não vai ser criado");
  } catch (e) {
    console.error("[crm] Shopify: não consegui ler as permissões:", e instanceof Error ? e.message : e);
  }
}
import { CAMPANHAS_SITE, LOJA_OFICIAL, oficialDe, type BaseCrm, type Cliente, type Mensagem, type TipoCampanha } from "./tipos";
import { normalizarTelefone } from "./telefone";

/**
 * Versão nova primeiro (traz o aceite de WhatsApp marcado no checkout); se a
 * loja recusar, a antiga, que só tem o aceite de SMS.
 */
const VERSAO_NOVA = "2026-10";
const VERSAO_ANTIGA = "2024-10";
let versaoQueFunciona: string | null = null;

async function graphql(query: string, variables: Record<string, unknown>, versao: string): Promise<Record<string, unknown>> {
  const domain = env("SHOPIFY_STORE_DOMAIN") || "totvs-ibirapuera-viasolbrazil-dc.myshopify.com";
  const res = await fetch(`${process.env.SHOPIFY_GRAPHQL_URL ?? `https://${domain}/admin/api/${versao}/graphql.json`}`, {
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
  smsMarketingConsent?: { marketingState: string } | null;
  defaultPhoneNumber?: { marketingState?: string | null; whatsAppMarketingConsent?: { state: string } | null } | null;
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
  discountCodes?: string[];
  email: string | null;
  phone: string | null;
  totalPriceSet: { shopMoney: { amount: string } };
  customer: Pessoa | null;
  shippingAddress: Endereco | null;
  billingAddress: Endereco | null;
  customAttributes?: { key: string; value: string | null }[];
  lineItems?: { nodes: { title: string | null; quantity: number; variant: { id: string } | null }[] };
}

const PESSOA_NOVA = "id displayName firstName email phone defaultPhoneNumber { marketingState whatsAppMarketingConsent { state } }";
const PESSOA_ANTIGA = "id displayName firstName email phone smsMarketingConsent { marketingState }";
const PESSOA = "__PESSOA__";
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
      id name createdAt cancelledAt displayFinancialStatus statusPageUrl paymentGatewayNames email phone discountCodes
      totalPriceSet { shopMoney { amount } }
      customAttributes { key value }
      lineItems(first: 20) { nodes { title quantity variant { id } } }
      customer { ${PESSOA} }
      shippingAddress { ${ENDERECO} }
      billingAddress { ${ENDERECO} }
    }
  }
}`;

async function todas<T>(query: string, chave: string, filtro: string, paginas = 5): Promise<T[]> {
  try {
    if (versaoQueFunciona !== VERSAO_ANTIGA) {
      const r = await todasNa<T>(query.replaceAll(PESSOA, PESSOA_NOVA), chave, filtro, paginas, VERSAO_NOVA);
      versaoQueFunciona = VERSAO_NOVA;
      return r;
    }
  } catch (e) {
    if (versaoQueFunciona === VERSAO_NOVA) throw e;
    versaoQueFunciona = VERSAO_ANTIGA;
  }
  return todasNa<T>(query.replaceAll(PESSOA, PESSOA_ANTIGA), chave, filtro, paginas, VERSAO_ANTIGA);
}

async function todasNa<T>(query: string, chave: string, filtro: string, paginas: number, versao: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let p = 0; p < paginas; p++) {
    const data = await graphql(query, { query: filtro, cursor }, versao);
    const c = data[chave] as { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: T[] };
    out.push(...c.nodes);
    if (!c.pageInfo.hasNextPage) break;
    cursor = c.pageInfo.endCursor;
  }
  return out;
}

const idCurto = (gid: string) => gid.split("/").pop()!.split("?")[0];

const atributo = (p: Pedido, chave: string) => p.customAttributes?.find((a) => a.key === chave)?.value?.trim() || undefined;

/** Código Pix copia e cola e quando vence (a PagBrasil grava no pedido, hora de Brasília). */
export function pixDoPedido(p: Pedido): { codigo?: string; expira?: number; hora?: string } {
  const codigo = atributo(p, "payment_additional_pix_code");
  const data = atributo(p, "payment_additional_pix_expiration_date")?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const hora = atributo(p, "payment_additional_pix_expiration_time")?.match(/^(\d{2}):(\d{2})/);
  const expira = data && hora ? Date.parse(`${data[3]}-${data[2]}-${data[1]}T${hora[1]}:${hora[2]}:00-03:00`) : NaN;
  return { codigo, expira: Number.isNaN(expira) ? undefined : expira, hora: hora ? `${hora[1]}:${hora[2]}` : undefined };
}

/** Link que monta o carrinho de novo com as peças do pedido (variante:quantidade). */
export function linkRefazer(urlBase: string, p: Pedido): string | undefined {
  const itens = (p.lineItems?.nodes ?? []).filter((i) => i.variant?.id && i.quantity > 0);
  if (!itens.length) return undefined;
  return `${urlBase.replace(/\/+$/, "")}/cart/${itens.map((i) => `${idCurto(i.variant!.id)}:${i.quantity}`).join(",")}`;
}

/**
 * Página do site (pages/pix) que mostra o código copia e cola, o QR e até que
 * horas vale: a página do pedido da Shopify não mostra o Pix, e pelo número
 * oficial não dá pra mandar o código numa mensagem solta.
 */
export function linkPagarPix(urlBase: string, codigo: string, pedido: string, valor: number, expira?: number, refazer?: string): string {
  const q = new URLSearchParams({ c: codigo, p: pedido, v: `R$ ${valor.toFixed(2).replace(".", ",")}` });
  if (expira) q.set("e", String(expira));
  if (refazer) {
    try {
      q.set("r", new URL(refazer).pathname);
    } catch {
      /* sem link de refazer */
    }
  }
  return `${urlBase.replace(/\/+$/, "")}/pages/pix?${q.toString()}`;
}

/** Folga antes de o Pix vencer: menos que isso não adianta mandar o código. */
const FOLGA_PIX_MIN = 4;
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
      optIn: [p?.defaultPhoneNumber?.whatsAppMarketingConsent?.state, p?.defaultPhoneNumber?.marketingState, p?.smsMarketingConsent?.marketingState].includes("SUBSCRIBED"),
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

/** "Ela fez pedido depois de `desde`?" pelo telefone ou e-mail, nos pedidos lidos. */
function indicePedidos(pedidos: Pedido[]) {
  const pedidosDe = new Map<string, Pedido[]>();
  for (const p of pedidos) {
    for (const k of [telefoneDe(p), emailDe(p)]) if (k) (pedidosDe.get(k) ?? pedidosDe.set(k, []).get(k)!).push(p);
  }
  const pedidoDepois = (tel: string | undefined, email: string | undefined, desde: string) =>
    [tel, email].flatMap((k) => (k ? (pedidosDe.get(k) ?? []) : [])).find((p) => !p.cancelledAt && Date.parse(p.createdAt) >= Date.parse(desde) - 5 * 60000);
  return { pedidosDe, pedidoDepois };
}

/** Janela pra mandar o 2º aviso depois do 1º: passou do prazo, mas não muito (senão é carrinho velho). */
const FOLGA_2O_AVISO_H = 12;
const VALIDADE_CUPOM_CARRINHO_H = 48;

/**
 * Carrinhos que já podem receber o 2º aviso (com cupom): o 1º saiu (ou foi
 * simulado, em sombra) há `carrinhoCupomHoras`, ela não respondeu, não comprou
 * e ainda não recebeu o 2º. Usado antes (pra criar os cupons na Shopify) e
 * dentro de aplicarEcommerce (pra enfileirar só o que tem cupom).
 */
export function carrinhosParaCupom(b: BaseCrm, checkouts: Checkout[], pedidos: Pedido[], agora = Date.now()): Checkout[] {
  const of = oficialDe(b.config);
  const pct = of.carrinhoCupomPct ?? 0;
  if (pct <= 0 || !b.modelos.find((m) => m.campanha === "carrinho_cupom")?.ativo) return [];
  const horas = of.carrinhoCupomHoras ?? 24;
  const { pedidoDepois } = indicePedidos(pedidos);
  const sombra = viaOficial(b, "carrinho_cupom") ? of.sombra : b.config.modoSombra;
  const saiu = new Set<string>(["enviada", "entregue", "lida", ...(sombra ? ["simulada"] : [])]);
  return checkouts.filter((ck) => {
    if (ck.completedAt) return false;
    const id = idCurto(ck.id);
    const primeiro = b.mensagens.find((m) => m.chave === `carrinho-${id}` && saiu.has(m.status));
    if (!primeiro) return false;
    const h = (agora - Date.parse(primeiro.enviadoEm ?? primeiro.criadoEm)) / 3600000;
    if (h < horas || h > horas + FOLGA_2O_AVISO_H) return false;
    if (b.mensagens.some((m) => m.chave === `carrinho2-${id}`)) return false;
    if (pedidoDepois(telefoneDe(ck), emailDe(ck), ck.createdAt)) return false;
    return true;
  });
}

/** Link do botão: aplica o cupom e volta pro carrinho dela. */
export function linkComCupom(urlBase: string, codigo: string, carrinho: string): string {
  let volta = "/cart";
  try {
    const u = new URL(carrinho);
    // O checkout também aceita ?discount=CÓDIGO: vai pelos dois caminhos
    u.searchParams.set("discount", codigo);
    volta = `${u.pathname}${u.search}`;
  } catch {
    /* fica no /cart */
  }
  return `${urlBase.replace(/\/+$/, "")}/discount/${encodeURIComponent(codigo)}?redirect=${encodeURIComponent(volta)}`;
}

/** Junta o que importa de checkouts e pedidos e põe/cancela mensagens. Separado da busca para testar. */
export function aplicarEcommerce(b: BaseCrm, checkouts: Checkout[], pedidos: Pedido[], agora = Date.now(), cupons: Record<string, string> = {}): ResultadoEcommerce {
  const of = oficialDe(b.config);
  const r: ResultadoEcommerce = { carrinhos: 0, pixPendentes: 0, enfileiradas: 0, canceladas: 0, recuperadas: 0, motivos: {} };
  const motivo = (m: string) => (r.motivos[m] = (r.motivos[m] ?? 0) + 1);
  const minutos = (iso: string) => (agora - Date.parse(iso)) / 60000;

  // Pedidos por telefone/e-mail (pra saber se o carrinho virou compra)
  const { pedidosDe, pedidoDepois } = indicePedidos(pedidos);

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

  // 1b. 2º aviso do carrinho, com cupom (o cupom já foi criado na Shopify, ou é simulado)
  const of2 = oficialDe(b.config);
  for (const ck of carrinhosParaCupom(b, checkouts, pedidos, agora)) {
    const id = idCurto(ck.id);
    const codigo = cupons[id];
    if (!codigo) {
      motivo("carrinho 2º aviso: sem cupom");
      continue;
    }
    const tel = telefoneDe(ck);
    if (!tel) continue;
    const e = enfileirar(b, {
      cliente: clienteDo(b, ck, tel),
      campanha: "carrinho_cupom",
      chave: `carrinho2-${id}`,
      variaveis: {
        valor: parseFloat(ck.totalPriceSet.shopMoney.amount),
        itens: resumoItens(ck.lineItems.nodes),
        oferta: `${of2.carrinhoCupomPct}%`,
        codigo,
        link: linkComCupom(of2.urlBase, codigo, ck.abandonedCheckoutUrl),
      },
    });
    if (e.mensagem) r.enfileiradas++;
    else motivo(`carrinho 2º aviso: ${e.motivo}`);
  }

  // 2. Pix (ou outro pagamento) pendente
  const pagou = (x: Pedido) => !x.cancelledAt && PAGO.has(x.displayFinancialStatus ?? "");
  /** Ela fez outro pedido pago depois deste (refez com cartão, por exemplo) */
  const comprouDeNovo = (p: Pedido) =>
    [telefoneDe(p), emailDe(p)].flatMap((k) => (k ? (pedidosDe.get(k) ?? []) : [])).some((x) => x.id !== p.id && pagou(x) && x.createdAt > p.createdAt);
  /** Ela já fez outro pedido depois deste, pago ou não (refez o Pix, trocou peça): o lembrete vai só do mais novo */
  const refez = (p: Pedido) =>
    [telefoneDe(p), emailDe(p)].flatMap((k) => (k ? (pedidosDe.get(k) ?? []) : [])).some((x) => x.id !== p.id && !x.cancelledAt && x.createdAt > p.createdAt);
  const venceu = (p: Pedido, folgaMin: number) => {
    const { expira } = pixDoPedido(p);
    return expira ? agora >= expira - folgaMin * 60000 : minutos(p.createdAt) >= 30;
  };
  for (const p of pedidos) {
    if (p.cancelledAt || !["PENDING", "EXPIRED"].includes(p.displayFinancialStatus ?? "")) continue;
    const ehPix = p.paymentGatewayNames.some((g) => /pix/i.test(g));
    if (!ehPix && !of.pagamentoTodos) continue;
    const idade = minutos(p.createdAt);
    if (idade > 24 * 60) continue;
    r.pixPendentes++;
    if (comprouDeNovo(p)) {
      motivo("Pix: comprou de novo");
      continue;
    }
    if (refez(p)) {
      motivo("Pix: refez o pedido (lembrete só do mais novo)");
      continue;
    }
    const tel = telefoneDe(p);
    if (!tel) {
      motivo("Pix sem telefone");
      continue;
    }
    const id = idCurto(p.id);
    const pix = pixDoPedido(p);
    const valor = parseFloat(p.totalPriceSet.shopMoney.amount);
    if (!venceu(p, FOLGA_PIX_MIN) && pix.codigo) {
      // Ainda vale: lembrete com o código copia e cola
      if (idade < of.pixMinutos) {
        motivo("Pix esperando o tempo");
        continue;
      }
      const chave = `pix-${id}`;
      if (b.mensagens.some((m) => m.chave === chave)) continue;
      const e = enfileirar(b, {
        cliente: clienteDo(b, p, tel),
        campanha: "pix_pendente",
        chave,
        variaveis: { valor, pedido: p.name, link: linkPagarPix(of.urlBase, pix.codigo, p.name, valor, pix.expira, linkRefazer(of.urlBase, p)), expira: pix.hora },
        complemento: pix.codigo,
      });
      if (e.mensagem) r.enfileiradas++;
      else motivo(`Pix: ${e.motivo}`);
      continue;
    }
    if (!venceu(p, 0)) {
      motivo("Pix perto de vencer");
      continue;
    }
    // Venceu. Se o lembrete com o código saiu, ela já foi lembrada: não manda outra
    if (b.mensagens.some((m) => m.chave === `pix-${id}` && m.status !== "cancelada" && m.status !== "erro")) continue;
    if (idade < of.carrinhoMinutos) {
      motivo("Pix vencido esperando o tempo");
      continue;
    }
    const link = linkRefazer(of.urlBase, p);
    if (!link) {
      motivo("Pix vencido sem peças pra montar o carrinho");
      continue;
    }
    const chave = `pixexp-${id}`;
    if (b.mensagens.some((m) => m.chave === chave)) continue;
    const e = enfileirar(b, {
      cliente: clienteDo(b, p, tel),
      campanha: "pix_expirado",
      chave,
      variaveis: { valor, pedido: p.name, link, itens: resumoItens(p.lineItems?.nodes ?? []) },
    });
    if (e.mensagem) r.enfileiradas++;
    else motivo(`Pix vencido: ${e.motivo}`);
  }

  // 3. Na fila e já resolvido: não manda
  const porId = new Map(pedidos.map((p) => [idCurto(p.id), p]));
  const porCheckout = new Map(checkouts.map((c) => [idCurto(c.id), c]));
  for (const m of b.mensagens) {
    if (m.status !== "fila" || !m.chave) continue;
    if (m.chave.startsWith("pix-") || m.chave.startsWith("pixexp-")) {
      const p = porId.get(m.chave.slice(m.chave.indexOf("-") + 1));
      if (!p) continue;
      const erro = p.cancelledAt
        ? "Pedido cancelado"
        : PAGO.has(p.displayFinancialStatus ?? "")
          ? "Já pagou"
          : comprouDeNovo(p)
            ? "Comprou de novo"
            : refez(p)
              ? "Refez o pedido"
              : m.chave.startsWith("pix-") && venceu(p, 1)
              ? "Pix venceu antes de sair"
              : undefined;
      if (erro) {
        m.status = "cancelada";
        m.erro = erro;
        r.canceladas++;
      }
    } else if (m.chave.startsWith("carrinho-") || m.chave.startsWith("carrinho2-")) {
      const ck = porCheckout.get(m.chave.slice(m.chave.indexOf("-") + 1));
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
    if (m.resultado || !CAMPANHAS_SITE.includes(m.campanha) || m.criadoEm < desde) continue;
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
  // Uma venda conta uma vez só: fica com a última mensagem antes dela (ex.: o 2º aviso do carrinho, não os dois)
  const donos = new Map<string, Mensagem>();
  for (const m of b.mensagens) {
    if (!m.resultado || !CAMPANHAS_SITE.includes(m.campanha)) continue;
    const outro = donos.get(m.resultado.pedido);
    if (!outro) {
      donos.set(m.resultado.pedido, m);
      continue;
    }
    const quando = (x: Mensagem) => x.enviadoEm ?? x.criadoEm;
    const [fica, sai] = quando(m) > quando(outro) ? [m, outro] : [outro, m];
    sai.resultado = undefined;
    donos.set(fica.resultado!.pedido, fica);
  }
  return r;
}

let rodando = false;
/** Último resultado, para a tela. No globalThis: o agendador e as rotas podem ter cópias separadas do módulo. */
const memoria = globalThis as unknown as { __ultimoEcommerce?: ResultadoEcommerce & { em: string } };
const guardar = (r: ResultadoEcommerce & { em: string }) => (memoria.__ultimoEcommerce = r);

/** O modelo da campanha está aprovado na Meta? (consulta guardada por 1 h) */
async function modeloAprovado(b: BaseCrm, campanha: TipoCampanha): Promise<boolean> {
  const nome = b.modelos.find((m) => m.campanha === campanha)?.template?.nome;
  const of = oficialDe(b.config);
  if (!nome || !of.token || !of.wabaId) return false;
  const cache = globalThis as unknown as { __modelosMeta?: { em: number; aprovados: string[] } };
  if (!cache.__modelosMeta || Date.now() - cache.__modelosMeta.em > 3600000 || !cache.__modelosMeta.aprovados.includes(nome)) {
    try {
      const lista = await new CloudApi(of.token).modelos(of.wabaId);
      cache.__modelosMeta = { em: Date.now(), aprovados: lista.filter((t) => t.status === "APPROVED").map((t) => t.name) };
    } catch {
      return false;
    }
  }
  return cache.__modelosMeta.aprovados.includes(nome);
}

/** Passo do agendador (a cada 10 min). */
export async function conferirEcommerce(): Promise<ResultadoEcommerce | null> {
  if (rodando || !env("SHOPIFY_ADMIN_TOKEN")) return null;
  rodando = true;
  await conferirEscopos();
  try {
    const agora = Date.now();
    // 2 dias: o 2º aviso do carrinho sai 24 h depois do 1º
    const desde = new Date(agora - 50 * 3600000).toISOString();
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
    // 2º aviso do carrinho: cria o cupom na Shopify antes (em sombra, só um código de mentira)
    const cupons: Record<string, string> = {};
    const criados: { codigo: string; checkout: string; pct: number; ate: string; shopifyId?: string }[] = [];
    const b0 = await lerBase();
    const of0 = oficialDe(b0.config);
    const sombra0 = viaOficial(b0, "carrinho_cupom") ? of0.sombra : b0.config.modoSombra;
    const candidatos = carrinhosParaCupom(b0, checkouts, pedidos, agora);
    // De verdade, só com o modelo aprovado: senão cria cupom pra uma mensagem que a Meta recusa
    const modeloOk = sombra0 || !candidatos.length || !viaOficial(b0, "carrinho_cupom") || (await modeloAprovado(b0, "carrinho_cupom"));
    if (!modeloOk) console.log("[crm] 2º aviso do carrinho esperando a Meta aprovar o modelo");
    for (const ck of modeloOk ? candidatos : []) {
      const id = idCurto(ck.id);
      const codigo = gerarCodigo(b0);
      b0.codigos.push({ codigo, clienteId: "", valor: 0, criadoEm: "", validade: "" }); // não repete no mesmo passo
      const ate = new Date(agora + VALIDADE_CUPOM_CARRINHO_H * 3600000).toISOString();
      if (sombra0) {
        cupons[id] = codigo;
        continue;
      }
      const res = await criarCupomCarrinho(codigo, of0.carrinhoCupomPct ?? 10, ate);
      if (!res.id) {
        console.error(`[crm] cupom do carrinho ${id}: ${res.erro}`);
        continue;
      }
      cupons[id] = codigo;
      criados.push({ codigo, checkout: id, pct: of0.carrinhoCupomPct ?? 10, ate, shopifyId: res.id });
    }
    const { r, desativar } = await alterarBase((b) => {
      const r = aplicarEcommerce(b, checkouts, pedidos, agora, cupons);
      const desativar: string[] = [];
      for (const c of criados) {
        const m = b.mensagens.find((x) => x.chave === `carrinho2-${c.checkout}`);
        if (m && m.status !== "cancelada") (b.cuponsCarrinho ??= []).push({ ...c, criadoEm: new Date().toISOString() });
        else if (c.shopifyId) desativar.push(c.shopifyId); // não entrou na fila: o cupom não vale
      }
      // Cupom de cashback do site: baixa de quem usou no site, e desativa o que não vale mais
      const c = conferirCupons(b, pedidos);
      if (c.baixas) console.log(`[crm] cupons do site usados: ${c.baixas}`);
      return { r, desativar: [...c.desativar, ...desativar] };
    });
    if (desativar.length) await desativarCupons(desativar);
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
    if (m.criadoEm < desde || !CAMPANHAS_SITE.includes(m.campanha)) continue;
    if (m.campanha === "carrinho_abandonado" || m.campanha === "carrinho_cupom") conta(car, m);
    if (m.campanha === "pix_pendente" || m.campanha === "pix_expirado") conta(pix, m);
  }
  return {
    dias,
    carrinho: { ...car, valor: Math.round(car.valor) },
    pix: { mensagens: pix.mensagens, simuladas: pix.simuladas, pagaram: pix.compraram, valor: Math.round(pix.valor) },
    ultimo: memoria.__ultimoEcommerce ?? null,
    // Pelo oficial ou, enquanto a Meta não está pronta, pelo número do site na WA-AKG
    sombra: viaOficial(b, "carrinho_abandonado") ? of.sombra : b.config.modoSombra,
    configurado: Boolean(of.token && of.phoneNumberId) || b.config.numeros.some((n) => n.loja === LOJA_OFICIAL && n.ativo && n.sessao),
  };
}

