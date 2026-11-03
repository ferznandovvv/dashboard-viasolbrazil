/**
 * Marca clientes da Shopify com uma tag a partir de uma lista de emails (um
 * por linha, num arquivo da pasta dados/crm). Serve pra montar públicos de
 * email no Shopify Messaging (ex.: quem abria email no Edrone). Roda em
 * segundo plano: são milhares de clientes e a Shopify limita o ritmo.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../env";
import "../credenciais";

const PASTA = join(process.env.DADOS_DIR ?? join(process.cwd(), "dados"), "crm");

export const progressoMarcar: {
  rodando: boolean;
  tag?: string;
  total: number;
  lidos: number;
  achadas: number;
  jaTinham: number;
  marcadas: number;
  erros: number;
  ultimoErro?: string;
  inicio?: string;
  fim?: string;
} = ((globalThis as Record<string, unknown>).__progressoMarcar as never) ?? { rodando: false, total: 0, lidos: 0, achadas: 0, jaTinham: 0, marcadas: 0, erros: 0 };
(globalThis as Record<string, unknown>).__progressoMarcar = progressoMarcar;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const domain = env("SHOPIFY_STORE_DOMAIN") || "totvs-ibirapuera-viasolbrazil-dc.myshopify.com";
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const res = await fetch(process.env.SHOPIFY_GRAPHQL_URL ?? `https://${domain}/admin/api/2026-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ADMIN_TOKEN") },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    if (res.status === 429 || res.status >= 500) {
      await espera(2000 * (tentativa + 1));
      continue;
    }
    const j = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string; extensions?: { code?: string } }[] };
    if (j.errors?.some((e) => e.extensions?.code === "THROTTLED")) {
      await espera(2000 * (tentativa + 1));
      continue;
    }
    if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join("; "));
    return j.data ?? {};
  }
  throw new Error("Shopify ocupada demais (limite de ritmo)");
}

const emailValido = (e: string) => /^[^\s"@]+@[^\s"@]+\.[^\s"@]+$/.test(e);

/** Lê o arquivo, acha cada email na Shopify e põe a tag em quem ainda não tem. */
export async function marcarPorEmail(arquivo: string, tag: string): Promise<void> {
  if (progressoMarcar.rodando) throw new Error("Já tem uma marcação rodando.");
  if (!/^[\w.-]+\.txt$/.test(arquivo)) throw new Error("Nome de arquivo inválido.");
  const emails = [...new Set((await readFile(join(PASTA, arquivo), "utf8")).split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(emailValido))];
  Object.assign(progressoMarcar, { rodando: true, tag, total: emails.length, lidos: 0, achadas: 0, jaTinham: 0, marcadas: 0, erros: 0, ultimoErro: undefined, inicio: new Date().toISOString(), fim: undefined });
  try {
    for (let i = 0; i < emails.length; i += 40) {
      const lote = emails.slice(i, i + 40);
      let ids: string[] = [];
      try {
        const q = lote.map((e) => `email:"${e}"`).join(" OR ");
        const d = await gql(`query($q: String!) { customers(first: 100, query: $q) { nodes { id defaultEmailAddress { emailAddress } tags } } }`, { q });
        const nodes = ((d.customers as { nodes: { id: string; defaultEmailAddress: { emailAddress: string } | null; tags: string[] }[] }) ?? { nodes: [] }).nodes;
        const doLote = new Set(lote);
        const certos = nodes.filter((n) => n.defaultEmailAddress && doLote.has(n.defaultEmailAddress.emailAddress.toLowerCase()));
        progressoMarcar.achadas += certos.length;
        progressoMarcar.jaTinham += certos.filter((n) => n.tags.includes(tag)).length;
        ids = certos.filter((n) => !n.tags.includes(tag)).map((n) => n.id);
      } catch (e) {
        progressoMarcar.erros++;
        progressoMarcar.ultimoErro = e instanceof Error ? e.message : String(e);
      }
      for (let k = 0; k < ids.length; k += 20) {
        const parte = ids.slice(k, k + 20);
        const corpo = parte.map((id, n) => `m${n}: tagsAdd(id: "${id}", tags: $t) { userErrors { message } }`).join("\n");
        try {
          const d = await gql(`mutation($t: [String!]!) {\n${corpo}\n}`, { t: [tag] });
          for (const v of Object.values(d) as { userErrors: { message: string }[] }[]) {
            if (v.userErrors?.length) {
              progressoMarcar.erros++;
              progressoMarcar.ultimoErro = v.userErrors[0].message;
            } else progressoMarcar.marcadas++;
          }
        } catch (e) {
          progressoMarcar.erros++;
          progressoMarcar.ultimoErro = e instanceof Error ? e.message : String(e);
        }
        await espera(400);
      }
      progressoMarcar.lidos = Math.min(emails.length, i + lote.length);
      await espera(300);
    }
  } finally {
    progressoMarcar.rodando = false;
    progressoMarcar.fim = new Date().toISOString();
  }
}
