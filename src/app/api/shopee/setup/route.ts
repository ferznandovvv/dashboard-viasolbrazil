import { NextRequest, NextResponse } from "next/server";
import { rodandoLocal, salvarCredenciais } from "@/lib/credenciais";
import { env } from "@/lib/env";
import { SHOPEE_HOST, agora, assinarShopee } from "@/lib/connectors/shopee";

export const dynamic = "force-dynamic";

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
code{background:#f0efec;border:1px solid #e1e0d9;border-radius:4px;padding:2px 6px;font-size:12px;word-break:break-all;display:inline-block}
a.btn{display:inline-block;background:#ee4d2d;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-size:14px;font-weight:600;margin-top:8px}
</style></head><body><div class="card"><h1>Conexão Shopee</h1>${inner}</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Endereço por onde a pessoa abriu o painel (domínio do túnel ou localhost). */
function origem(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/**
 * Autorização da loja na Shopee:
 *  - sem ?code= : botão que leva à Shopee (assinado com a Partner Key)
 *  - com ?code=&shop_id= : a Shopee voltou para cá; troca o código pelos
 *    tokens e guarda no cofre da máquina
 */
export async function GET(req: NextRequest) {
  const partnerId = env("SHOPEE_PARTNER_ID");
  const partnerKey = env("SHOPEE_PARTNER_KEY");
  const code = req.nextUrl.searchParams.get("code");
  const shopId = req.nextUrl.searchParams.get("shop_id");
  // A Shopee volta direto para esta mesma página — por isso não precisa trocar
  // o endereço à mão, como no Mercado Livre
  const redirect = `${origem(req)}/api/shopee/setup`;

  if (!partnerId || !partnerKey) {
    return page(
      "Falta configurar",
      `<div class="s">Configuração incompleta</div>
       <p>Cole o <code>Partner ID</code> e a <code>Partner Key</code> do app da Shopee na
       <a href="/configurar">tela de configuração</a> e volte aqui.</p>`,
      false
    );
  }

  if (!code || !shopId) {
    const caminho = "/api/v2/shop/auth_partner";
    const ts = agora();
    const url =
      `${SHOPEE_HOST}${caminho}?partner_id=${encodeURIComponent(partnerId)}&timestamp=${ts}` +
      `&sign=${assinarShopee(caminho, ts)}&redirect=${encodeURIComponent(redirect)}`;
    return page(
      "Autorizar Shopee",
      `<div class="s">Pronto para autorizar</div>
       <p>Entre com a conta <b>vendedora</b> da Shopee e autorize. Depois a Shopee volta
       sozinha para esta página.</p>
       <p style="font-size:12.5px">Se a Shopee recusar o endereço de retorno: no app do
       Open Platform, o domínio de redirecionamento tem que ser <code>${new URL(redirect).host}</code>.</p>
       <a class="btn" href="${url}">Autorizar a loja na Shopee</a>`,
      true
    );
  }

  try {
    const caminho = "/api/v2/auth/token/get";
    const ts = agora();
    const res = await fetch(
      `${SHOPEE_HOST}${caminho}?partner_id=${encodeURIComponent(partnerId)}&timestamp=${ts}&sign=${assinarShopee(caminho, ts)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, shop_id: Number(shopId), partner_id: Number(partnerId) }),
        cache: "no-store",
      }
    );
    const j = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      message?: string;
    };
    if (!j.refresh_token) throw new Error(`Troca do código falhou: ${j.error || res.status} — ${j.message ?? ""}`);

    const salvoLocal = rodandoLocal();
    if (salvoLocal) salvarCredenciais({ SHOPEE_REFRESH_TOKEN: j.refresh_token, SHOPEE_SHOP_ID: shopId });

    return page(
      "Autorizado!",
      `<div class="s">✓ Loja autorizada — shop_id ${shopId}</div>
       ${
         salvoLocal
           ? `<p style="background:#e7f4ea;border:1px solid #b7dcc0;border-radius:8px;padding:10px;color:#1f5c2e">✓ <b>Salvo e já valendo.</b> Os pedidos da Shopee aparecem no card Online em alguns minutos — <a href="/">ver vendas</a>.</p>`
           : `<p>Rodando fora da máquina da empresa: guarde SHOPEE_REFRESH_TOKEN e SHOPEE_SHOP_ID nas variáveis de ambiente.</p>`
       }
       <p>O painel renova o acesso sozinho. A autorização da Shopee vale por um ano; quando
       vencer, é só abrir esta página e autorizar de novo.</p>`,
      true
    );
  } catch (e) {
    return page(
      "Erro",
      `<div class="s">✗ ${e instanceof Error ? e.message : "Erro desconhecido"}</div>
       <p>O código da Shopee expira em poucos minutos: abra <a href="/api/shopee/setup">/api/shopee/setup</a>
       e autorize de novo. Se repetir, me mande esta mensagem.</p>`,
      false
    );
  }
}
