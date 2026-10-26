/**
 * Link curto do WhatsApp de cada loja no domínio do site: a Meta não aceita
 * botão de modelo apontando direto pro wa.me, então o botão "Falar com a loja"
 * vai pra viasolbrazil.com.br/w/<loja>, um redirecionamento da Shopify pro
 * wa.me/<número da loja>. Criado (ou corrigido) sozinho quando o número da loja
 * aparece ou muda.
 */

import { env } from "../env";
import "../credenciais";
import { alterarBase, lerBase } from "./base";
import { oficialDe, type BaseCrm } from "./tipos";

/** "Ribeirão Preto" → "ribeirao-preto"; "SP — Itaim" → "sp-itaim" */
export function slugDaLoja(loja: string): string {
  return loja
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const caminhoDaLoja = (loja: string) => `/w/${slugDaLoja(loja)}`;
export const ATENDIMENTO = "atendimento";

/** Final do link do botão pra loja (sem a barra), se o redirecionamento dela já existe com o número certo. */
export function sufixoWhatsLoja(base: BaseCrm, loja: string | undefined): string | undefined {
  const feitos = base.config.linksLoja ?? {};
  const n = base.config.numeros.find((x) => x.loja === loja);
  const dono = n && !n.telefone && n.mandarPor ? base.config.numeros.find((x) => x.loja === n.mandarPor) : undefined;
  const alvo = n?.telefone ? n : dono?.telefone ? dono : undefined;
  if (alvo && feitos[alvo.loja] === alvo.telefone) return caminhoDaLoja(alvo.loja).slice(1);
  const at = oficialDe(base.config).whatsAtendimento;
  if (at && feitos[ATENDIMENTO] === at) return caminhoDaLoja(ATENDIMENTO).slice(1);
  return undefined;
}

async function shopify(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
  const domain = env("SHOPIFY_STORE_DOMAIN") || "totvs-ibirapuera-viasolbrazil-dc.myshopify.com";
  const res = await fetch(process.env.SHOPIFY_GRAPHQL_URL ?? `https://${domain}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ADMIN_TOKEN") },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify respondeu ${res.status}`);
  const j = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.data ?? {};
}

async function garantir(caminho: string, alvo: string): Promise<void> {
  const d = await shopify(`query($q: String!) { urlRedirects(first: 5, query: $q) { nodes { id path target } } }`, { q: `path:${caminho}` });
  const achado = ((d.urlRedirects as { nodes: { id: string; path: string; target: string }[] })?.nodes ?? []).find((r) => r.path === caminho);
  if (achado?.target === alvo) return;
  const m = achado
    ? await shopify(`mutation($id: ID!, $r: UrlRedirectInput!) { urlRedirectUpdate(id: $id, urlRedirect: $r) { userErrors { message } } }`, { id: achado.id, r: { path: caminho, target: alvo } })
    : await shopify(`mutation($r: UrlRedirectInput!) { urlRedirectCreate(urlRedirect: $r) { userErrors { message } } }`, { r: { path: caminho, target: alvo } });
  const erros = (Object.values(m)[0] as { userErrors?: { message: string }[] })?.userErrors ?? [];
  if (erros.length) throw new Error(erros.map((e) => e.message).join("; "));
}

/** Cria/corrige o /w/<loja> de cada loja com número e o /w/atendimento. Só mexe no que mudou. */
export async function garantirLinksDasLojas(): Promise<Record<string, string>> {
  if (!env("SHOPIFY_ADMIN_TOKEN")) return {};
  const b = await lerBase();
  const feitos = b.config.linksLoja ?? {};
  const pedir: [string, string][] = b.config.numeros.filter((n) => n.telefone && feitos[n.loja] !== n.telefone).map((n) => [n.loja, n.telefone!]);
  const at = oficialDe(b.config).whatsAtendimento;
  if (at && feitos[ATENDIMENTO] !== at) pedir.push([ATENDIMENTO, at]);
  const r: Record<string, string> = {};
  const ok: Record<string, string> = {};
  for (const [loja, tel] of pedir) {
    try {
      await garantir(caminhoDaLoja(loja), `https://wa.me/${tel}`);
      ok[loja] = tel;
      r[loja] = "ok";
    } catch (e) {
      r[loja] = e instanceof Error ? e.message : String(e);
    }
  }
  if (Object.keys(ok).length)
    await alterarBase((bb) => {
      bb.config.linksLoja = { ...(bb.config.linksLoja ?? {}), ...ok };
    });
  return r;
}
