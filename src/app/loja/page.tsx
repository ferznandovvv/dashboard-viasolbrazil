import { redirect } from "next/navigation";

/**
 * A tela das lojas (metas) e o caixa viraram uma tela só, em /crm/loja.
 * Este endereço continua valendo para os tablets e TVs que já estão com ele
 * aberto: leva para a tela nova com a mesma loja e o mesmo código.
 */
export default async function TelaLojaAntiga({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  const q = new URLSearchParams();
  if (p.nome) q.set("loja", p.nome);
  if (p.k) q.set("k", p.k);
  redirect(`/crm/loja${q.size ? `?${q}` : ""}`);
}
