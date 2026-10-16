/**
 * WhatsApp Cloud API (oficial da Meta). Entra no lugar da WA-AKG sem mexer
 * no resto do CRM: aqui `sessao` é o phone_number_id do número.
 *
 * Atenção: fora da janela de 24h desde a última mensagem da cliente, a API
 * oficial só aceita template aprovado. Este adaptador manda texto livre, que
 * serve para respostas e testes; para campanhas em escala é preciso cadastrar
 * os modelos na Meta e mandar como template (fica para quando migrar).
 */

import type { Adaptador, ResultadoEnvio, SituacaoNumero } from "./adaptador";

const GRAPH = "https://graph.facebook.com/v21.0";

export class CloudApi implements Adaptador {
  nome = "WhatsApp Cloud API";
  constructor(private token: string) {}

  async enviarTexto(sessao: string, telefone: string, texto: string): Promise<ResultadoEnvio> {
    try {
      const r = await fetch(`${GRAPH}/${sessao}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: telefone.replace(/\D/g, ""), type: "text", text: { body: texto } }),
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
      if (r.ok && j.messages?.[0]?.id) return { ok: true, idExterno: j.messages[0].id };
      return { ok: false, erro: `Cloud API ${r.status}: ${j.error?.message ?? "sem detalhe"}` };
    } catch (e) {
      return { ok: false, erro: `Cloud API indisponível: ${e instanceof Error ? e.message : e}` };
    }
  }

  async situacao(sessao: string): Promise<SituacaoNumero> {
    try {
      const r = await fetch(`${GRAPH}/${sessao}?fields=display_phone_number,quality_rating`, {
        headers: { Authorization: `Bearer ${this.token}` },
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { display_phone_number?: string; quality_rating?: string; error?: { message: string } };
      if (!r.ok) return { sessao, conectado: false, detalhe: j.error?.message };
      return { sessao, conectado: true, detalhe: `${j.display_phone_number ?? ""} ${j.quality_rating ?? ""}`.trim() };
    } catch (e) {
      return { sessao, conectado: false, detalhe: e instanceof Error ? e.message : String(e) };
    }
  }
}
