/**
 * Lista de categorias, guardada pronta no Blob.
 *
 * Calcular isso varrendo o estoque inteiro é justamente o que a tela quer
 * evitar: a lista existe para filtrar ANTES de qualquer consulta pesada.
 * Quem varre é o cron, de madrugada; a tela só lê o resultado.
 */

import { gravarBlob, lerBlobs } from "./blobCache";
import { categoriaDe } from "./produtos";
import type { SaldoProduto } from "./connectors/estoque";

const PREFIXO = "resumo/";
const CHAVE = "categorias";

export interface Categoria {
  nome: string;
  produtos: number;
  pecas: number;
}

export async function lerCategorias(): Promise<Categoria[] | null> {
  const guardado = await lerBlobs<Categoria[]>(PREFIXO, [CHAVE]);
  return guardado.get(CHAVE) ?? null;
}

export function calcularCategorias(itens: SaldoProduto[]): Categoria[] {
  const m = new Map<string, Categoria>();
  for (const item of itens) {
    const cat = categoriaDe(item.nome);
    if (!cat) continue;
    const e = m.get(cat) ?? { nome: cat, produtos: 0, pecas: 0 };
    e.produtos += 1;
    e.pecas += Object.values(item.porLoja).reduce((s, q) => s + q, 0);
    m.set(cat, e);
  }
  return Array.from(m.values())
    .filter((c) => c.produtos >= 3) // nome solto não vira categoria
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function gravarCategorias(categorias: Categoria[]): Promise<void> {
  if (categorias.length === 0) return;
  await gravarBlob(PREFIXO, CHAVE, categorias);
}
