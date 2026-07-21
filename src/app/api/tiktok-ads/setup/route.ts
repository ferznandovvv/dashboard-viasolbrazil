import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API = "https://business-api.tiktok.com/open_api/v1.3";

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
</style></head><body><div class="card"><h1>Conexão TikTok Ads</h1>${inner}</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Autorização do TikTok Ads (Marketing API):
 *  - sem ?auth_code= : mostra o link de autorização (usa TIKTOK_ADS_APP_ID)
 *  - com ?auth_code= : troca por access token e lista os advertiser IDs
 */
export async function GET(req: NextRequest) {
  const appId = process.env.TIKTOK_ADS_APP_ID;
  const secret = process.env.TIKTOK_ADS_APP_SECRET;
  const authCode = req.nextUrl.searchParams.get("auth_code");
  const redirectUri = `https://${req.headers.get("host")}/`;

  if (!appId || !secret) {
    return page(
      "Falta configurar",
      `<div class="s">Configuração incompleta</div>
       <p>Adicione <code>TIKTOK_ADS_APP_ID</code> e <code>TIKTOK_ADS_APP_SECRET</code> nas
       variáveis de ambiente da Vercel e faça redeploy antes de abrir esta página.</p>`,
      false
    );
  }

  if (!authCode) {
    const authUrl =
      `https://business-api.tiktok.com/portal/auth?app_id=${encodeURIComponent(appId)}` +
      `&state=ttads&redirect_uri=${encodeURIComponent(redirectUri)}`;
    return page(
      "Autorizar TikTok Ads",
      `<div class="s">Pronto para autorizar</div>
       <p>Faça login na conta que gerencia os anúncios do TikTok e clique abaixo.
       No app criado no portal de desenvolvedores, a URL de redirecionamento precisa ser
       exatamente <code>${redirectUri}</code>.</p>
       <a class="btn" href="${authUrl}">Autorizar acesso aos anúncios</a>`,
      true
    );
  }

  try {
    const tokenRes = await fetch(`${API}/oauth2/access_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
      cache: "no-store",
    });
    const tokenJson = await tokenRes.json();
    if (tokenJson.code !== 0 || !tokenJson.data?.access_token) {
      throw new Error(`Troca do código falhou: ${tokenJson.message ?? tokenRes.status}`);
    }
    const accessToken: string = tokenJson.data.access_token;
    const advertiserIds: string[] = (tokenJson.data.advertiser_ids ?? []).map(String);

    // Busca os nomes das contas pra ajudar a escolher o ID certo
    let advRows = advertiserIds.map((id) => `<tr><td>ID</td><td><code>${id}</code></td></tr>`);
    try {
      const infoUrl = new URL(`${API}/advertiser/info/`);
      infoUrl.searchParams.set("advertiser_ids", JSON.stringify(advertiserIds.slice(0, 25)));
      const infoRes = await fetch(infoUrl, {
        headers: { "Access-Token": accessToken },
        cache: "no-store",
      });
      const infoJson = await infoRes.json();
      if (infoJson.code === 0 && infoJson.data?.list?.length) {
        advRows = infoJson.data.list.map(
          (a: { advertiser_id: string; name: string }) =>
            `<tr><td>${a.name}</td><td><code>${a.advertiser_id}</code></td></tr>`
        );
      }
    } catch {
      /* mantém a lista simples de IDs */
    }

    return page(
      "Autorizado!",
      `<div class="s">✓ Conta autorizada</div>
       <p>Adicione estas variáveis na Vercel (<b>Settings → Environment Variables</b>)
       e faça redeploy:</p>
       <table>
         <tr><td>TIKTOK_ADS_ACCESS_TOKEN</td><td><code>${accessToken}</code></td></tr>
         <tr><td>TIKTOK_ADS_ADVERTISER_ID</td><td>escolha o ID da conta certa abaixo</td></tr>
         ${advRows.join("")}
       </table>
       <p>O token do TikTok Ads é de longa duração — não precisa renovar.</p>`,
      true
    );
  } catch (e) {
    return page(
      "Erro",
      `<div class="s">✗ ${e instanceof Error ? e.message : "Erro desconhecido"}</div>
       <p>Gere uma nova autorização abrindo <code>/api/tiktok-ads/setup</code> ou me mande
       esta mensagem de erro no chat.</p>`,
      false
    );
  }
}
