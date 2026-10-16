/**
 * WA-AKG (github.com/mrifqidaffaaditya/WA-AKG): gateway WhatsApp não oficial
 * em cima do Baileys. Roda na mesma máquina do painel, uma sessão por loja.
 *
 * Envio: POST /api/messages/{sessionId}/{jid}/send com header X-API-Key e
 * corpo { message: { text } }. A resposta traz data.key.id.
 */

import type { Adaptador, ResultadoEnvio, SituacaoNumero } from "./adaptador";

export class WaAkg implements Adaptador {
  nome = "WA-AKG";
  constructor(
    private url: string,
    private apiKey: string
  ) {
    this.url = url.replace(/\/+$/, "");
  }

  private async chamar(caminho: string, corpo?: unknown): Promise<{ status: number; json: Record<string, unknown> | null; texto: string }> {
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), 30000);
    try {
      const r = await fetch(`${this.url}${caminho}`, {
        method: corpo ? "POST" : "GET",
        headers: { "X-API-Key": this.apiKey, "Content-Type": "application/json" },
        body: corpo ? JSON.stringify(corpo) : undefined,
        cache: "no-store",
        signal: controle.signal,
      });
      const texto = await r.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(texto);
      } catch {
        /* texto cru */
      }
      return { status: r.status, json, texto };
    } finally {
      clearTimeout(t);
    }
  }

  async enviarTexto(sessao: string, telefone: string, texto: string): Promise<ResultadoEnvio> {
    const jid = `${telefone.replace(/\D/g, "")}@s.whatsapp.net`;
    try {
      const r = await this.chamar(`/api/messages/${encodeURIComponent(sessao)}/${encodeURIComponent(jid)}/send`, {
        message: { text: texto },
      });
      if (r.status === 200 && r.json?.status) {
        const data = r.json.data as { key?: { id?: string } } | undefined;
        return { ok: true, idExterno: data?.key?.id };
      }
      const msg = (r.json?.error as string | undefined) ?? (r.json?.message as string | undefined) ?? r.texto.slice(0, 200);
      return { ok: false, erro: `WA-AKG ${r.status}: ${msg}` };
    } catch (e) {
      return { ok: false, erro: `WA-AKG indisponível: ${e instanceof Error ? e.message : e}` };
    }
  }

  async situacao(sessao: string): Promise<SituacaoNumero> {
    try {
      const r = await this.chamar(`/api/sessions/${encodeURIComponent(sessao)}`);
      if (r.status !== 200) return { sessao, conectado: false, detalhe: `HTTP ${r.status}` };
      const data = (r.json?.data ?? r.json) as Record<string, unknown>;
      const status = String(data?.status ?? data?.connectionStatus ?? "").toUpperCase();
      return { sessao, conectado: /CONNECTED|OPEN|READY/.test(status), detalhe: status || "sem status" };
    } catch (e) {
      return { sessao, conectado: false, detalhe: e instanceof Error ? e.message : String(e) };
    }
  }
}
