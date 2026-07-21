import { NextRequest, NextResponse } from "next/server";
import { tiktokSign } from "@/lib/connectors/tiktok";

export const dynamic = "force-dynamic";

const AUTH_HOST = "https://auth.tiktok-shops.com";
const API_HOST = "https://open-api.tiktokglobalshop.com";

function page(title: string, inner: string, ok: boolean): NextResponse {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f9f9f7;color:#0b0b0b;display:flex;justify-content:center;padding:40px 16px}
.card{background:#fcfcfb;border:1px solid rgba(11,11,11,.1);border-radius:16px;padding:28px;max-width:640px;width:100%}
h1{font-size:18px;margin:0 0 4px}
.s{color:${ok ? "#006300" : "#d03b3b"};font-size:13px;margin-bottom:16px}
p{font-size:14px;line-height:1.5;color:#52514e}
table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0}
td{padding:8px;border-bottom:1px solid #e1e0d9;vertical-align:top}
td:first-child{font-weight:600;white-space:nowrap}
code{background:#f0efec;border:1px solid #e1e0d9;border-radius:4px;padding:2px 6px;font-size:12px;word-break:break-all;display:inline-block}
ol{font-size:14px;color:#52514e;line-height:1.7}
</style></head><body><div class="card"><h1>Conexão TikTok Shop</h1>${inner}</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Passo final da autorização do TikTok Shop: recebe o ?code= do redirect,
 * troca por access/refresh token e busca o shop_cipher da loja autorizada.
 * Mostra os valores para copiar nas variáveis de ambiente da Vercel.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;

  if (!appKey || !appSecret) {
    return page(
      "Falta configurar",
      `<div class="s">Configuração incompleta</div>
       <p>Antes de autorizar, adicione <code>TIKTOK_APP_KEY</code> e
       <code>TIKTOK_APP_SECRET</code> nas variáveis de ambiente da Vercel e faça redeploy.</p>`,
      false
    );
  }
  if (!code) {
    return page(
      "Código ausente",
      `<div class="s">Código de autorização não encontrado</div>
       <p>Abra este endereço a partir do redirecionamento da autorização do TikTok Shop
       (ele precisa vir com <code>?code=...</code> na URL).</p>`,
      false
    );
  }

  try {
    const tokenUrl = new URL(`${AUTH_HOST}/api/v2/token/get`);
    tokenUrl.searchParams.set("app_key", appKey);
    tokenUrl.searchParams.set("app_secret", appSecret);
    tokenUrl.searchParams.set("auth_code", code);
    tokenUrl.searchParams.set("grant_type", "authorized_code");
    const tokenRes = await fetch(tokenUrl, { cache: "no-store" });
    const tokenJson = await tokenRes.json();
    if (tokenJson.code !== 0 || !tokenJson.data?.access_token) {
      throw new Error(`Troca do código falhou: ${tokenJson.message ?? tokenRes.status}`);
    }
    const { access_token, refresh_token, seller_name } = tokenJson.data;

    // Teste direto da API de pedidos, com ou sem cipher
    const testOrders = async (cipher?: string): Promise<string> => {
      const path = "/order/202309/orders/search";
      const body = JSON.stringify({
        create_time_ge: Math.floor(Date.now() / 1000) - 30 * 86400,
      });
      const p: Record<string, string> = {
        app_key: appKey,
        timestamp: String(Math.floor(Date.now() / 1000)),
        ...(cipher ? { shop_cipher: cipher } : {}),
        page_size: "10",
      };
      p.sign = tiktokSign(path, p, body, appSecret);
      const u = new URL(`${API_HOST}${path}`);
      for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
      const r = await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tts-access-token": access_token },
        body,
        cache: "no-store",
      });
      const j = await r.json();
      if (j.code === 0) {
        const n = j.data?.orders?.length ?? 0;
        return `OK — ${n} pedido(s) retornado(s) nos últimos 30 dias`;
      }
      return `falhou: ${j.message ?? r.status} (code ${j.code})`;
    };

    // Tenta os dois endpoints que devolvem o cipher — qual funciona depende
    // do escopo ativado no app (Authorized Shops vs. Get Active Shops).
    const candidatePaths = ["/authorization/202309/shops", "/seller/202309/shops"];
    let shops: { cipher: string; name?: string; region?: string }[] = [];
    const failures: string[] = [];
    for (const shopsPath of candidatePaths) {
      const params: Record<string, string> = {
        app_key: appKey,
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
      params.sign = tiktokSign(shopsPath, params, "", appSecret);
      const shopsUrl = new URL(`${API_HOST}${shopsPath}`);
      for (const [k, v] of Object.entries(params)) shopsUrl.searchParams.set(k, v);
      const shopsRes = await fetch(shopsUrl, {
        headers: { "x-tts-access-token": access_token },
        cache: "no-store",
      });
      const shopsJson = await shopsRes.json();
      const found = (shopsJson.data?.shops ?? []).filter((s: { cipher?: string }) => s.cipher);
      if (shopsJson.code === 0 && found.length > 0) {
        shops = found;
        break;
      }
      failures.push(
        shopsJson.code === 0
          ? `${shopsPath}: respondeu OK mas sem cipher — resposta: ${JSON.stringify(shopsJson.data).slice(0, 400)}`
          : `${shopsPath}: ${shopsJson.message ?? shopsRes.status}`
      );
    }
    const cipher = shops[0]?.cipher;
    const orderTestNoCipher = cipher ? null : await testOrders();
    const orderTestWithCipher = cipher ? await testOrders(cipher) : null;
    const orderTest = orderTestWithCipher ?? orderTestNoCipher ?? "não testado";
    const worked = orderTest.startsWith("OK");

    const cipherRow = cipher
      ? `<tr><td>TIKTOK_SHOP_CIPHER</td><td><code>${cipher}</code><br><small>${shops[0].name ?? ""} (${shops[0].region ?? ""})</small></td></tr>`
      : "";

    return page(
      worked ? "Autorizado!" : "Quase lá",
      `<div class="s">${worked ? "✓" : "△"} Autorização concluída${seller_name ? ` — ${seller_name}` : ""}</div>
       <p><b>Teste da API de pedidos${cipher ? " (com cipher)" : " (sem cipher)"}:</b> ${orderTest}</p>
       ${
         !cipher
           ? `<p><small>Endpoints de cipher: ${failures.join(" | ") || "nenhum tentado"}</small></p>`
           : ""
       }
       <p>Adicione ${cipher ? "estas variáveis" : "esta variável"} na Vercel
       (<b>Settings → Environment Variables</b>) e faça redeploy:</p>
       <table>
         <tr><td>TIKTOK_REFRESH_TOKEN</td><td><code>${refresh_token}</code></td></tr>
         ${cipherRow}
       </table>
       <p>O dashboard renova o access token sozinho a partir do refresh token.
       ${
         worked
           ? "O teste passou — depois do redeploy o canal fica verde."
           : "O teste de pedidos falhou com a mensagem acima — me mande ela no chat."
       }</p>`,
      worked
    );
  } catch (e) {
    return page(
      "Erro",
      `<div class="s">✗ ${e instanceof Error ? e.message : "Erro desconhecido"}</div>
       <p>Tente gerar uma nova autorização (o código expira rápido) ou me mande esta
       mensagem de erro no chat.</p>`,
      false
    );
  }
}
