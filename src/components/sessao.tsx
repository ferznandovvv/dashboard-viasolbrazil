"use client";

import { createContext, useContext } from "react";
import type { Sessao } from "@/lib/acesso/sessao";
import { type Area, temArea } from "@/lib/acesso/regras";

const SessaoContexto = createContext<Sessao | null>(null);

export const ProvedorSessao = SessaoContexto.Provider;

/** Quem está usando a tela (null em tela de aparelho aberta pelo código). */
export const useSessao = () => useContext(SessaoContexto);

/** Atalho para esconder o que o papel não pode usar. */
export function usePode(area: Area): boolean {
  const s = useSessao();
  return s ? temArea(s.papel, area) : false;
}
