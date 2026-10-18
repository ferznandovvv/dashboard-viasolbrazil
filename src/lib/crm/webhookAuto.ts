/**
 * Confere (e cria, se faltar) o webhook de cada número ligado. Na WA-AKG o
 * webhook é por sessão, então cada loja pareada precisa do seu; sem ele o
 * painel não vê nenhuma conversa daquela loja.
 */

import { lerBase } from "./base";
import { adaptadorDe } from "./envio/adaptador";

export const urlDoWebhook = (segredo: string) => `http://localhost:${process.env.PORT || 3100}/api/crm/webhook?t=${segredo}`;

export async function configurarWebhooks(): Promise<Record<string, string>> {
  const base = await lerBase();
  const adaptador = adaptadorDe(base.config);
  const r: Record<string, string> = {};
  if (!adaptador?.garantirWebhook) return r;
  for (const n of base.config.numeros.filter((x) => x.ativo && x.sessao)) {
    const g = await adaptador.garantirWebhook(n.sessao, urlDoWebhook(base.config.webhookSegredo));
    r[n.loja] = g.detalhe;
  }
  return r;
}
