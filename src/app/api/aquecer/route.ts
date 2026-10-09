import { NextRequest, NextResponse } from "next/server";
import { aquecer, continuarEstoque } from "@/lib/aquecer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Aquecimento do cache, chamado pelo cron da Vercel (ou à mão). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (req.nextUrl.searchParams.get("so") === "estoque") {
    return NextResponse.json(await continuarEstoque());
  }
  return NextResponse.json(await aquecer());
}
