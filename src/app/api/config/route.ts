import { NextRequest, NextResponse } from "next/server";
import { blobAvailable, readConfig, writeConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await readConfig();
  return NextResponse.json({ ...cfg, persisted: blobAvailable() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const meta = parseFloat(body.meta ?? body.metaMensal);
  const unidade = typeof body.unidade === "string" ? body.unidade : "";
  if (!(meta >= 0)) {
    return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
  }
  if (!blobAvailable()) {
    // Sem Blob Store configurado: o cliente guarda no navegador
    return NextResponse.json({ persisted: false });
  }
  const cfg = await readConfig();
  if (unidade) {
    await writeConfig({ ...cfg, metas: { ...(cfg.metas ?? {}), [unidade]: meta } });
  } else {
    await writeConfig({ ...cfg, metaMensal: meta });
  }
  return NextResponse.json({ persisted: true });
}
