/**
 * Confere (e cria ou corrige, se faltar) o webhook de cada número ligado. Na
 * WA-AKG o webhook é por sessão, então cada loja pareada precisa do seu; sem
 * ele o painel não vê nenhuma conversa daquela loja.
 *
 * O endereço é o público (https://painel…): desde a 1.7 a WA-AKG só manda
 * webhook para HTTPS e recusa localhost. A mensagem sai para o Cloudflare e
 * volta pelo túnel; funciona igual na 1.6.
 */

import { alterarBase, lerBase } from "./base";
import { adaptadorDe } from "./envio/adaptador";
import { garantirLinksDasLojas } from "./linkLoja";
import { ENDERECO_PUBLICO_PADRAO, type ConfigCrm } from "./tipos";

export function urlDoWebhook(config: Pick<ConfigCrm, "webhookSegredo" | "enderecoPublico">): string {
  const publico = (config.enderecoPublico ?? ENDERECO_PUBLICO_PADRAO).trim().replace(/\/+$/, "");
  const base = publico || `http://localhost:${process.env.PORT || 3100}`;
  return `${base}/api/crm/webhook?t=${config.webhookSegredo}`;
}

/**
 * O endereço público chega mesmo neste painel? Pede pelo túnel o desafio de
 * verificação do webhook (o mesmo da Cloud API) e confere a resposta. Pega,
 * por exemplo, um Cloudflare Access ou um bloqueio de robô na frente do painel,
 * que fariam a WA-AKG não conseguir entregar as conversas.
 */
export async function testarEnderecoPublico(config: Pick<ConfigCrm, "webhookSegredo" | "enderecoPublico">): Promise<{ ok: boolean; detalhe: string }> {
  const url = urlDoWebhook(config);
  if (url.startsWith("http://localhost")) return { ok: true, detalhe: "webhook pelo localhost" };
  const desafio = Math.random().toString(36).slice(2, 10);
  const u = `${url.replace(/\?t=.*$/, "")}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(config.webhookSegredo)}&hub.challenge=${desafio}`;
  try {
    const r = await fetch(u, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000) });
    const texto = (await r.text()).trim();
    if (r.status === 200 && texto === desafio) return { ok: true, detalhe: "endereço público ok" };
    if (r.status >= 300 && r.status < 400) return { ok: false, detalhe: `o endereço público pede login (redirecionou, HTTP ${r.status}); tire o Cloudflare Access de /api/crm/webhook` };
    return { ok: false, detalhe: `o endereço público não respondeu como o painel (HTTP ${r.status})` };
  } catch (e) {
    return { ok: false, detalhe: `o endereço público não abriu (${e instanceof Error ? e.message : e})` };
  }
}

/**
 * O endereço que vale agora: o público, se ele chega mesmo neste painel; se
 * não chegar, o localhost (que serve até a WA-AKG 1.6), mais o motivo.
 */
export async function webhookQueVale(config: Pick<ConfigCrm, "webhookSegredo" | "enderecoPublico">): Promise<{ url: string; aviso?: string }> {
  const url = urlDoWebhook(config);
  if (url.startsWith("http://localhost")) return { url };
  const t = await testarEnderecoPublico(config);
  if (t.ok) return { url };
  return { url: urlDoWebhook({ ...config, enderecoPublico: "" }), aviso: `${t.detalhe}; usando localhost, que só funciona até a WA-AKG 1.6` };
}

export async function configurarWebhooks(): Promise<Record<string, string>> {
  const base = await lerBase();
  const adaptador = adaptadorDe(base.config);
  const r: Record<string, string> = {};
  // Número de cada loja (pro botão "Falar com a loja" da API oficial): lê da WA-AKG quando falta
  if (adaptador?.meuNumero) {
    const achados: Record<string, string> = {};
    // Conectada manda: se o número da sessão é outro (loja trocou de chip), corrige
    for (const n of base.config.numeros.filter((x) => x.sessao)) {
      const tel = await adaptador.meuNumero(n.sessao);
      if (tel && tel !== n.telefone) achados[n.loja] = tel;
    }
    if (Object.keys(achados).length)
      await alterarBase((b) => {
        for (const n of b.config.numeros) if (achados[n.loja]) n.telefone = achados[n.loja];
      });
  }
  // Link curto /w/<loja> na Shopify pro botão "Falar com a loja" da API oficial
  try {
    const links = await garantirLinksDasLojas();
    const erros = Object.entries(links).filter(([, d]) => d !== "ok");
    if (erros.length) console.error("[crm] link das lojas:", JSON.stringify(Object.fromEntries(erros)));
  } catch (e) {
    console.error("[crm] link das lojas:", e instanceof Error ? e.message : e);
  }
  if (!adaptador?.garantirWebhook) return r;
  const numeros = base.config.numeros.filter((x) => x.ativo && x.sessao);
  if (!numeros.length) return r;
  const { url, aviso } = await webhookQueVale(base.config);
  for (const n of numeros) {
    const g = await adaptador.garantirWebhook(n.sessao, url);
    r[n.loja] = aviso ? `${g.detalhe} (${aviso})` : g.detalhe;
  }
  return r;
}
