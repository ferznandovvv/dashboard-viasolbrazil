import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** O primeiro acesso agora é o do sistema todo, na tela de entrar. */
export async function POST() {
  return NextResponse.json({ erro: "Crie a conta do dono na tela de entrada do painel." }, { status: 410 });
}
