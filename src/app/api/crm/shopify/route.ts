import { NextRequest, NextResponse } from "next/server";
import { diagnosticoShopify, progressoShopify, sincronizarShopify } from "@/lib/crm/shopify";
import { hojeSp, somarDias } from "@/lib/crm/base";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json(progressoShopify);
}

type Pedido = { acao: "sincronizar"; de?: string; ate?: string; creditar?: boolean } | { acao: "diag" };

/** Sincronização dos pedidos do site (em segundo plano) ou diagnóstico. */
export async function POST(req: NextRequest) {
  const p = (await req.json().catch(() => ({}))) as Pedido;
  try {
    if (p.acao === "diag") return NextResponse.json(await diagnosticoShopify());
    if (p.acao === "sincronizar") {
      const hoje = hojeSp();
      const de = p.de ?? somarDias(hoje, -3);
      const ate = p.ate ?? hoje;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) {
        return NextResponse.json({ erro: "Período inválido." }, { status: 400 });
      }
      if (progressoShopify.rodando) return NextResponse.json({ erro: "Já tem uma sincronização rodando." }, { status: 409 });
      void sincronizarShopify(de, ate, { creditar: p.creditar ?? false }).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      return NextResponse.json(progressoShopify);
    }
    return NextResponse.json({ erro: "Ação desconhecida." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
