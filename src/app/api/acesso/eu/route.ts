import { NextRequest, NextResponse } from "next/server";
import { sessaoDe } from "@/lib/acesso/sessao";

export const dynamic = "force-dynamic";

/** Quem está usando o sistema agora. */
export async function GET(req: NextRequest) {
  return NextResponse.json({ sessao: await sessaoDe(req) });
}
