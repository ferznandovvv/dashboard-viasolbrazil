/**
 * WA-AKG (github.com/mrifqidaffaaditya/WA-AKG): gateway WhatsApp não oficial
 * em cima do Baileys. Roda na mesma máquina do painel, uma sessão por loja.
 *
 * Envio: POST /api/messages/{sessionId}/{jid}/send com header X-API-Key e
 * corpo { message: { text } }. A resposta traz data.key.id.
 */

import type { Adaptador, MensagemRecuperada, ResultadoEnvio, SituacaoNumero } from "./adaptador";

/**
 * Na WA-AKG cada sessão tem um nome (ex.: "centro") e um código interno
 * (ex.: "xgj7d9"); a API só responde pelo código. Aceitamos os dois: se o que
 * veio da configuração não for um código conhecido, procuramos pelo nome.
 */
const cacheSessoes = new Map<string, { em: number; porNome: Map<string, { id: string; status: string }> }>();

const cacheContatos = new Map<string, { em: number; mapa: Map<string, string> }>();

export class WaAkg implements Adaptador {
  nome = "WA-AKG";
  constructor(
    private url: string,
    private apiKey: string
  ) {
    this.url = url.replace(/\/+$/, "");
  }

  private async chamar(caminho: string, corpo?: unknown, metodo?: "PUT" | "DELETE"): Promise<{ status: number; json: Record<string, unknown> | null; texto: string }> {
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), 30000);
    try {
      const r = await fetch(`${this.url}${caminho}`, {
        method: metodo ?? (corpo ? "POST" : "GET"),
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

  /** Contatos da sessão, com cache de 10 minutos. Chave: só dígitos (telefone e, quando houver, o id novo do WhatsApp). */
  async contatos(sessao: string): Promise<Map<string, string>> {
    const chave = `${this.url}|${sessao}`;
    const c = cacheContatos.get(chave);
    if (c && Date.now() - c.em < 10 * 60000) return c.mapa;
    const mapa = new Map<string, string>();
    try {
      const { id } = await this.resolver(sessao);
      const r = await this.chamar(`/api/contacts/${encodeURIComponent(id)}?limit=all`);
      const lista = (r.json?.data ?? []) as { jid?: string; lid?: string; remoteJidAlt?: string; name?: string; notify?: string; verifiedName?: string }[];
      for (const k of Array.isArray(lista) ? lista : []) {
        const nome = (k.name || k.notify || k.verifiedName || "").trim();
        if (!nome) continue;
        for (const j of [k.jid, k.lid, k.remoteJidAlt]) {
          const dig = String(j ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");
          if (dig) mapa.set(dig, nome);
        }
      }
    } catch {
      /* sem contatos: fica o número */
    }
    cacheContatos.set(chave, { em: Date.now(), mapa });
    return mapa;
  }

  /**
   * Na WA-AKG o webhook pertence a uma sessão: sessão nova (ou recriada)
   * nasce sem webhook e o CRM não fica sabendo das conversas. Aqui olhamos
   * se a sessão já tem o nosso e, se não tiver, criamos.
   */
  async garantirWebhook(sessao: string, url: string): Promise<{ ok: boolean; detalhe: string }> {
    const EVENTOS = ["message.received", "message.sent", "message.status"];
    try {
      const { id } = await this.resolver(sessao);
      const r = await this.chamar(`/api/webhooks/${encodeURIComponent(id)}`);
      if (r.status !== 200) return { ok: false, detalhe: `não consegui ver os webhooks (HTTP ${r.status})` };
      const lista = (r.json?.data ?? []) as { id?: string; url?: string; isActive?: boolean; events?: unknown }[];
      const nossos = (Array.isArray(lista) ? lista : []).filter((w) => String(w.url ?? "").includes("/api/crm/webhook"));
      const erroDela = (c: { json: Record<string, unknown> | null }) => String(c.json?.message ?? c.json?.error ?? "").slice(0, 160);
      const certo = nossos.find((w) => w.isActive !== false && w.url === url);
      if (certo) {
        const ev = Array.isArray(certo.events) ? (certo.events as string[]) : [];
        const faltam = EVENTOS.filter((e) => !ev.includes(e) && !ev.includes("*"));
        if (!faltam.length) return { ok: true, detalhe: "webhook ok" };
      }
      // Já existe um nosso com endereço antigo (ex.: localhost) ou faltando evento: corrige ele
      const corrigir = certo ?? nossos.find((w) => w.id);
      if (corrigir?.id) {
        const c = await this.chamar(`/api/webhooks/${encodeURIComponent(id)}/${encodeURIComponent(corrigir.id)}`, { url, events: EVENTOS, isActive: true }, "PUT");
        if (c.status === 200) return { ok: true, detalhe: "webhook corrigido agora" };
        return { ok: false, detalhe: `não consegui corrigir o webhook (HTTP ${c.status}${erroDela(c) ? `: ${erroDela(c)}` : ""})` };
      }
      const c = await this.chamar(`/api/webhooks/${encodeURIComponent(id)}`, { name: "CRM Via Sol", url, events: EVENTOS });
      return c.status === 200 && c.json?.status
        ? { ok: true, detalhe: "webhook criado agora" }
        : { ok: false, detalhe: `não consegui criar o webhook (HTTP ${c.status}${erroDela(c) ? `: ${erroDela(c)}` : ""})` };
    } catch (e) {
      return { ok: false, detalhe: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Conversas com movimento desde `desde`: a lista de conversas (as 50 mais
   * recentes) e, das que mexeram, as últimas 100 mensagens.
   */
  async conversasRecentes(sessao: string, desde: string): Promise<MensagemRecuperada[]> {
    const { id } = await this.resolver(sessao);
    const r = await this.chamar(`/api/chat/${encodeURIComponent(id)}`);
    if (r.status !== 200) throw new Error(`lista de conversas: HTTP ${r.status}`);
    const chats = (Array.isArray(r.json?.data) ? r.json!.data : []) as { jid?: string; lastMessage?: { timestamp?: string } }[];
    const out: MensagemRecuperada[] = [];
    for (const c of chats) {
      const jid = String(c.jid ?? "");
      if (!/@(s\.whatsapp\.net|lid)$/.test(jid)) continue; // grupos, status e canais ficam de fora
      const ultima = c.lastMessage?.timestamp ? new Date(c.lastMessage.timestamp).toISOString() : "";
      if (ultima < desde) continue;
      const m = await this.chamar(`/api/chat/${encodeURIComponent(id)}/${encodeURIComponent(jid)}`);
      if (m.status !== 200 || !Array.isArray(m.json?.data)) continue;
      for (const x of m.json!.data as Record<string, unknown>[]) {
        const t = new Date(String(x.timestamp ?? ""));
        if (Number.isNaN(t.getTime())) continue;
        const em = t.toISOString();
        if (em < desde) continue;
        out.push({
          jid,
          id: String(x.keyId ?? ""),
          fromMe: Boolean(x.fromMe),
          tipo: String(x.type ?? "TEXT"),
          conteudo: typeof x.content === "string" ? x.content : "",
          em,
          nome: typeof x.pushName === "string" && x.pushName.trim() ? x.pushName.trim().slice(0, 60) : undefined,
        });
      }
    }
    return out;
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

  async iniciar(sessao: string): Promise<{ ok: boolean; detalhe: string }> {
    try {
      const { id } = await this.resolver(sessao);
      const r = await this.chamar(`/api/sessions/${encodeURIComponent(id)}/start`, {});
      cacheSessoes.delete(this.url);
      return r.status < 300 ? { ok: true, detalhe: "ligada" } : { ok: false, detalhe: `HTTP ${r.status}: ${String(r.json?.error ?? r.json?.message ?? r.texto).slice(0, 120)}` };
    } catch (e) {
      return { ok: false, detalhe: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Número do próprio WhatsApp da sessão (só dígitos), quando ela está conectada. */
  async meuNumero(sessao: string): Promise<string | undefined> {
    try {
      const { id } = await this.resolver(sessao);
      const r = await this.chamar(`/api/sessions/${encodeURIComponent(id)}`);
      const me = ((r.json?.data ?? r.json) as { me?: { id?: string } } | null)?.me;
      const dig = String(me?.id ?? "").split(/[:@]/)[0].replace(/\D/g, "");
      return dig.length >= 12 ? dig : undefined;
    } catch {
      return undefined;
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
