import { NextRequest } from "next/server";
import { LOJAS } from "../connectors/totvs";
import { temArea } from "./regras";
import { codigoDeAparelho, sessaoDe } from "./sessao";

/**
 * Lojas que este pedido pode ver nas telas da loja e no caixa: todas para o
 * dono, a sócia e o aparelho com o código; só as dela para o usuário de loja.
 * `null` = nenhuma (sem acesso).
 */
export async function lojasPermitidas(req: NextRequest): Promise<string[] | null> {
  const todas = Object.values(LOJAS);
  if (codigoDeAparelho(req)) return todas;
  const s = await sessaoDe(req);
  if (!s || !temArea(s.papel, "loja")) return null;
  return s.papel === "loja" ? s.lojas.filter((l) => todas.includes(l)) : todas;
}
