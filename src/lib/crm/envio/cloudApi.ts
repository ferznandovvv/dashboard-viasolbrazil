/**
 * WhatsApp Cloud API (oficial da Meta), o número do site. Aqui `sessao` é o
 * phone_number_id do número.
 *
 * Fora da janela de 24h desde a última mensagem da cliente, a Meta só aceita
 * modelo aprovado (enviarTemplate). Texto livre (enviarTexto) serve para
 * respostas dentro da janela, como a confirmação do SAIR.
 */

import type { Adaptador, ResultadoEnvio, SituacaoNumero } from "./adaptador";

export const GRAPH = process.env.META_GRAPH_URL ?? "https://graph.facebook.com/v21.0";

export interface TemplateNaMeta {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  /** Motivo da recusa, quando recusado */
  rejected_reason?: string;
  components?: { type: string; text?: string; format?: string; buttons?: { type: string; text?: string; url?: string }[] }[];
}

export class CloudApi implements Adaptador {
  nome = "WhatsApp Cloud API";
  constructor(private token: string) {}

  async enviarTexto(sessao: string, telefone: string, texto: string): Promise<ResultadoEnvio> {
    return this.post(`${sessao}/messages`, { messaging_product: "whatsapp", to: telefone.replace(/\D/g, ""), type: "text", text: { body: texto } });
  }

  /** Modelo aprovado: corpo com {{1}}, {{2}}... e, se tiver, botão de link com final variável. */
  async enviarTemplate(
    sessao: string,
    telefone: string,
    t: { nome: string; idioma: string; parametros: string[]; botao?: string }
  ): Promise<ResultadoEnvio> {
    const components: Record<string, unknown>[] = [];
    if (t.parametros.length)
      components.push({ type: "body", parameters: t.parametros.map((p) => ({ type: "text", text: p.trim() || "-" })) });
    if (t.botao) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: t.botao }] });
    return this.post(`${sessao}/messages`, {
      messaging_product: "whatsapp",
      to: telefone.replace(/\D/g, ""),
      type: "template",
      template: { name: t.nome, language: { code: t.idioma }, components },
    });
  }

  /** Inscreve o app do token nos webhooks da conta (sem isso a resposta da cliente não chega). */
  async assinarWebhooks(wabaId: string): Promise<{ ok: boolean; erro?: string }> {
    try {
      const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${this.token}` }, cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: { message: string } };
      return r.ok && j.success ? { ok: true } : { ok: false, erro: j.error?.message ?? `Meta ${r.status}` };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : String(e) };
    }
  }

  private async post(caminho: string, corpo: unknown): Promise<ResultadoEnvio> {
    try {
      const r = await fetch(`${GRAPH}/${caminho}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string; error_data?: { details?: string } } };
      if (r.ok && j.messages?.[0]?.id) return { ok: true, idExterno: j.messages[0].id };
      return { ok: false, erro: `Meta ${r.status}: ${j.error?.error_data?.details ?? j.error?.message ?? "sem detalhe"}` };
    } catch (e) {
      return { ok: false, erro: `Meta indisponível: ${e instanceof Error ? e.message : e}` };
    }
  }

  /** Modelos da conta (WABA), com a situação de cada um na Meta. */
  async modelos(wabaId: string): Promise<TemplateNaMeta[]> {
    const r = await fetch(`${GRAPH}/${wabaId}/message_templates?fields=id,name,language,status,category,rejected_reason,components&limit=200`, {
      headers: { Authorization: `Bearer ${this.token}` },
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as { data?: TemplateNaMeta[]; error?: { message: string } };
    if (!r.ok) throw new Error(`Meta ${r.status}: ${j.error?.message ?? "sem detalhe"}`);
    return j.data ?? [];
  }

  /** Manda um modelo para aprovação. */
  async criarModelo(wabaId: string, modelo: Record<string, unknown>): Promise<{ ok: boolean; detalhe: string }> {
    const r = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(modelo),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message: string; error_user_msg?: string } };
    if (r.ok) return { ok: true, detalhe: `enviado (${j.status ?? "em análise"})` };
    return { ok: false, detalhe: j.error?.error_user_msg ?? j.error?.message ?? `HTTP ${r.status}` };
  }

  async situacao(sessao: string): Promise<SituacaoNumero> {
    try {
      const r = await fetch(`${GRAPH}/${sessao}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`, {
        headers: { Authorization: `Bearer ${this.token}` },
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; quality_rating?: string; messaging_limit_tier?: string; error?: { message: string } };
      if (!r.ok) return { sessao, conectado: false, detalhe: j.error?.message };
      const qualidade: Record<string, string> = { GREEN: "qualidade alta", YELLOW: "qualidade média", RED: "qualidade baixa" };
      return {
        sessao,
        conectado: true,
        detalhe: [j.verified_name, j.display_phone_number, j.quality_rating ? qualidade[j.quality_rating] ?? j.quality_rating : "", j.messaging_limit_tier ? `limite ${j.messaging_limit_tier.replace("TIER_", "")}/dia` : ""].filter(Boolean).join(" · "),
      };
    } catch (e) {
      return { sessao, conectado: false, detalhe: e instanceof Error ? e.message : String(e) };
    }
  }
}
