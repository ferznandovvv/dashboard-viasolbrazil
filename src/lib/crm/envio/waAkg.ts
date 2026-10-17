/**
 * WA-AKG (github.com/mrifqidaffaaditya/WA-AKG): gateway WhatsApp não oficial
 * em cima do Baileys. Roda na mesma máquina do painel, uma sessão por loja.
 *
 * Envio: POST /api/messages/{sessionId}/{jid}/send com header X-API-Key e
 * corpo { message: { text } }. A resposta traz data.key.id.
 */

import type { Adaptador, ResultadoEnvio, SituacaoNumero } from "./adaptador";

/**
 * Na WA-AKG cada sessão tem um nome (ex.: "centro") e um código interno
 * (ex.: "xgj7d9"); a API só responde pelo código. Aceitamos os dois: se o que
 * veio da configuração não for um código conhecido, procuramos pelo nome.
 */
const cacheSessoes = new Map<string, { em: number; porNome: Map<string, { id: string; status: string }> }>();

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

  /** Lista as sessões (com cache de 1 min) indexadas por nome e por código, em minúsculas. */
  private async sessoes(): Promise<Map<string, { id: string; status: string }>> {
    const c = cacheSessoes.get(this.url);
    if (c && Date.now() - c.em < 60000) return c.porNome;
    const porNome = new Map<string, { id: string; status: string }>();
    try {
      const r = await this.chamar("/api/sessions");
      const lista = (r.json?.data ?? []) as { name?: string; sessionId?: string; status?: string }[];
      for (const s of Array.isArray(lista) ? lista : []) {
        if (!s.sessionId) continue;
        const v = { id: s.sessionId, status: String(s.status ?? "") };
        porNome.set(s.sessionId.toLowerCase(), v);
        if (s.name) porNome.set(s.name.trim().toLowerCase(), v);
      }
    } catch {
      /* sem lista: segue com o que veio */
    }
    cacheSessoes.set(this.url, { em: Date.now(), porNome });
    return porNome;
  }

  /** Código interno da sessão a partir do nome ou do próprio código. */
  private async resolver(sessao: string): Promise<{ id: string; status?: string }> {
    const achado = (await this.sessoes()).get(sessao.trim().toLowerCase());
    return achado ?? { id: sessao.trim() };
  }

  async nomeDaSessao(codigo: string): Promise<string | undefined> {
    for (const [chave, v] of await this.sessoes()) if (v.id === codigo && chave !== codigo.toLowerCase()) return chave;
    return undefined;
  }

  async enviarTexto(sessao: string, telefone: string, texto: string): Promise<ResultadoEnvio> {
    const jid = `${telefone.replace(/\D/g, "")}@s.whatsapp.net`;
    try {
      const { id } = await this.resolver(sessao);
      const r = await this.chamar(`/api/messages/${encodeURIComponent(id)}/${encodeURIComponent(jid)}/send`, {
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
      cacheSessoes.delete(this.url); // consulta de situação sempre olha a lista fresca
      const { id, status: daLista } = await this.resolver(sessao);
      const r = await this.chamar(`/api/sessions/${encodeURIComponent(id)}`);
      if (r.status === 404) {
        const nomes = Array.from((await this.sessoes()).keys()).filter((k) => k !== id.toLowerCase());
        return { sessao, conectado: false, detalhe: `sessão "${sessao}" não existe na WA-AKG${nomes.length ? ` (existem: ${nomes.join(", ")})` : ""}` };
      }
      if (r.status !== 200) return { sessao, conectado: false, detalhe: `HTTP ${r.status}` };
      const data = (r.json?.data ?? r.json) as Record<string, unknown>;
      const status = String(data?.status ?? data?.connectionStatus ?? daLista ?? "").toUpperCase();
      return { sessao, conectado: /^(CONNECTED|OPEN|READY|ONLINE)\b/.test(status), detalhe: `${status || "sem status"}${id !== sessao ? ` · código ${id}` : ""}` };
    } catch (e) {
      return { sessao, conectado: false, detalhe: e instanceof Error ? e.message : String(e) };
    }
  }
}
