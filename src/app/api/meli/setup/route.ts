import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API = "https://api.mercadolibre.com";

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
a.btn{display:inline-block;background:#0b0b0b;color:#f9f9f7;border-radius:8px;padding:10px 18px;text-decoration:none;font-size:14px;font-weight:600;margin-top:8px}
</style></head><body><div class="card"><h1>Conexão Mercado Livre</h1>${inner}</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Autorização do Mercado Livre em duas fases:
 *  - sem ?code= : mostra o botão/link de autorização (usa ML_CLIENT_ID)
 *  - com ?code= : troca por refresh token, testa a API e exibe as variáveis
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const code = req.nextUrl.searchParams.get("code");
  const redirectUri = `https://${req.headers.get("host")}/`;

  if (!clientId || !clientSecret) {
    return page(
      "Falta configurar",
      `<div class="s">Configuração incompleta</div>
       <p>Adicione <code>ML_CLIENT_ID</code> e <code>ML_CLIENT_SECRET</code> nas variáveis
       de ambiente da Vercel e faça redeploy antes de abrir esta página.</p>`,
      false
    );
  }

  if (!code) {
    const authUrl =
      `https://auth.mercadolivre.com.br/authorization?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=meli`;
    return page(
      "Autorizar Mercado Livre",
      `<div class="s">Pronto para autorizar</div>
       <p>Faça login na conta <b>vendedora</b> do Mercado Livre e clique abaixo.
       Importante: no app criado no DevCenter, a URI de redirecionamento precisa ser
       exatamente <code>${redirectUri}</code>.</p>
       <a class="btn" href="${authUrl}">Autorizar acesso à conta</a>`,
      true
    );
  }

  try {
    const tokenRes = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(
        `Troca do código falhou: ${tokenJson.message ?? tokenJson.error ?? tokenRes.status}`
      );
    }
    const { access_token, refresh_token, user_id } = tokenJson;

    const meRes = await fetch(`${API}/users/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
      cache: "no-store",
    });
    const me = await meRes.json();

    const ordersRes = await fetch(
      `${API}/orders/search?seller=${user_id}&limit=1&sort=date_desc`,
      { headers: { Authorization: `Bearer ${access_token}` }, cache: "no-store" }
    );
    const ordersJson = await ordersRes.json();
    const orderTest = ordersRes.ok
      ? `OK — ${ordersJson.paging?.total ?? 0} pedido(s) no total da conta`
      : `falhou: ${ordersJson.message ?? ordersRes.status}`;

    return page(
      "Autorizado!",
      `<div class="s">✓ Conta autorizada — ${me.nickname ?? user_id}</div>
       <p><b>Teste da API de pedidos:</b> ${orderTest}</p>
       <p>Adicione esta variável na Vercel (<b>Settings → Environment Variables</b>)
       e faça redeploy:</p>
       <table>
         <tr><td>ML_REFRESH_TOKEN</td><td><code>${refresh_token}</code></td></tr>
       </table>
       <p>O dashboard renova o access token sozinho. Atenção: no Mercado Livre o
       refresh token é rotativo — se um dia o canal cair com erro de token, é só
       abrir <code>/api/meli/setup</code> de novo e repetir esta autorização.</p>`,
      true
    );
  } catch (e) {
    return page(
      "Erro",
      `<div class="s">✗ ${e instanceof Error ? e.message : "Erro desconhecido"}</div>
       <p>Gere uma nova autorização abrindo <code>/api/meli/setup</code> (o código
       expira rápido) ou me mande esta mensagem de erro no chat.</p>`,
      false
    );
  }
}
