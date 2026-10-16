import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { exigir } from "@/lib/financeiro/auth";
import { PASTA_ANEXOS, alterarBase, copiaDeSeguranca, lerBase, novoId } from "@/lib/financeiro/base";

export const dynamic = "force-dynamic";

const LIMITE = 15 * 1024 * 1024;
const ACEITOS = /^(image\/|application\/pdf$)/;

/** Anexa um arquivo (boleto, nota, comprovante) a uma conta. Campos: conta, arquivo. */
export async function POST(req: NextRequest) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const form = await req.formData().catch(() => null);
  const contaId = String(form?.get("conta") ?? "");
  const arquivo = form?.get("arquivo");
  if (!contaId || !(arquivo instanceof File)) return NextResponse.json({ erro: "Escolha um arquivo." }, { status: 400 });
  if (arquivo.size > LIMITE) return NextResponse.json({ erro: "Arquivo maior que 15 MB." }, { status: 400 });
  if (!ACEITOS.test(arquivo.type)) return NextResponse.json({ erro: "Envie uma foto ou um PDF." }, { status: 400 });

  const id = novoId();
  const ext = extname(arquivo.name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 6) || (arquivo.type === "application/pdf" ? ".pdf" : ".jpg");
  await mkdir(PASTA_ANEXOS, { recursive: true });
  await writeFile(join(PASTA_ANEXOS, `${id}${ext}`), Buffer.from(await arquivo.arrayBuffer()));

  try {
    await alterarBase((base) => {
      const c = base.contas.find((x) => x.id === contaId);
      if (!c) throw new Error("Conta não encontrada.");
      c.anexos = [...(c.anexos ?? []), { id: `${id}${ext}`, nome: arquivo.name.slice(0, 120), tipo: arquivo.type, tamanho: arquivo.size }];
    });
    void lerBase().then((b) => copiaDeSeguranca(b, true));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
