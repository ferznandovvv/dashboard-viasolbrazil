/**
 * Passe de uso único para entrar na WA-AKG pelo link whats.: o painel (com o
 * dono logado) gera, a portaria (scripts/painel.mjs) troca por um cookie dela.
 * Vale 1 minuto e só uma vez. Fica na memória do servidor do painel.
 */

import { randomBytes } from "node:crypto";

const VALIDADE_MS = 60000;
const g = globalThis as unknown as { __passesWhats?: Map<string, number> };
const passes = (g.__passesWhats ??= new Map<string, number>());

export function gerarPasse(): string {
  const agora = Date.now();
  for (const [t, exp] of passes) if (exp < agora) passes.delete(t);
  const t = randomBytes(24).toString("base64url");
  passes.set(t, agora + VALIDADE_MS);
  return t;
}

/** Confere e gasta o passe. */
export function usarPasse(t: string): boolean {
  const exp = passes.get(t);
  passes.delete(t);
  return Boolean(exp && exp >= Date.now());
}
