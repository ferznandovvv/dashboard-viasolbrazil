"use client";

import { useCallback, useEffect, useState } from "react";
import { Cabecalho } from "@/components/Moldura";

interface Resposta {
  commentId: string;
  em: string;
  usuario: string;
  texto: string;
  origem: string;
  status: "enviado" | "erro" | "repetido";
  detalhe?: string;
  via: string;
}

interface Estado {
  config: {
    ativo: boolean;
    palavras: string[];
    postsTambem: boolean;
    mensagem: string;
    link: string;
    campanha: string;
    token: string;
    tokenExpiraEm?: string;
    usuario: string;
    appSecret: string;
    verifyToken: string;
  };
  conectado: boolean;
  assinado: string[] | null;
  erroConta?: string;
  webhookUrl: string;
  vigia: { ligadaAte: string | null; ultimoErro?: string; liveId?: string; ultimaBusca?: string };
  hoje: { enviados: number; erros: number; repetidos: number };
  exemplo: string;
  respostas: Resposta[];
  eventos: { em: string; campo: string; resumo: string }[];
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** Robô do Instagram: quem comenta a palavra (ex.: QUERO) na live, post ou reel recebe o link no direct. */
export default function Instagram() {
  const [e, setE] = useState<Estado | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [token, setToken] = useState("");
  const [rascunho, setRascunho] = useState<Partial<Estado["config"]> & { palavrasTxt?: string }>({});
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/instagram", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setE((await r.json()) as Estado);
      setErro("");
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    }
  }, []);

  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [carregar]);

  async function acao(corpo: Record<string, unknown>, ok: string) {
    setOcupado(true);
    setAviso("");
    try {
      const r = await fetch("/api/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = (await r.json()) as { erro?: string; usuario?: string; assinatura?: string };
      if (!r.ok || j.erro) throw new Error(j.erro ?? `HTTP ${r.status}`);
      setAviso(j.usuario ? `Conta @${j.usuario} conectada. Avisos da Meta: ${j.assinatura}` : ok);
      await carregar();
      return true;
    } catch (x) {
      setAviso(`Não deu: ${x instanceof Error ? x.message : String(x)}`);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (!e) return <main className="wrap">{erro ? <p className="estado erro">{erro}</p> : <p className="estado">Carregando…</p>}</main>;

  const c = { ...e.config, ...rascunho };
  const mudou = Object.keys(rascunho).length > 0;
  const salvar = async () => {
    const { palavrasTxt, ...resto } = rascunho;
    const config = { ...resto, ...(palavrasTxt !== undefined ? { palavras: palavrasTxt.split(/[,;\n]/) } : {}) };
    if (await acao({ acao: "salvar", config }, "Salvo.")) setRascunho({});
  };
  const vigiaLigada = Boolean(e.vigia.ligadaAte);
  const live = e.assinado?.includes("live_comments");

  return (
    <main className="wrap">
      <Cabecalho titulo="Instagram: comentou, recebeu o link" />

      <section className="card cfg-card">
        <h2>Situação</h2>
        <label className="cfg-check">
          <input type="checkbox" checked={e.config.ativo} disabled={ocupado || !e.conectado} onChange={(x) => void acao({ acao: "salvar", config: { ativo: x.target.checked } }, x.target.checked ? "Robô ligado." : "Robô desligado.")} />
          <span>
            <b>Robô {e.config.ativo ? "ligado" : "desligado"}</b>
            <small>
              {e.conectado ? `Conta @${e.config.usuario}` : "Conecte a conta abaixo pra ligar"}
              {e.config.tokenExpiraEm ? ` · token vale até ${dia(e.config.tokenExpiraEm)} (renova sozinho)` : ""}
            </small>
          </span>
        </label>
        <p>
          Hoje: <b>{e.hoje.enviados}</b> links enviados · {e.hoje.repetidos} repetidos (já tinham recebido) · {e.hoje.erros} erros
        </p>
        {e.conectado && (
          <p className="muted">
            Avisos da Meta nesta conta: {e.assinado ? (e.assinado.length ? e.assinado.join(", ") : "nenhum") : "não consegui consultar"}
            {e.erroConta ? ` (${e.erroConta})` : ""}{" "}
            <button className="btn btn-disc btn-sm" disabled={ocupado} onClick={() => void acao({ acao: "assinar" }, "Avisos ligados.")}>
              ligar de novo
            </button>
          </p>
        )}
        {aviso && <p role="status">{aviso}</p>}
      </section>

      <section className="card cfg-card">
        <h2>Live</h2>
        <p className="muted">
          O caminho principal são os avisos da Meta{live ? " (live_comments está ligado)" : ""}. A vigia é a garantia: enquanto ligada, o painel lê os comentários da live a cada 3 segundos e responde o que o aviso não trouxe.
          Lembrete: na live, o Instagram só deixa mandar a DM enquanto ela está no ar.
        </p>
        <div className="cfg-faixa">
          {vigiaLigada ? (
            <>
              <span>
                Vigia ligada até <b>{hora(e.vigia.ligadaAte!)}</b>
                {e.vigia.liveId ? " · live encontrada" : " · nenhuma live no ar agora"}
                {e.vigia.ultimoErro ? ` · erro: ${e.vigia.ultimoErro}` : ""}
              </span>
              <button className="btn btn-sec btn-sm" disabled={ocupado} onClick={() => void acao({ acao: "vigia", horas: 0 }, "Vigia desligada.")}>
                Desligar vigia
              </button>
            </>
          ) : (
            <button className="btn btn-pri btn-sm" disabled={ocupado || !e.conectado} onClick={() => void acao({ acao: "vigia", horas: 4 }, "Vigia ligada por 4 horas.")}>
              Vou entrar ao vivo (liga a vigia por 4 h)
            </button>
          )}
        </div>
      </section>

      <section className="card cfg-card">
        <h2>O que ela recebe</h2>
        <div className="cfg-grid">
          <label className="cfg-campo">
            <span>Palavras que disparam</span>
            <input value={rascunho.palavrasTxt ?? e.config.palavras.join(", ")} onChange={(x) => setRascunho({ ...rascunho, palavrasTxt: x.target.value })} />
            <small>Separadas por vírgula. Não importa maiúscula, acento ou emoji junto (QUERO!!, eu quero 😍).</small>
          </label>
          <label className="cfg-campo">
            <span>Link</span>
            <input value={c.link} onChange={(x) => setRascunho({ ...rascunho, link: x.target.value })} />
            <small>O robô coloca utm_source=instagram e utm_medium=live ou comentario.</small>
          </label>
          <label className="cfg-campo">
            <span>Campanha (utm_campaign)</span>
            <input value={c.campanha} onChange={(x) => setRascunho({ ...rascunho, campanha: x.target.value })} />
          </label>
        </div>
        <label className="cfg-campo">
          <span>Mensagem</span>
          <textarea className="crm-textarea" rows={6} value={c.mensagem} onChange={(x) => setRascunho({ ...rascunho, mensagem: x.target.value })} />
          <small>{"{nome}"} vira o @ de quem comentou e {"{link}"} vira o link com UTM.</small>
        </label>
        <label className="cfg-check">
          <input type="checkbox" checked={c.postsTambem} onChange={(x) => setRascunho({ ...rascunho, postsTambem: x.target.checked })} />
          <span>
            <b>Responder também em posts e reels</b>
            <small>Quem comentar a palavra em qualquer post ou reel recebe o mesmo link (até 7 dias depois do comentário).</small>
          </span>
        </label>
        <div className="cfg-exemplo" style={{ whiteSpace: "pre-wrap" }}>
          <b>Prévia:</b>
          {"\n"}
          {e.exemplo}
        </div>
        {mudou && (
          <div className="cfg-salvar on">
            <span className="muted">Alterações não salvas</span>
            <button className="btn btn-sec btn-sm" onClick={() => setRascunho({})}>
              Desfazer
            </button>
            <button className="btn btn-pri btn-sm" disabled={ocupado} onClick={() => void salvar()}>
              Salvar
            </button>
          </div>
        )}
      </section>

      <section className="card cfg-card">
        <h2>Últimas respostas</h2>
        {e.respostas.length === 0 ? (
          <p className="muted">Nenhuma ainda.</p>
        ) : (
          <div className="orders-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Comentou</th>
                  <th>Onde</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {e.respostas.map((r) => (
                  <tr key={r.commentId}>
                    <td>{dia(r.em)} {hora(r.em)}</td>
                    <td>@{r.usuario}</td>
                    <td>{r.texto}</td>
                    <td>{r.origem}</td>
                    <td>{r.status === "enviado" ? "✓ link enviado" : r.status === "repetido" ? "já tinha recebido" : `erro: ${r.detalhe ?? ""}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card cfg-card">
        <h2>Conexão com a Meta</h2>
        <div className="cfg-grid">
          <label className="cfg-campo">
            <span>Token da conta (Instagram Login)</span>
            <div className="cfg-input">
              <input type="password" placeholder={e.conectado ? e.config.token : "cole o token gerado no app da Meta"} value={token} onChange={(x) => setToken(x.target.value)} />
              <button className="btn btn-pri btn-sm" disabled={ocupado || !token.trim()} onClick={() => void acao({ acao: "conectar", token }, "Conectado.").then((ok) => ok && setToken(""))}>
                {ocupado ? "Conectando…" : "Conectar"}
              </button>
            </div>
            {aviso && <small role="status" style={{ color: aviso.startsWith("Não deu") ? "var(--critical)" : undefined }}>{aviso}</small>}
          </label>
          <label className="cfg-campo">
            <span>Chave secreta do app do Instagram</span>
            <input type="password" placeholder={e.config.appSecret || "Instagram app secret"} value={rascunho.appSecret ?? ""} onChange={(x) => setRascunho({ ...rascunho, appSecret: x.target.value })} />
            <small>Confere que o aviso veio mesmo da Meta.</small>
          </label>
        </div>
        <p className="muted">
          Webhook pra colar no app da Meta: <code>{e.webhookUrl}</code>
          <br />
          Token de verificação: <code>{e.config.verifyToken}</code>
        </p>
        {e.eventos.length > 0 && (
          <details>
            <summary>Últimos avisos recebidos ({e.eventos.length})</summary>
            <ul>
              {e.eventos.map((v, i) => (
                <li key={i}>
                  {hora(v.em)} · {v.campo} · {v.resumo}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </main>
  );
}
