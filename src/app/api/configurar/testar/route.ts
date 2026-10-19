import { NextRequest, NextResponse } from "next/server";
import { limparCache } from "@/lib/cache";
import { loginIntegracao, totvsBaseUrl, totvsConfigured, totvsFetch } from "@/lib/connectors/totvs";
import { env } from "@/lib/env";
import { fetchShopifyOrders } from "@/lib/connectors/shopify";
import { fetchTikTokOrders } from "@/lib/connectors/tiktok";
import { fetchMeliOrders } from "@/lib/connectors/mercadolivre";
import { fetchShopeeOrders } from "@/lib/connectors/shopee";
import { fetchTikTokAdsSpend } from "@/lib/connectors/tiktokAds";
import { fetchMetaSpend } from "@/lib/connectors/meta";
import { addDays, todaySpKey } from "@/lib/types";
import type { ChannelResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Login da TOTVS passo a passo, mostrando o que a TOTVS respondeu de fato
 * (código HTTP e o começo da resposta). Serve para descobrir o que mudou
 * quando a TOTVS atualiza: endereço, caminho do login ou forma de entrar.
 */
async function diagnosticoTotvs(): Promise<{ ok: boolean; mensagem: string; detalhes: string[] }> {
  const det: string[] = [];
  if (!totvsConfigured()) return { ok: false, mensagem: "Faltam chaves: usuário e senha, e o Client ID (ou o endereço da nuvem da TOTVS).", detalhes: det };
  const base = totvsBaseUrl();
  det.push(`Endereço: ${base}`);
  const resumo = (status: number, texto: string) => `HTTP ${status} — ${texto.replace(/\s+/g, " ").slice(0, 280)}`;
  const tentar = async (rotulo: string, url: string, corpo: Record<string, string>) => {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(corpo),
        cache: "no-store",
      });
      const t = await r.text();
      det.push(`${rotulo}: ${resumo(r.status, t)}`);
      let token = "";
      try {
        token = (JSON.parse(t) as { access_token?: string }).access_token ?? "";
      } catch {
        /* não é JSON */
      }
      return token;
    } catch (e) {
      det.push(`${rotulo}: não conectou — ${e instanceof Error ? e.message : e}`);
      return "";
    }
  };

  const credenciais = {
    client_id: env("TOTVS_CLIENT_ID"),
    client_secret: env("TOTVS_CLIENT_SECRET"),
    username: env("TOTVS_USERNAME"),
    password: env("TOTVS_PASSWORD"),
  };
  const urlToken = `${base}/api/totvsmoda/authorization/v2/token`;
  // 1) Como sempre funcionou: usuário e senha
  let token = await tentar("Login (usuário e senha)", urlToken, { grant_type: "password", ...credenciais });
  // 2) Algumas versões só aceitam as credenciais do app
  if (!token)
    token = await tentar("Login (só client id/secret)", urlToken, {
      grant_type: "client_credentials",
      client_id: credenciais.client_id,
      client_secret: credenciais.client_secret,
    });
  if (!token) {
    // 3) Login de integração (TOTVS 2.8): usuário + senha + ambiente (tenant), em multipart
    const integ = await loginIntegracao();
    det.push(...integ.tentativas);
    if (typeof integ.resultado !== "string") {
      token = integ.resultado.token;
      det.push(`Entrou pelo login de integração (tenant ${integ.tenant}). O painel passa a usar este login sozinho.`);
    }
  }
  if (!token) {
    const tudo = det.join(" ");
    const mensagem = /não conectou/.test(tudo) && !/HTTP/.test(tudo)
      ? `Não consegui falar com a TOTVS em ${base}. Sem internet ou o endereço mudou — veja o novo com a TOTVS e coloque em "Endereço da API".`
      : /HTTP 404/.test(tudo)
        ? "O endereço do login não existe mais (404). A atualização deve ter mudado o endereço da API — peça o novo à TOTVS."
        : /invalid_client|unauthorized_client/i.test(tudo)
          ? "A TOTVS não reconhece o Client ID / secret. Confira na LOGFC006 se o app está ativo e se o secret foi copiado inteiro."
          : /invalid_grant/i.test(tudo)
            ? "Client ID e secret aceitos, mas usuário ou senha recusados (ADMFM026) — ou o usuário perdeu a permissão de API."
            : /Invalid client_id/i.test(tudo)
              ? "Client ID/secret não valem neste endereço e o login de integração também não entrou. Confira se o endereço é o da nuvem da Via Sol e, na ADMFM026, o tipo de privilégio do usuário (Padrão para o login com client id; Integração para o login de integração)."
              : "A TOTVS recusou o login. Veja abaixo o que ela respondeu.";
    return { ok: false, mensagem, detalhes: det };
  }

  // Login ok: testa a busca de notas com o token recém-obtido
  const hoje = todaySpKey();
  try {
    const r = await totvsFetch("/api/totvsmoda/fiscal/v2/invoices/search", {
      filter: { branchCodeList: [1], operationType: "Output", change: { startDate: `${hoje}T00:00:00`, endDate: `${hoje}T23:59:59` } },
      page: 1,
      pageSize: 1,
    });
    det.push(`Busca de notas: ${resumo(r.status, r.text)}`);
    if (r.status !== 200) return { ok: false, mensagem: "Login OK, mas a busca de notas falhou — a atualização pode ter mudado essa parte da API.", detalhes: det };
  } catch (e) {
    det.push(`Busca de notas: ${e instanceof Error ? e.message : e}`);
    return { ok: false, mensagem: "Login OK, mas a busca de notas deu erro.", detalhes: det };
  }
  return { ok: true, mensagem: "Login na TOTVS OK e a busca de notas respondeu.", detalhes: det };
}

/** Resume o resultado de um canal de vendas em uma frase. */
function canal(r: ChannelResult): { ok: boolean; mensagem: string } {
  if (!r.connected) return { ok: false, mensagem: "Faltam chaves (ou falta autorizar)." };
  if (r.error) return { ok: false, mensagem: r.error };
  return { ok: true, mensagem: `Funcionando — ${r.orders.length} pedido(s) nos últimos 7 dias.` };
}

/**
 * Testa uma integração agora, com as chaves que estão valendo, e devolve o
 * erro exato quando falha. ?id=totvs|shopify|tiktok|meli|shopee|tiktok-ads|meta
 */
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  limparCache(); // testa de verdade, sem resposta guardada
  const hoje = todaySpKey();
  const semana = new Date(Date.now() - 7 * 86400000);
  try {
    if (id === "totvs") return NextResponse.json(await diagnosticoTotvs());
    if (id === "shopify") return NextResponse.json(canal(await fetchShopifyOrders(semana)));
    if (id === "tiktok") return NextResponse.json(canal(await fetchTikTokOrders(semana)));
    if (id === "meli") return NextResponse.json(canal(await fetchMeliOrders(semana)));
    if (id === "shopee") return NextResponse.json(canal(await fetchShopeeOrders(semana)));
    if (id === "tiktok-ads" || id === "meta") {
      const r = id === "meta" ? await fetchMetaSpend(addDays(hoje, -6), hoje) : await fetchTikTokAdsSpend(addDays(hoje, -6), hoje);
      if (!r.connected) return NextResponse.json({ ok: false, mensagem: "Faltam chaves (ou falta autorizar)." });
      if (r.error) return NextResponse.json({ ok: false, mensagem: r.error });
      const gasto = r.daily.reduce((s, d) => s + d.spend, 0);
      return NextResponse.json({ ok: true, mensagem: `Funcionando — gasto de R$ ${gasto.toFixed(2).replace(".", ",")} nos últimos 7 dias.` });
    }
    return NextResponse.json({ ok: false, mensagem: "Integração desconhecida." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, mensagem: e instanceof Error ? e.message : "Erro desconhecido" });
  }
}
