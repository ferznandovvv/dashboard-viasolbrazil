/** Peças comuns às telas do financeiro. */

import type { Categoria, Empresa, GrupoDre, UsuarioPublico } from "@/lib/financeiro/tipos";

export interface Cadastros {
  empresas: Empresa[];
  categorias: Categoria[];
  unidades: string[];
  grupos: { id: GrupoDre; nome: string; dica: string }[];
  formas: string[];
  usuarios: UsuarioPublico[];
  backupDir?: string;
}

/** fetch que devolve o JSON ou lança a mensagem de erro da rota. */
export async function api<T>(url: string, opcoes: RequestInit = {}): Promise<T> {
  const r = await fetch(url, {
    cache: "no-store",
    ...opcoes,
    headers: opcoes.body ? { "Content-Type": "application/json", ...opcoes.headers } : opcoes.headers,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { erro?: string }).erro ?? `Erro ${r.status}`);
  return j as T;
}

export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "1.234,56" ou "1234.56" → 1234.56 */
export function lerValor(texto: string): number {
  const t = texto.trim().replace(/[R$\s]/g, "");
  if (!t) return 0;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return Number(normal) || 0;
}

export const valorParaCampo = (v: number) =>
  v ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

export const dataBr = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const nomeMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
export const nomeMesLongo = (ym: string) =>
  new Date(`${ym}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

export function hojeSp(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
