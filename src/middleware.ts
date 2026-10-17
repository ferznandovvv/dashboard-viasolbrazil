import { NextRequest, NextResponse } from "next/server";
import { areaDaRota, inicio, publica, soLeitura, temArea } from "./lib/acesso/regras";
import { codigoDeAparelho, sessaoDe } from "./lib/acesso/sessao";

/**
 * Porteiro do sistema: cada página e cada rota de API só abre para quem
 * entrou e tem o papel certo. As telas de aparelho (TV, loja, caixa) também
 * abrem com o código da TV na URL, sem login.
 */
export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (publica(pathname) || codigoDeAparelho(req)) return NextResponse.next();

  const api = pathname.startsWith("/api/");
  const recusa = (erro: string, status: number) => NextResponse.json({ erro, error: erro }, { status });

  const s = await sessaoDe(req);
  if (!s) {
    if (api) return recusa("Entre com seu usuário.", 401);
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?volta=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  const area = areaDaRota(pathname, req.method, searchParams);
  if (area && !temArea(s.papel, area)) {
    if (api) return recusa("Seu usuário não tem acesso a esta parte.", 403);
    const url = req.nextUrl.clone();
    url.pathname = inicio(s.papel);
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (api && area && req.method !== "GET" && soLeitura(s.papel, area)) {
    return recusa("Seu usuário só pode consultar esta parte.", 403);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // Lê as contas do arquivo da máquina: precisa do Node, não do runtime de borda
  runtime: "nodejs",
};
