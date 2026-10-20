/**
 * TOTVS Moda (Virtual Age) — API de Integração V2.
 * Dois jeitos de entrar: o de sempre (grant_type=password: client id/secret
 * da LOGFC006 + usuário "Padrão" da ADMFM026) e o de integração, da versão
 * 2.8 em diante (usuário "Integração" da ADMFM026 + o ambiente, "tenant").
 *
 * As vendas das lojas físicas saem das notas fiscais de saída (NFC-e do PDV).
 * A API não filtra por data de emissão — só por data de alteração (`change`,
 * limitada a 6 meses por consulta) — então filtramos a emissão no código.
 */

import { ChannelResult, NormalizedOrder, addDays } from "../types";
import { comCache } from "../cache";
import { env } from "../env";
import { gravarBlob, lerBlobs } from "../blobCache";
import "../credenciais"; // chaves salvas em disco, quando roda fora da Vercel

const DEFAULT_URL = "https://apitotvsmoda.bhan.com.br";
const INVOICES = "/api/totvsmoda/fiscal/v2/invoices/search";

/** Filiais das lojas físicas (a 4 é o site, que já vem pela Shopify). */
export const LOJAS: Record<number, string> = {
  1: "Centro",
  2: "Fiusa",
  3: "Loja de Fábrica",
  5: "Rio de Janeiro",
  6: "Ribeirão Preto",
  7: "SP — Itaim",
  8: "Belo Horizonte",
  9: "Praia Grande",
};

/**
 * Lojas que mudaram de nome. Os meses guardados em cache e as metas salvas
 * ainda trazem o nome antigo, então ele é traduzido na leitura.
 */
export const RENOMEADAS: Record<string, string> = {
  "Franca Shopping": "Fiusa",
};

export function nomeAtualDaLoja(nome: string): string {
  return RENOMEADAS[nome] ?? nome;
}

/**
 * Endereço da API. Aceita o que vier colado de mensagem ou exemplo: pega só o
 * endereço (até o primeiro espaço ou vírgula) e tira o caminho do login, se
 * vier junto (".../api/totvsmoda/authorization/v2/token").
 */
export function totvsBaseUrl(): string {
  const bruto = env("TOTVS_API_URL");
  const url = (bruto.match(/https?:\/\/[^\s,;'"]+/i)?.[0] ?? bruto.split(/[\s,;]/)[0])
    .replace(/\/api\/totvsmoda\/.*$/i, "")
    .replace(/\/+$/, "");
  if (!url) return DEFAULT_URL;
  return /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, "")}`;
}

/**
 * Credencial da TOTVS como foi salva, sem o que costuma vir junto quando se
 * copia de um exemplo (curl, Postman): "client_secret=", aspas e barras.
 */
export function credTotvs(nome: "TOTVS_CLIENT_ID" | "TOTVS_CLIENT_SECRET" | "TOTVS_USERNAME" | "TOTVS_PASSWORD"): string {
  return env(nome)
    .replace(/^(--data(-urlencode)?\s+)?['"]?(client_id|client_secret|username|password|grant_type)=/i, "")
    .replace(/['"\\\s]+$/, "")
    .trim();
}

export function totvsConfigured(): boolean {
  // O login de integração dispensa o client id/secret: basta usuário, senha e o ambiente (tenant)
  return Boolean(credTotvs("TOTVS_USERNAME") && credTotvs("TOTVS_PASSWORD") && (credTotvs("TOTVS_CLIENT_ID") || tenantsPossiveis().length));
}

/**
 * Ambiente (tenant) para o login de integração, em ordem de tentativa: o
 * configurado; o código que vem no endereço da nuvem da TOTVS
 * (api-gateway.<código>.external.saas.totvsmoda.cloudtotvs.com.br); e o
 * Client ID, que a TOTVS também chama de "identificador do ambiente".
 */
export function tenantsPossiveis(): { valor: string; origem: string }[] {
  let host = "";
  try {
    host = new URL(totvsBaseUrl()).hostname;
  } catch {
    /* endereço inválido */
  }
  const doEndereco = host.match(/^api-gateway\.([a-z0-9-]+)\./i)?.[1] ?? "";
  const clientId = credTotvs("TOTVS_CLIENT_ID");
  // O Client ID costuma ser o ambiente + o nome do app (ex.: VSVIASOL217586 + APIV2PROD)
  const semApp = clientId.replace(/api(v\d+)?(prod|hml|homolog|dev|teste?)?$/i, "");
  const lista = [
    { valor: env("TOTVS_TENANT"), origem: "configurado" },
    { valor: doEndereco, origem: "do endereço" },
    { valor: clientId, origem: "Client ID" },
    { valor: semApp, origem: "começo do Client ID" },
  ].filter((t) => t.valor);
  return lista.filter((t, i) => lista.findIndex((x) => x.valor === t.valor) === i);
}

interface Token {
  token: string;
  segundos: number;
  refresh?: string;
}

let cachedToken: { token: string; expiresAt: number; chave: string; refresh?: string } | null = null;
/** Qual login funcionou por último — depois da atualização de 2026 a TOTVS ganhou o "de integração" */
let modoLogin: "senha" | "integracao" = "senha";

const CAMINHO_INTEGRACAO = "/api/totvsmoda/authorization/v2/integration/token";

/** Token, validade e refresh token, aceitando os nomes de campo das duas versões do login. */
function lerToken(texto: string): Token | null {
  try {
    const j = JSON.parse(texto) as Record<string, unknown>;
    const token = String(j.access_token ?? j.accessToken ?? j.token ?? "");
    if (!token) return null;
    const refresh = String(j.refresh_token ?? j.refreshToken ?? "") || undefined;
    return { token, segundos: Number(j.expires_in ?? j.expiresIn ?? 3600) || 3600, refresh };
  } catch {
    return null;
  }
}

/** Resposta da TOTVS para mostrar na tela: nunca com o token de acesso dentro */
export const semTokens = (texto: string) =>
  texto
    .replace(/("(access_token|refresh_token|accessToken|refreshToken)"\s*:\s*")[^"]*/g, "$1•••")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "•••");

const resumoErro = (status: number, texto: string) => `${status}: ${semTokens(texto).replace(/\s+/g, " ").slice(0, 200)}`;

/**
 * Erro passageiro do servidor da TOTVS (502/503/504 do Cloudflare deles, ou
 * conexão caída): espera um pouco e tenta mais uma vez antes de desistir.
 */
async function comRetentativa(pedir: () => Promise<Response>): Promise<Response> {
  try {
    const r = await pedir();
    if (![502, 503, 504].includes(r.status)) return r;
  } catch {
    /* tenta de novo abaixo */
  }
  await new Promise((ok) => setTimeout(ok, 1500));
  return pedir();
}

/** Login de sempre: client id/secret + usuário e senha (usuário com privilégio "Padrão" na ADMFM026). */
async function loginSenha(): Promise<Token | string> {
  if (!credTotvs("TOTVS_CLIENT_ID") || !credTotvs("TOTVS_CLIENT_SECRET")) return "login com client id: falta o Client ID ou o secret";
  const pedir = (comCabecalho: boolean) =>
    comRetentativa(() => fetch(`${totvsBaseUrl()}/api/totvsmoda/authorization/v2/token`, {
      method: "POST",
      // Os mesmos cabeçalhos do exemplo de login que a TOTVS mandou
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "Accept-Language": "pt-BR",
        ...(comCabecalho ? { Authorization: autorizacaoBasica() } : {}),
      },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: credTotvs("TOTVS_CLIENT_ID"),
        client_secret: credTotvs("TOTVS_CLIENT_SECRET"),
        username: credTotvs("TOTVS_USERNAME"),
        password: credTotvs("TOTVS_PASSWORD"),
      }),
      cache: "no-store",
    }));
  let res = await pedir(false);
  let text = await res.text();
  // O exemplo da TOTVS também manda um cabeçalho Authorization: se recusar o
  // client id, tenta de novo com ele no cabeçalho (padrão Basic do OAuth)
  if (!lerToken(text) && /invalid client/i.test(text)) {
    res = await pedir(true);
    text = await res.text();
  }
  return lerToken(text) ?? `login com client id (${resumoErro(res.status, text)})`;
}

/** Client id e secret no cabeçalho, como o OAuth prevê (Basic base64(id:secret)). */
export const autorizacaoBasica = () =>
  `Basic ${Buffer.from(`${credTotvs("TOTVS_CLIENT_ID")}:${credTotvs("TOTVS_CLIENT_SECRET")}`).toString("base64")}`;

/**
 * Login de integração (TOTVS 2.8 em diante): usuário com privilégio
 * "Integração" na ADMFM026, senha e o ambiente (tenant), em multipart/form-data
 * como pede o manual da API. Tenta cada tenant possível até um funcionar.
 */
export async function loginIntegracao(
  tenants = tenantsPossiveis()
): Promise<{ resultado: Token | string; tentativas: string[]; tenant?: string }> {
  const tentativas: string[] = [];
  if (!tenants.length) return { resultado: "login de integração: falta o ambiente (tenant)", tentativas };
  for (const t of tenants) {
    const corpo = new FormData();
    corpo.set("Username", credTotvs("TOTVS_USERNAME"));
    corpo.set("Password", credTotvs("TOTVS_PASSWORD"));
    corpo.set("Tenant", t.valor);
    // O Client ID aparece só com o final, por segurança
    const rotulo = t.origem === "Client ID" ? `Client ID …${t.valor.slice(-4)}` : `${t.origem}: ${t.valor}`;
    try {
      const res = await fetch(`${totvsBaseUrl()}${CAMINHO_INTEGRACAO}`, { method: "POST", body: corpo, cache: "no-store" });
      const text = await res.text();
      const token = lerToken(text);
      tentativas.push(`Login de integração (tenant ${rotulo}): ${token ? "OK" : `HTTP ${resumoErro(res.status, text)}`}`);
      if (token) return { resultado: token, tentativas, tenant: t.valor };
    } catch (e) {
      tentativas.push(`Login de integração (tenant ${rotulo}): não conectou — ${e instanceof Error ? e.message : e}`);
    }
  }
  return { resultado: tentativas.join(" · "), tentativas };
}

/** Renova o token sem pedir a senha de novo, pelo refresh token de cada tipo de login. */
async function renovar(refresh: string): Promise<Token | null> {
  const base = totvsBaseUrl();
  const res =
    modoLogin === "integracao"
      ? await fetch(`${base}/api/totvsmoda/authorization/v2/integration/refresh`, {
          method: "POST",
          body: (() => {
            const f = new FormData();
            f.set("RefreshToken", refresh);
            return f;
          })(),
          cache: "no-store",
        })
      : await fetch(`${base}/api/totvsmoda/authorization/v2/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
          cache: "no-store",
        });
  return res.ok ? lerToken(await res.text()) : null;
}

/** Token de acesso da APIv2, com cache em memória. */
export async function getTotvsToken(): Promise<string> {
  // Trocou o client id/secret ou o usuário na configuração: o token antigo não vale mais
  const chave = `${totvsBaseUrl()}|${credTotvs("TOTVS_CLIENT_ID")}|${credTotvs("TOTVS_CLIENT_SECRET")}|${credTotvs("TOTVS_USERNAME")}|${credTotvs("TOTVS_PASSWORD")}|${env("TOTVS_TENANT")}`;
  if (cachedToken && cachedToken.chave === chave && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const guardar = (r: Token) => {
    cachedToken = { token: r.token, expiresAt: Date.now() + Math.max(60, r.segundos - 300) * 1000, chave, refresh: r.refresh };
    return r.token;
  };
  // Venceu: tenta renovar pelo refresh token antes de fazer o login inteiro
  if (cachedToken?.chave === chave && cachedToken.refresh) {
    const r = await renovar(cachedToken.refresh).catch(() => null);
    if (r) return guardar(r);
  }

  // Tenta primeiro o login que funcionou da última vez; se falhar, o outro
  const ordem = modoLogin === "senha" ? (["senha", "integracao"] as const) : (["integracao", "senha"] as const);
  const erros: string[] = [];
  for (const modo of ordem) {
    const r =
      modo === "senha"
        ? await loginSenha().catch((e) => String(e))
        : (await loginIntegracao().catch((e) => ({ resultado: String(e) }))).resultado;
    if (typeof r === "string") {
      erros.push(r);
      continue;
    }
    modoLogin = modo;
    return guardar(r);
  }
  throw new Error(`Falha na autenticação — ${erros.join(" · ")}`);
}

/** Chamada autenticada à APIv2. */
export async function totvsFetch(
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  return totvsFetchCom(await getTotvsToken(), path, body);
}

/** Chamada à APIv2 com um token já obtido (o teste de conexão usa o dele). */
export async function totvsFetchCom(
  token: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await comRetentativa(() =>
    fetch(`${totvsBaseUrl()}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    })
  );
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* resposta não-JSON: devolvemos o texto cru para diagnóstico */
  }
  return { status: res.status, json, text };
}

interface TotvsInvoice {
  branchCode: number;
  invoiceDate: string;
  invoiceSequence: number;
  invoiceCode: number | null;
  invoiceStatus: string;
  operationType: string;
  /** Sim, o nome do campo vem com esse typo na API */
  operatioName: string;
  totalValue: number;
  quantity?: number;
  /** CPF da vendedora que fez a venda no PDV */
  sellerCpf?: string | null;
  paymentConditionName?: string | null;
  exitTime: string | null;
  personName: string | null;
  personCode?: number | string | null;
  items?: {
    code?: string;
    name?: string;
    quantity?: number;
    netValue?: number;
    products?: { discountValue?: number }[];
  }[];
}

/** Só conta venda de verdade: saída, emitida e de operação de venda. */
function isVenda(inv: TotvsInvoice): boolean {
  if (inv.operationType !== "Output") return false;
  if (inv.invoiceStatus !== "Issued") return false;
  const op = inv.operatioName ?? "";
  if (!/VENDA/i.test(op)) return false;
  return !/DEVOL|TRANSF|REMESSA|BONIFIC|BRINDE|COMODATO|AMOSTRA/i.test(op);
}

/** Nota de entrada de devolução de venda (troca ou devolução), que não foi cancelada. */
function isDevolucao(inv: TotvsInvoice): boolean {
  if (inv.operationType !== "Input" || inv.invoiceStatus === "Canceled") return false;
  return /DEVOLU[CÇ][AÃ]O DE VENDA/i.test(inv.operatioName ?? "");
}

/**
 * Vendedora da venda original de cada devolução, pela base do CRM: a compra
 * da mesma cliente, do mesmo dia ou antes, com a mesma peça (quando dá para
 * comparar) ou a mais recente. Sem achar, fica quem registrou a devolução.
 */
async function vendedoraDaVendaOriginal(devs: { o: NormalizedOrder; pessoa?: string; itens: string[] }[]): Promise<void> {
  const comPessoa = devs.filter((d) => d.pessoa);
  if (!comPessoa.length) return;
  try {
    const { lerBase } = await import("../crm/base");
    const { comprasDaDevolucao } = await import("../crm/devolucoes");
    const base = await lerBase();
    const porPessoa = new Map<string, typeof base.vendas>();
    const pessoas = new Set(comPessoa.map((d) => d.pessoa!));
    for (const v of base.vendas) {
      if (v.codigoClienteTotvs && pessoas.has(v.codigoClienteTotvs) && v.origem === "totvs")
        (porPessoa.get(v.codigoClienteTotvs) ?? porPessoa.set(v.codigoClienteTotvs, []).get(v.codigoClienteTotvs)!).push(v);
    }
    for (const d of comPessoa) {
      // Sem o "devolvido" do CRM: aqui só importa de quem foi a venda
      const compras = (porPessoa.get(d.pessoa!) ?? []).map((v) => ({ ...v, devolvido: 0 }));
      const original = comprasDaDevolucao(compras, { data: d.o.createdAt.slice(0, 10), quando: d.o.createdAt, itens: d.itens })[0];
      if (original?.vendedoraCpf) d.o.sellerCpf = original.vendedoraCpf;
    }
  } catch (e) {
    console.warn("[totvs] vendedora das devoluções:", e instanceof Error ? e.message : e);
  }
}

/** Quebra o período em janelas de até 6 meses (limite da API). */
function janelas(from: string, to: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const fim = new Date(`${to}T00:00:00Z`);
  while (cursor <= fim) {
    const prox = new Date(cursor);
    prox.setUTCDate(prox.getUTCDate() + 150); // ~5 meses, com folga
    const end = prox > fim ? fim : prox;
    out.push({ start: cursor.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
    cursor = new Date(end);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const PESSOAS = "/api/totvsmoda/person/v2/individuals/search";

/** Nome curto e legível: primeiro nome + um sobrenome. */
function nomeCurto(completo: string): string {
  const partes = completo.trim().split(/\s+/).filter((p) => p.length > 2);
  if (partes.length <= 2) return completo.trim();
  return `${partes[0]} ${partes[1]}`;
}

/**
 * Traduz o CPF gravado na nota para o nome da vendedora.
 * O cadastro de vendedor (seller/v2) não traz CPF, então a ponte é o
 * cadastro de pessoa física, consultado em lotes e guardado em cache.
 */
const nomePorCpf = new Map<string, string>();

async function nomearVendedoras(orders: NormalizedOrder[]): Promise<void> {
  const faltando = Array.from(
    new Set(
      orders
        .map((o) => o.sellerCpf)
        .filter((c): c is string => Boolean(c) && !nomePorCpf.has(c!))
    )
  );

  /** Consulta um lote de CPFs; devolve os que continuaram sem nome. */
  const buscar = async (lista: string[], filtroExtra: Record<string, unknown>) => {
    const restantes: string[] = [];
    for (let i = 0; i < lista.length; i += 50) {
      const lote = lista.slice(i, i + 50);
      try {
        const r = await totvsFetch(PESSOAS, {
          filter: { cpfList: lote, ...filtroExtra },
          page: 1,
          pageSize: 100,
        });
        const itens = (r.json?.items as { cpf?: string; name?: string }[] | undefined) ?? [];
        for (const p of itens) {
          if (p.cpf && p.name) nomePorCpf.set(p.cpf, nomeCurto(p.name));
        }
      } catch {
        /* lote sem resposta: os CPFs seguem para a próxima tentativa */
      }
      restantes.push(...lote.filter((c) => !nomePorCpf.has(c)));
    }
    return restantes;
  };

  // Vendedora que saiu da empresa fica inativa e some da busca padrão,
  // então quem não resolver na primeira passada é procurado entre as inativas.
  const semNome = await buscar(faltando, {});
  if (semNome.length) await buscar(semNome, { personIsInactive: true });

  // Sem nome no cadastro, a vendedora ainda é uma pessoa distinta: identificamos
  // pelo CPF mascarado para não perder a separação no ranking.
  for (const o of orders) {
    if (!o.sellerCpf) continue;
    o.seller = nomePorCpf.get(o.sellerCpf) ?? `CPF ${mascaraCpf(o.sellerCpf)}`;
  }
}

/** Mostra só o miolo do CPF, o suficiente para identificar sem expor o número. */
function mascaraCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, "").padStart(11, "0");
  return `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-••`;
}

/**
 * Vendas das lojas físicas no período (datas YYYY-MM-DD no fuso de SP).
 */
export interface OpcoesTotvs {
  /** Traz os itens de cada nota (produtos e descontos). Pesa muito. */
  itens?: boolean;
  /** Restringe às filiais indicadas. */
  filiais?: number[];
  /** Pula o cache de memória, para medir o cache compartilhado. */
  ignorarMemoria?: boolean;
  /** Uso interno: busca as devoluções de venda em vez das vendas. */
  devolucoes?: boolean;
}

export async function fetchTotvsSales(
  from: string,
  to: string,
  opts: OpcoesTotvs = {}
): Promise<ChannelResult> {
  if (!totvsConfigured()) {
    return { channel: "lojas", connected: false, orders: [] };
  }
  const buscar = () => vendasMenosDevolucoes(from, to, opts);
  if (opts.ignorarMemoria) return buscar();
  return comCache(`totvs|${from}|${to}|${variante(opts)}`, buscar, 5 * 60000);
}

/**
 * Vendas e, junto, as devoluções de venda do período (valor e peças
 * negativos): o faturamento fica líquido, como no relatório da TOTVS. Se as
 * devoluções falharem, as vendas saem assim mesmo.
 */
async function vendasMenosDevolucoes(from: string, to: string, opts: OpcoesTotvs): Promise<ChannelResult> {
  const [vendas, devs] = await Promise.all([porMeses(from, to, opts), porMeses(from, to, { ...opts, devolucoes: true })]);
  if (devs.error) console.warn("[totvs] devoluções:", devs.error);
  return {
    ...vendas,
    orders: [...vendas.orders, ...devs.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/** Identifica a variação da busca, para cache e nome de arquivo. */
function variante(opts: OpcoesTotvs): string {
  // ignorarMemoria não entra aqui: é só instrumentação, não muda os dados
  const filiais = opts.filiais?.length ? opts.filiais.slice().sort().join("_") : "todas";
  return `${opts.devolucoes ? "dev2-" : ""}${opts.itens ? "itens" : "leve"}-${filiais}`;
}

const PREFIXO = "totvs/mes-";
const PREFIXO_DIA = "totvsdia/";
// v2: vendedora pela venda de antes da devolução (a v1 pegava a venda nova da troca)
const PREFIXO_DIA_DEV = "totvsdevdia2/";
const PREFIXO_PROD = "totvsprod/";

/** Contadores para a tela de medição de desempenho. */
export const medidas = { paginas: 0, diasDoCache: 0, mesesDoCache: 0 };
export function zerarMedidas() {
  medidas.paginas = 0;
  medidas.diasDoCache = 0;
  medidas.mesesDoCache = 0;
}

/** Lista de meses (YYYY-MM) tocados pelo período. */
function mesesDo(from: string, to: string): string[] {
  const out: string[] = [];
  let [ano, mes] = from.slice(0, 7).split("-").map(Number);
  const limite = to.slice(0, 7);
  for (;;) {
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    out.push(chave);
    if (chave >= limite) break;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return out;
}

/** Último dia do mês YYYY-MM. */
function fimDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);
}

/** Dias (YYYY-MM-DD) de um intervalo, inclusive. */
function diasDo(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Nota deste dia? A emissão é o que vale, não a alteração. */
const diaDaNota = (o: NormalizedOrder) => o.createdAt.slice(0, 10);

/**
 * Mês ainda em aberto: cada dia fechado é guardado no Blob separadamente e os
 * últimos 3 dias são sempre buscados de novo, porque ainda recebem ajuste.
 * Só vale para a busca leve de todas as filiais, que é o caminho quente.
 */
async function mesEmAberto(
  inicio: string,
  fim: string,
  hoje: string,
  opts: OpcoesTotvs
): Promise<ChannelResult> {
  if (opts.itens || opts.filiais?.length) {
    return buscarTotvs(inicio, fim, addDays(fim, 25), opts);
  }

  const corte = addDays(hoje, -3); // dias até aqui já não mudam mais
  const dias = diasDo(inicio, fim);
  const cacheaveis = dias.filter((d) => d <= corte);
  const recentes = dias.filter((d) => d > corte);

  const prefixoDia = opts.devolucoes ? PREFIXO_DIA_DEV : PREFIXO_DIA;
  const guardados = await lerBlobs<NormalizedOrder[]>(prefixoDia, cacheaveis);
  const faltando = cacheaveis.filter((d) => !guardados.has(d));

  const orders: NormalizedOrder[] = [];
  for (const d of cacheaveis) {
    const salvo = guardados.get(d);
    if (salvo) {
      medidas.diasDoCache += 1;
      orders.push(...salvo);
    }
  }

  let erro: string | undefined;

  // Os dias que faltam vêm numa busca só, do primeiro ao último, e depois
  // são gravados separadamente
  if (faltando.length) {
    const de = faltando[0];
    const ate = faltando[faltando.length - 1];
    const r = await buscarTotvs(de, ate, addDays(ate, 3) > hoje ? hoje : addDays(ate, 3), opts);
    if (r.error) erro = r.error;
    else {
      const porDia = new Map<string, NormalizedOrder[]>(faltando.map((d) => [d, []]));
      for (const o of r.orders) porDia.get(diaDaNota(o))?.push(o);
      await Promise.all(
        Array.from(porDia.entries()).map(([d, lista]) => gravarBlob(prefixoDia, d, lista))
      );
      orders.push(...r.orders.filter((o) => porDia.has(diaDaNota(o))));
    }
  }

  if (recentes.length) {
    const r = await buscarTotvs(recentes[0], fim, hoje, opts);
    if (r.error) erro = erro ?? r.error;
    else orders.push(...r.orders);
  }

  return { channel: "lojas", connected: true, error: erro, orders };
}

/**
 * Busca mês a mês, guardando no Blob os meses já encerrados — eles não mudam
 * mais, então o período longo passa a ser leitura de cache em vez de centenas
 * de páginas de API.
 */
async function porMeses(from: string, to: string, opts: OpcoesTotvs): Promise<ChannelResult> {
  const hoje = new Date().toISOString().slice(0, 10);
  const meses = mesesDo(from, to);
  const marca = variante(opts);
  // Um mês só é considerado estável 20 dias depois de encerrado, tempo de
  // sobra para ajustes e cancelamentos entrarem no ERP
  const estavel = (mes: string) => {
    const fim = fimDoMes(mes);
    return fim < hoje && new Date(hoje).getTime() - new Date(fim).getTime() > 20 * 86400000;
  };

  const arquivo = (mes: string) => `${marca}-${mes}`;
  const guardados = await lerBlobs<NormalizedOrder[]>(
    PREFIXO,
    meses.filter(estavel).map(arquivo)
  );

  /** Corrige o nome da loja em notas gravadas antes de uma renomeação. */
  const renomear = (o: NormalizedOrder): NormalizedOrder => {
    const atual = o.store ? nomeAtualDaLoja(o.store) : o.store;
    return atual === o.store ? o : { ...o, store: atual, status: atual ?? o.status };
  };

  const erros: string[] = [];
  const partes = await Promise.all(
    meses.map(async (mes) => {
      const salvo = guardados.get(arquivo(mes));
      if (salvo) {
        medidas.mesesDoCache += 1;
        return salvo.map(renomear);
      }
      const inicio = `${mes}-01`;
      const fim = fimDoMes(mes);
      const limite = fim > hoje ? hoje : fim;
      const margem = new Date(new Date(limite).getTime() + 25 * 86400000)
        .toISOString()
        .slice(0, 10);
      // Mês ainda aberto: dia fechado vem do cache diário, só os últimos
      // dias são buscados de novo — antes o mês inteiro era refeito a cada vez
      const r = estavel(mes)
        ? await buscarTotvs(inicio, limite, margem, opts)
        : await mesEmAberto(inicio, limite, hoje, opts);
      if (r.error) erros.push(r.error);
      else if (estavel(mes)) await gravarBlob(PREFIXO, arquivo(mes), r.orders);
      return r.orders.map(renomear);
    })
  );

  const orders = partes.flat().filter((o) => {
    const dia = o.createdAt.slice(0, 10);
    return dia >= from && dia <= to;
  });
  return {
    channel: "lojas",
    connected: true,
    error: erros[0],
    orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/**
 * `from`/`to` recortam a data de emissão; `changeAte` estende a janela de
 * alteração, porque a API só filtra por alteração e uma nota do fim do mês
 * costuma ser alterada no mês seguinte.
 */
async function buscarTotvs(
  from: string,
  to: string,
  changeAte = to,
  opts: OpcoesTotvs = {}
): Promise<ChannelResult> {
  const orders: NormalizedOrder[] = [];
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const PAGE = 100; // limite da API
    const corpo = (j: { start: string; end: string }, pagina: number) => ({
      filter: {
        branchCodeList: opts.filiais?.length ? opts.filiais : Object.keys(LOJAS).map(Number),
        operationType: opts.devolucoes ? "Input" : "Output",
        change: {
          startDate: `${j.start}T00:00:00`,
          endDate: `${(j.end >= hoje ? hoje : j.end)}T23:59:59`,
        },
      },
      // Os itens multiplicam o tamanho da resposta; só vêm quando há um card
      // que precisa deles (produtos e descontos, na visão de uma unidade)
      // Devolução vem sempre com os itens (são poucas notas): é pela peça que se acha a venda original
      ...(opts.itens || opts.devolucoes ? { expand: "items" } : {}),
      page: pagina,
      pageSize: PAGE,
    });

    const devs: { o: NormalizedOrder; pessoa?: string; itens: string[] }[] = [];
    const coletar = (itens: TotvsInvoice[]) => {
      for (const inv of itens) {
        const data = (inv.invoiceDate ?? "").slice(0, 10);
        if (data < from || data > to) continue;
        if (opts.devolucoes) {
          if (!isDevolucao(inv)) continue;
          const loja = LOJAS[inv.branchCode] ?? `Filial ${inv.branchCode}`;
          const o: NormalizedOrder = {
            channel: "lojas",
            id: `dev-${inv.branchCode}-${inv.invoiceSequence}`,
            label: `Devolução #${inv.invoiceCode ?? inv.invoiceSequence}`,
            createdAt: `${data}T${inv.exitTime ?? "12:00:00"}-03:00`,
            total: -Number(inv.totalValue ?? 0),
            currency: "BRL",
            status: loja,
            customer: inv.personName ?? undefined,
            store: loja,
            qty: -Number(inv.quantity ?? 0),
            payment: "Devoluções e trocas",
            sellerCpf: inv.sellerCpf ?? undefined,
            devolucao: true,
            items: opts.itens
              ? (inv.items ?? [])
                  .filter((it) => it.name)
                  .map((it) => ({ title: it.name!, qty: -Number(it.quantity ?? 1), revenue: -Number(it.netValue ?? 0) }))
              : undefined,
          };
          orders.push(o);
          const nome = inv.personName ?? "";
          devs.push({
            o,
            pessoa: nome && !/CONSUMIDOR|N[AÃ]O IDENTIFICAD/i.test(nome) && inv.personCode != null ? String(inv.personCode) : undefined,
            itens: (inv.items ?? []).map((it) => it.code).filter((c): c is string => Boolean(c)),
          });
          continue;
        }
        if (!isVenda(inv)) continue;
        const loja = LOJAS[inv.branchCode] ?? `Filial ${inv.branchCode}`;
        orders.push({
          channel: "lojas",
          id: `${inv.branchCode}-${inv.invoiceSequence}`,
          label: `#${inv.invoiceCode ?? inv.invoiceSequence}`,
          createdAt: `${data}T${inv.exitTime ?? "12:00:00"}-03:00`,
          total: Number(inv.totalValue ?? 0),
          currency: "BRL",
          status: loja,
          customer: inv.personName ?? undefined,
          store: loja,
          qty: Number(inv.quantity ?? 0),
          discount: (inv.items ?? []).reduce(
            (t, it) => t + (it.products ?? []).reduce((s2, pr) => s2 + Number(pr.discountValue ?? 0), 0),
            0
          ),
          payment: inv.paymentConditionName ?? undefined,
          sellerCpf: inv.sellerCpf ?? undefined,
          items: (inv.items ?? [])
            .filter((it) => it.name)
            .map((it) => ({
              title: it.name!,
              qty: Number(it.quantity ?? 1),
              revenue: Number(it.netValue ?? 0),
            })),
        });
      }
    };

    for (const j of janelas(from, changeAte > hoje ? hoje : changeAte)) {
      medidas.paginas += 1;
      const primeira = await totvsFetch(INVOICES, corpo(j, 1));
      if (primeira.status !== 200) {
        const msg = primeira.json
          ? JSON.stringify(primeira.json).slice(0, 200)
          : primeira.text.slice(0, 200);
        throw new Error(`Notas fiscais: HTTP ${primeira.status} — ${msg}`);
      }
      coletar((primeira.json?.items as TotvsInvoice[] | undefined) ?? []);
      const total = Number(primeira.json?.count ?? 0);
      const paginas = Math.min(Math.ceil(total / PAGE), 200);

      // Demais páginas em lotes paralelos, para não estourar o tempo da rota
      for (let inicio = 2; inicio <= paginas; inicio += 10) {
        const lote = [];
        for (let p = inicio; p < inicio + 10 && p <= paginas; p++) {
          medidas.paginas += 1;
          lote.push(totvsFetch(INVOICES, corpo(j, p)));
        }
        for (const r of await Promise.all(lote)) {
          if (r.status === 200) coletar((r.json?.items as TotvsInvoice[] | undefined) ?? []);
        }
      }
    }

    if (devs.length) await vendedoraDaVendaOriginal(devs);
    await nomearVendedoras(orders);
    return { channel: "lojas", connected: true, orders };
  } catch (e) {
    return {
      channel: "lojas",
      connected: true,
      error: e instanceof Error ? e.message : "Erro desconhecido",
      orders,
    };
  }
}


export interface VendaProduto {
  /** Nome como vem na nota */
  nome: string;
  loja: string;
  qtd: number;
  receita: number;
}

/** Agrega os itens das notas de um dia por produto e loja. */
function agregarProdutos(orders: NormalizedOrder[]): VendaProduto[] {
  const m = new Map<string, VendaProduto>();
  for (const o of orders) {
    const loja = o.store ?? "";
    for (const it of o.items ?? []) {
      const chave = `${loja}|${it.title}`;
      const e = m.get(chave) ?? { nome: it.title, loja, qtd: 0, receita: 0 };
      e.qtd += it.qty;
      e.receita += it.revenue;
      m.set(chave, e);
    }
  }
  return Array.from(m.values());
}

/**
 * Venda por produto no período, agregada por dia e guardada no Blob.
 *
 * Buscar nota com itens é a consulta mais cara da TOTVS; agregando por dia,
 * cada dia é pago uma vez só. `orcamentoMs` limita o trabalho de uma
 * requisição: o que não couber volta marcado como incompleto, em vez de
 * estourar o tempo da rota e não devolver nada.
 */
export async function fetchVendasPorProduto(
  from: string,
  to: string,
  orcamentoMs = 35000
): Promise<{ itens: VendaProduto[]; incompleto: boolean; erro?: string }> {
  if (!totvsConfigured()) return { itens: [], incompleto: false };

  const inicio = Date.now();
  const hoje = new Date().toISOString().slice(0, 10);
  const limite = to > hoje ? hoje : to;
  const dias = diasDo(from, limite);
  const corte = addDays(hoje, -3); // dias mais novos ainda mudam

  const guardados = await lerBlobs<VendaProduto[]>(
    PREFIXO_PROD,
    dias.filter((d) => d <= corte)
  );

  const itens: VendaProduto[] = [];
  for (const d of dias) {
    const salvo = guardados.get(d);
    if (salvo) itens.push(...salvo.map((v) => ({ ...v, loja: nomeAtualDaLoja(v.loja) })));
  }

  const faltando = dias.filter((d) => !guardados.has(d));
  let incompleto = false;
  let erro: string | undefined;

  // Um dia por vez, para caber no orçamento e guardar o que der
  for (const d of faltando) {
    if (Date.now() - inicio > orcamentoMs) {
      incompleto = true;
      break;
    }
    const r = await buscarTotvs(d, d, addDays(d, 3) > hoje ? hoje : addDays(d, 3), { itens: true });
    if (r.error) {
      erro = r.error;
      incompleto = true;
      break;
    }
    const doDia = agregarProdutos(r.orders);
    itens.push(...doDia);
    if (d <= corte) await gravarBlob(PREFIXO_PROD, d, doDia);
  }

  return { itens, incompleto, erro };
}
