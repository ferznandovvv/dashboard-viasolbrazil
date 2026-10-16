import { readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { exigir } from "@/lib/financeiro/auth";
import { PASTA_ANEXOS, alterarBase } from "@/lib/financeiro/base";

export const dynamic = "force-dynamic";

/** Abre um anexo (só para quem está logado no financeiro). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const id = basename((await params).id); // nada de "../"
  const anexo = atual.base.contas.flatMap((c) => c.anexos ?? []).find((a) => a.id === id);
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado." }, { status: 404 });
  const conteudo = await readFile(join(PASTA_ANEXOS, id)).catch(() => null);
  if (!conteudo) return NextResponse.json({ erro: "Arquivo sumiu da pasta." }, { status: 404 });
  return new NextResponse(new Uint8Array(conteudo), {
    headers: {
      "Content-Type": anexo.tipo || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(anexo.nome)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** Tira um anexo da conta (o arquivo continua na cópia de segurança). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const id = basename((await params).id);
  await alterarBase((base) => {
    for (const c of base.contas) if (c.anexos?.some((a) => a.id === id)) c.anexos = c.anexos.filter((a) => a.id !== id);
  });
  await rm(join(PASTA_ANEXOS, id), { force: true });
  return NextResponse.json({ ok: true });
}
