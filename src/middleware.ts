import { NextRequest, NextResponse } from "next/server";

/**
 * Proteção opcional por senha: defina DASHBOARD_PASSWORD nas variáveis de
 * ambiente e o dashboard passa a exigir login. Sem a variável, fica aberto.
 */
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // Rotas públicas: login, modo TV (só agregados, sem dados de cliente)
  // e o snapshot do cron (protegido por CRON_SECRET quando definido).
  const publicPaths = ["/login", "/api/login", "/tv", "/api/tv", "/api/snapshot"];
  if (publicPaths.includes(pathname)) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("vs_auth")?.value;
  if (cookie === expectedCookie(password)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

function expectedCookie(password: string): string {
  // Hash simples (FNV-1a) — evita guardar a senha em texto no cookie.
  // Roda no Edge runtime, onde node:crypto não está disponível.
  let h = 0x811c9dc5;
  const s = `viasol:${password}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
