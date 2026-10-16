"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConfigCrm, Modelo, NumeroWhatsapp } from "@/lib/crm/tipos";
import { type DadosConfig, api } from "./comum";

type Secao = "cashback" | "envio" | "numeros" | "modelos" | "backup";

/** Regras do cashback, provedor e números, ritmo de envio e textos das campanhas. */
export function Configurar({ recarregar }: { recarregar: () => Promise<void> }) {
  const [d, setD] = useState<DadosConfig | null>(null);
  const [secao, setSecao] = useState<Secao>("cashback");
  const [cfg, setCfg] = useState<ConfigCrm | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    const x = await api<DadosConfig>("/api/crm/config");
    setD(x);
    setCfg(x.config);
  }, []);
  useEffect(() => {
    carregar().catch((e) => setErro(e.message));
  }, [carregar]);

  const salvar = async (parte: Partial<ConfigCrm>, msg = "Salvo.") => {
    setErro("");
    setAviso("");
    try {
      await api("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "config", config: parte }) });
      await carregar();
      await recarregar();
      setAviso(msg);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  };

  if (!d || !cfg) return <div className="empty">{erro || "Carregando…"}</div>;
  const n = (k: keyof ConfigCrm) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [k]: e.target.value === "" ? "" : Number(e.target.value.replace(",", ".")) });
  const t = (k: keyof ConfigCrm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setCfg({ ...cfg, [k]: e.target.value });

  return (
    <div>
      <div className="seg" role="group" style={{ marginBottom: 14 }}>
        {(
          [
            ["cashback", "Cashback"],
            ["envio", "Envio"],
            ["numeros", "Números"],
            ["modelos", "Textos"],
            ["backup", "Backup"],
          ] as [Secao, string][]
        ).map(([s, nome]) => (
          <button key={s} className={secao === s ? "on" : ""} onClick={() => setSecao(s)}>
            {nome}
          </button>
        ))}
      </div>

      {secao === "cashback" && (
        <div className="card">
          <h2>Regras do cashback</h2>
          <div className="fin-grid">
            <label className="config-campo"><span>Percentual sobre a compra (%)</span><input value={cfg.cashbackPct} onChange={n("cashbackPct")} /></label>
            <label className="config-campo"><span>Validade do crédito (dias)</span><input value={cfg.cashbackValidadeDias} onChange={n("cashbackValidadeDias")} /></label>
            <label className="config-campo"><span>Compra mínima para gerar (R$)</span><input value={cfg.cashbackCompraMinima} onChange={n("cashbackCompraMinima")} /></label>
            <label className="config-campo"><span>Saldo mínimo para resgatar (R$)</span><input value={cfg.cashbackResgateMinimo} onChange={n("cashbackResgateMinimo")} /></label>
            <label className="config-campo"><span>Máximo da compra pago com cashback (%)</span><input value={cfg.cashbackMaxPctDaCompra} onChange={n("cashbackMaxPctDaCompra")} /><small>0 desliga o teto</small></label>
            <label className="config-campo"><span>Avisar vencimento com (dias)</span><input value={cfg.avisoVencimentoDias} onChange={n("avisoVencimentoDias")} /></label>
          </div>
          <label className="fin-check"><input type="checkbox" checked={cfg.cashbackSite} onChange={(e) => setCfg({ ...cfg, cashbackSite: e.target.checked })} /> Compras no site (Shopify) também geram cashback para usar nas lojas</label>
          <h2 style={{ marginTop: 10 }}>Campanhas automáticas</h2>
          <div className="fin-grid">
            <label className="config-campo"><span>Pós-venda: dias depois da compra</span><input value={cfg.posVendaDias} onChange={n("posVendaDias")} /></label>
            <label className="config-campo"><span>Reativação: sem comprar há (dias)</span><input value={cfg.reativacaoDias} onChange={n("reativacaoDias")} /></label>
            <label className="config-campo"><span>Reativação: total gasto mínimo (R$)</span><input value={cfg.reativacaoTicketMinimo} onChange={n("reativacaoTicketMinimo")} /></label>
            <label className="config-campo"><span>Reativação: intervalo entre tentativas (dias)</span><input value={cfg.reativacaoIntervaloDias} onChange={n("reativacaoIntervaloDias")} /></label>
            <label className="config-campo"><span>Horário em que as automações rodam</span><input type="time" value={cfg.horaAutomacoes} onChange={t("horaAutomacoes")} /><small>Depois da sincronização com o TOTVS (8h30)</small></label>
          </div>
          <button className="mini" onClick={() => salvar(cfg)}>Salvar</button>
        </div>
      )}

      {secao === "envio" && (
        <div className="card">
          <h2>Provedor</h2>
          <div className="fin-grid">
            <label className="config-campo">
              <span>Quem manda as mensagens</span>
              <select value={cfg.provedor} onChange={t("provedor")}>
                <option value="nenhum">Nenhum (só acumula na fila)</option>
                <option value="waakg">WA-AKG (não oficial, na máquina da empresa)</option>
                <option value="cloudapi">WhatsApp Cloud API (oficial da Meta)</option>
              </select>
            </label>
            {cfg.provedor === "waakg" && (
              <>
                <label className="config-campo"><span>Endereço da WA-AKG</span><input value={cfg.waakgUrl ?? ""} onChange={t("waakgUrl")} placeholder="http://localhost:3000" /></label>
                <label className="config-campo"><span>API Key {d.temWaakgApiKey && <span className="ok">(salva)</span>}</span><input value={cfg.waakgApiKey ?? ""} onChange={t("waakgApiKey")} placeholder="cole para trocar" /></label>
              </>
            )}
            {cfg.provedor === "cloudapi" && (
              <label className="config-campo fin-largo"><span>Token de acesso {d.temCloudApiToken && <span className="ok">(salvo)</span>}</span><input value={cfg.cloudApiToken ?? ""} onChange={t("cloudApiToken")} placeholder="cole para trocar" /></label>
            )}
          </div>
          <div className="config-campo">
            <span>Webhook (cole na WA-AKG em Webhooks, eventos message.received e message.status; ou na Meta como callback)</span>
            <input readOnly value={d.webhookUrl} onFocus={(e) => e.target.select()} />
            <small>Se a WA-AKG roda na mesma máquina, pode usar http://localhost:3100 no lugar do domínio.</small>
          </div>

          <h2 style={{ marginTop: 10 }}>Ritmo (o que protege os números)</h2>
          <div className="fin-grid">
            <label className="config-campo"><span>Teto de mensagens por número por dia</span><input value={cfg.tetoDiaPorNumero} onChange={n("tetoDiaPorNumero")} /><small>Comece baixo (20) e suba aos poucos</small></label>
            <label className="config-campo"><span>Intervalo mínimo entre mensagens (segundos)</span><input value={cfg.intervaloMinSeg} onChange={n("intervaloMinSeg")} /></label>
            <label className="config-campo"><span>Intervalo máximo (segundos)</span><input value={cfg.intervaloMaxSeg} onChange={n("intervaloMaxSeg")} /></label>
            <label className="config-campo"><span>Campanhas sem resposta até parar marketing</span><input value={cfg.maxSemResposta} onChange={n("maxSemResposta")} /><small>Avisos de cashback continuam</small></label>
            <label className="config-campo"><span>Manda das (hora)</span><input value={cfg.envioInicio} onChange={n("envioInicio")} /></label>
            <label className="config-campo"><span>até as (hora)</span><input value={cfg.envioFim} onChange={n("envioFim")} /></label>
          </div>
          <div className="config-campo">
            <span>Dias</span>
            {["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((nome, i) => (
              <label key={i} className="fin-chip" style={{ opacity: cfg.envioDias.includes(i) ? 1 : 0.45 }}>
                <input type="checkbox" style={{ display: "none" }} checked={cfg.envioDias.includes(i)} onChange={(e) => setCfg({ ...cfg, envioDias: e.target.checked ? [...cfg.envioDias, i].sort() : cfg.envioDias.filter((x) => x !== i) })} />
                {nome}
              </label>
            ))}
          </div>
          <label className="fin-check"><input type="checkbox" checked={cfg.pausado} onChange={(e) => setCfg({ ...cfg, pausado: e.target.checked })} /> Pausar todos os envios (a fila continua acumulando)</label>
          <button className="mini" onClick={() => salvar(cfg)}>Salvar</button>
        </div>
      )}

      {secao === "numeros" && <Numeros lojas={d.lojas} numeros={cfg.numeros} provedor={cfg.provedor} salvar={(numeros) => salvar({ numeros })} />}

      {secao === "modelos" && <Modelos d={d} aoMudar={carregar} />}

      {secao === "backup" && (
        <div className="card">
          <h2>Cópia de segurança</h2>
          <div className="muted" style={{ marginBottom: 10 }}>A base do CRM fica em dados/crm/base.json. Informe uma pasta (Google Drive, OneDrive) para receber uma cópia por dia, como no financeiro.</div>
          <label className="config-campo"><span>Pasta de backup</span><input value={cfg.backupDir ?? ""} onChange={t("backupDir")} placeholder="C:\Users\...\Google Drive\Backups" /></label>
          <div className="config-acoes">
            <button className="mini" onClick={() => salvar({ backupDir: cfg.backupDir })}>Salvar</button>
            <button className="mini ghost" onClick={async () => { const r = await api<{ backup: string }>("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "backup" }) }); setAviso(`Cópia: ${r.backup}`); }}>Copiar agora</button>
          </div>
        </div>
      )}

      {erro && <div className="login-error">{erro}</div>}
      {aviso && <div className="crm-aviso">{aviso}</div>}
    </div>
  );
}

function Numeros({ lojas, numeros, provedor, salvar }: { lojas: string[]; numeros: NumeroWhatsapp[]; provedor: string; salvar: (n: NumeroWhatsapp[]) => Promise<void> }) {
  const [lista, setLista] = useState<NumeroWhatsapp[]>(() => lojas.map((l) => numeros.find((n) => n.loja === l) ?? { loja: l, sessao: "", ativo: false }));
  const [teste, setTeste] = useState<Record<string, string>>({});
  const [telTeste, setTelTeste] = useState("");
  const muda = (i: number, p: Partial<NumeroWhatsapp>) => setLista(lista.map((n, j) => (j === i ? { ...n, ...p } : n)));

  const testar = async (loja: string) => {
    setTeste({ ...teste, [loja]: "testando…" });
    try {
      const r = await api<{ conectado: boolean; detalhe?: string }>("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "testar-numero", loja }) });
      setTeste({ ...teste, [loja]: r.conectado ? `conectado (${r.detalhe})` : `fora (${r.detalhe ?? "sem detalhe"})` });
    } catch (e) {
      setTeste({ ...teste, [loja]: e instanceof Error ? e.message : "erro" });
    }
  };
  const mandarTeste = async (loja: string) => {
    setTeste({ ...teste, [loja]: "enviando…" });
    try {
      const r = await api<{ ok: boolean; erro?: string }>("/api/crm/mensagens", { method: "POST", body: JSON.stringify({ acao: "teste", loja, telefone: telTeste, texto: `Teste do CRM Via Sol pelo número da loja ${loja}.` }) });
      setTeste({ ...teste, [loja]: r.ok ? "mensagem de teste enviada" : r.erro ?? "falhou" });
    } catch (e) {
      setTeste({ ...teste, [loja]: e instanceof Error ? e.message : "erro" });
    }
  };

  return (
    <div className="card">
      <h2>Um número por loja</h2>
      <div className="muted" style={{ marginBottom: 10 }}>
        {provedor === "waakg"
          ? "Na WA-AKG, crie uma sessão por loja (escaneando o QR no celular da loja) e cole aqui o sessionId de cada uma. Cada loja manda só para as próprias clientes, pelo próprio número."
          : provedor === "cloudapi"
            ? "Cole o phone_number_id de cada número cadastrado na Meta."
            : "Escolha o provedor na aba Envio antes."}
      </div>
      <table className="prod-tbl fin-tbl">
        <thead>
          <tr>
            <th>Loja</th>
            <th>Sessão / id do número</th>
            <th>Teto/dia</th>
            <th>Ligado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lista.map((n, i) => (
            <tr key={n.loja}>
              <td className="fin-desc">{n.loja}</td>
              <td><input className="fin-pagar-input crm-input" value={n.sessao} onChange={(e) => muda(i, { sessao: e.target.value })} placeholder="ex.: centro" /></td>
              <td><input className="crm-input" style={{ width: 70 }} value={n.tetoDia ?? ""} onChange={(e) => muda(i, { tetoDia: e.target.value ? Number(e.target.value) : undefined })} placeholder="geral" /></td>
              <td><input type="checkbox" checked={n.ativo} onChange={(e) => muda(i, { ativo: e.target.checked })} /></td>
              <td className="fin-acoes">
                <button className="link" disabled={!n.sessao} onClick={() => testar(n.loja)}>situação</button>
                <button className="link" disabled={!n.sessao || !telTeste} onClick={() => mandarTeste(n.loja)}>mandar teste</button>
                {teste[n.loja] && <div className="fin-sub">{teste[n.loja]}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="config-acoes" style={{ marginTop: 12 }}>
        <button className="mini" onClick={() => salvar(lista)}>Salvar números</button>
        <label className="config-campo" style={{ margin: 0 }}><span>Seu celular, para o teste</span><input value={telTeste} onChange={(e) => setTelTeste(e.target.value)} placeholder="(16) 99999-8888" style={{ width: 180 }} /></label>
        <small className="muted">Salve antes de testar. O teste manda na hora, fora da fila.</small>
      </div>
    </div>
  );
}

function Modelos({ d, aoMudar }: { d: DadosConfig; aoMudar: () => Promise<void> }) {
  const [edit, setEdit] = useState<Modelo | null>(null);
  const [erro, setErro] = useState("");
  const salvar = async (m: Modelo) => {
    setErro("");
    try {
      await api("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "modelo", modelo: m }) });
      await aoMudar();
      setEdit(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  };
  return (
    <div className="card">
      <h2>Textos das campanhas</h2>
      <div className="muted" style={{ marginBottom: 10 }}>
        Cada campanha tem variações; o sistema sorteia uma por mensagem, para o mesmo número não mandar sempre o texto igual. Variáveis: {"{primeiro}"} (primeiro nome), {"{nome}"}, {"{loja}"}, {"{valor}"}, {"{validade}"}, {"{codigo}"}.
      </div>
      {d.campanhas
        .filter((c) => c.id !== "avulsa")
        .map((c) => {
          const m = d.modelos.find((x) => x.campanha === c.id) ?? { campanha: c.id, ativo: false, variacoes: [] };
          const editando = edit?.campanha === c.id;
          return (
            <div key={c.id} className="fin-grupo">
              <div className="fin-cab">
                <div>
                  <span className="fin-grupo-nome">{c.nome}</span>
                  <span className="muted"> {c.dica}{c.marketing ? " · marketing" : " · aviso"}</span>
                </div>
                <div>
                  <span className={`badge ${m.ativo ? "on" : ""}`}>{m.ativo ? "ligada" : "desligada"}</span>
                  <button className="link" style={{ marginLeft: 10 }} onClick={() => setEdit(editando ? null : structuredClone(m))}>{editando ? "fechar" : "editar"}</button>
                </div>
              </div>
              {!editando ? (
                m.variacoes.map((v, i) => <div key={i} className="crm-variacao">{v}</div>)
              ) : (
                <div>
                  <label className="fin-check"><input type="checkbox" checked={edit!.ativo} onChange={(e) => setEdit({ ...edit!, ativo: e.target.checked })} /> Campanha ligada</label>
                  {edit!.variacoes.map((v, i) => (
                    <div key={i} className="crm-inline" style={{ alignItems: "flex-start", marginBottom: 8 }}>
                      <textarea className="crm-textarea" rows={3} value={v} onChange={(e) => setEdit({ ...edit!, variacoes: edit!.variacoes.map((x, j) => (j === i ? e.target.value : x)) })} />
                      <button className="link fin-excluir" onClick={() => setEdit({ ...edit!, variacoes: edit!.variacoes.filter((_, j) => j !== i) })}>remover</button>
                    </div>
                  ))}
                  <div className="config-acoes">
                    <button className="mini ghost" onClick={() => setEdit({ ...edit!, variacoes: [...edit!.variacoes, ""] })}>+ variação</button>
                    <button className="mini" onClick={() => salvar(edit!)}>Salvar</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      {erro && <div className="login-error">{erro}</div>}
    </div>
  );
}
