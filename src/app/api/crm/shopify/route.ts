import { NextRequest, NextResponse } from "next/server";
import { diagnosticoShopify, progressoShopify, sincronizarShopify } from "@/lib/crm/shopify";
import { hojeSp, somarDias } from "@/lib/crm/base";
import { marcarPorEmail, progressoMarcar } from "@/lib/crm/marcarClientes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json(progressoShopify);
}

type Pedido =
  | { acao: "sincronizar"; de?: string; ate?: string; creditar?: boolean }
  | { acao: "diag" }
  | { acao: "marcar-emails"; arquivo: string; tag: string }
  | { acao: "marcar-status" };

/** Sincronização dos pedidos do site (em segundo plano) ou diagnóstico. */
export async function POST(req: NextRequest) {
  const p = (await req.json().catch(() => ({}))) as Pedido;
  try {
    if (p.acao === "diag") return NextResponse.json(await diagnosticoShopify());
    // Tag em clientes da Shopify a partir de uma lista de emails (público de email marketing)
    if (p.acao === "marcar-status") return NextResponse.json(progressoMarcar);
    if (p.acao === "marcar-emails") {
      const tag = String(p.tag ?? "").trim();
      if (!/^[\w-]{3,40}$/.test(tag)) return NextResponse.json({ erro: "Tag inválida." }, { status: 400 });
      if (progressoMarcar.rodando) return NextResponse.json({ erro: "Já tem uma marcação rodando." }, { status: 409 });
      void marcarPorEmail(String(p.arquivo ?? ""), tag).catch((e) => {
        progressoMarcar.ultimoErro = e instanceof Error ? e.message : String(e);
      });
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json(progressoMarcar);
    }
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
