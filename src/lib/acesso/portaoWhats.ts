/**
 * Portaria da WA-AKG (porta 3300). O túnel manda whats.viasolbrazil.com.br para
 * cá, não direto para a WA-AKG. Sem o cookie da portaria, a pessoa vai para o
 * painel (/whats), que confere se é o dono e devolve um passe de uso único; a
 * portaria troca o passe por um cookie de 30 dias e daí em diante repassa tudo
 * para a WA-AKG, inclusive a conexão ao vivo do chat.
 *
 * Roda dentro do servidor do painel, então se atualiza junto com ele.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, request as pedirHttp, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";
import { usarPasse } from "./ponteWhats";

const PORTA = Number(process.env.WAAKG_PORTAO_PORTA) || 3300;
const WA_PORTA = Number(process.env.WAAKG_PORTA) || 3200;
const PAINEL_PUBLICO = (process.env.PAINEL_URL_PUBLICA || "https://painel.viasolbrazil.com.br").replace(/\/+$/, "");
const ARQUIVO = join(process.env.DADOS_DIR ?? join(process.cwd(), "dados"), "portao-whats.json");
const TRINTA_DIAS = 30 * 24 * 3600 * 1000;
const hashId = (id: string) => createHash("sha256").update(id).digest("hex");

let cookies: Record<string, number> = {};
try {
  cookies = JSON.parse(readFileSync(ARQUIVO, "utf8"));
} catch {
  cookies = {};
}
function salvar() {
  const agora = Date.now();
  for (const [k, exp] of Object.entries(cookies)) if (exp < agora) delete cookies[k];
  try {
    writeFileSync(ARQUIVO, JSON.stringify(cookies));
  } catch {
    /* sem gravar, o pior é pedir para entrar de novo */
  }
}
const idDoCookie = (req: IncomingMessage) => /(?:^|;\s*)vs_whats=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || "")?.[1];
const cookieValido = (req: IncomingMessage) => {
  const id = idDoCookie(req);
  return Boolean(id && (cookies[hashId(id)] ?? 0) > Date.now());
};
const caminhoSeguro = (p: string | null) => (p && /^\/(?!\/)\S*$/.test(p) ? p : "/dashboard");

function pagina(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>WhatsApp</title><p style="font:16px system-ui;padding:24px">${html}</p>`);
}

function atender(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://portao");
  if (url.pathname === "/__portao/entrar") {
    const t = url.searchParams.get("t") || "";
    if (!t || !usarPasse(t)) return pagina(res, 403, `Passe vencido. <a href="${PAINEL_PUBLICO}/whats">Entrar de novo pelo painel</a>.`);
    const id = randomBytes(32).toString("base64url");
    cookies[hashId(id)] = Date.now() + TRINTA_DIAS;
    salvar();
    res.writeHead(302, {
      Location: caminhoSeguro(url.searchParams.get("volta")),
      "Set-Cookie": `vs_whats=${id}; Path=/; Max-Age=${TRINTA_DIAS / 1000}; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
    });
    return res.end();
  }
  if (url.pathname === "/__portao/sair") {
    const id = idDoCookie(req);
    if (id) delete cookies[hashId(id)];
    salvar();
    res.writeHead(302, { Location: PAINEL_PUBLICO, "Set-Cookie": "vs_whats=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
    return res.end();
  }
  if (url.pathname === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("User-agent: *\nDisallow: /\n");
  }
  if (!cookieValido(req)) {
    const volta = url.pathname === "/" ? "/dashboard" : url.pathname + url.search;
    res.writeHead(302, { Location: `${PAINEL_PUBLICO}/whats?volta=${encodeURIComponent(volta)}`, "Cache-Control": "no-store" });
    return res.end();
  }
  // Repassa como veio: o Host continua o do link, para o login da WA-AKG montar os endereços certos
  const p = pedirHttp({ host: "127.0.0.1", port: WA_PORTA, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  p.on("error", () => {
    if (!res.headersSent) pagina(res, 502, "O WhatsApp está reiniciando ou fora do ar. Tente de novo em 1 minuto.");
    else res.destroy();
  });
  req.pipe(p);
}

const g = globalThis as unknown as { __portaoWhats?: Server };

/** Liga a portaria (uma vez por servidor). Se a porta estiver presa (troca de versão), tenta de novo. */
export function ligarPortaoWhats(): void {
  if (g.__portaoWhats) return;
  const srv = createServer(atender);
  // Conversa ao vivo (Socket.IO): conexão direta, também só com o cookie
  srv.on("upgrade", (req: IncomingMessage, socket, head: Buffer) => {
    if (!cookieValido(req)) return socket.destroy();
    const alvo = connect(WA_PORTA, "127.0.0.1", () => {
      let cab = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) cab += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      alvo.write(cab + "\r\n");
      if (head?.length) alvo.write(head);
      socket.pipe(alvo).pipe(socket);
    });
    alvo.on("error", () => socket.destroy());
    socket.on("error", () => alvo.destroy());
  });
  srv.on("error", (e: NodeJS.ErrnoException) => {
    g.__portaoWhats = undefined;
    if (e.code === "EADDRINUSE") setTimeout(ligarPortaoWhats, 5000);
    else console.error("[portaria whats]", e.message);
  });
  srv.listen(PORTA, "127.0.0.1", () => console.log(`[portaria whats] porta ${PORTA}`));
  g.__portaoWhats = srv;
}
