import { NextResponse } from "next/server";
import { ultimosErros } from "@/lib/registroDeErros";

export const dynamic = "force-dynamic";

/** Os últimos erros do servidor (só o dono: rota de API fora da lista de áreas). */
export async function GET() {
  const texto = (await ultimosErros()) || "Nenhum erro registrado.";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Erros do painel</title><style>
body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;padding:20px 12px;max-width:960px;margin:0 auto}
h1{font-size:17px;margin:0 0 6px}p{font-size:13px;color:#52514e}
pre{background:#f0efec;border:1px solid #e1e0d9;border-radius:8px;padding:10px;font-size:11.5px;white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>Erros do painel</h1><p>Os mais recentes ficam no fim. Manda um print desta página quando algo quebrar.</p>
<pre>${texto.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
