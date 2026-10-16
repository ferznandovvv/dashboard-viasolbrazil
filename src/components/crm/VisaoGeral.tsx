"use client";

import { useState } from "react";
import { type Resumo, api, brl, dataHora } from "./comum";

/** Primeira aba: números da base, canais e botões de operação. */
export function VisaoGeral({ r, recarregar, irPara }: { r: Resumo; recarregar: () => Promise<void>; irPara: (aba: "clientes", segmento?: string) => void }) {
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");

  const acao = async (nome: string, fn: () => Promise<unknown>) => {
    setOcupado(nome);
    setAviso("");
    try {
      const res = await fn();
      setAviso(resumoDe(res));
      await recarregar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Erro");
    } finally {
      setOcupado("");
    }
  };

  return (
    <div>
      <div className="tiles">
        <button className="tile crm-tile" onClick={() => irPara("clientes")}>
          <div className="label">Clientes</div>
          <div className="value">{r.base.clientes.toLocaleString("pt-BR")}</div>
          <div className="muted">{r.base.comTelefone.toLocaleString("pt-BR")} com telefone</div>
        </button>
        <div className="tile">
          <div className="label">Cashback em aberto</div>
          <div className="value">{brl.format(r.base.saldoTotal)}</div>
          <div className="muted">{r.base.vendas.toLocaleString("pt-BR")} vendas registradas</div>
        </div>
        <div className="tile">
          <div className="label">Mensagens no mês</div>
          <div className="value">{r.fila.enviadasMes}</div>
          <div className="muted">
            {r.fila.respondidasMes} respondidas · {r.fila.emEspera} na fila
          </div>
        </div>
        <div className={`tile ${r.fila.errosSemana ? "alerta" : ""}`}>
          <div className="label">Envio</div>
          <div className="value" style={{ fontSize: 20 }}>
            {r.fila.pausado ? "Pausado" : !r.fila.provedor ? "Sem provedor" : r.fila.dentroDaJanela ? "Mandando" : "Fora do horário"}
          </div>
          <div className="muted">{r.fila.errosSemana ? `${r.fila.errosSemana} erros na semana` : r.fila.provedor ?? "configure na aba Configurar"}</div>
        </div>
      </div>

      <div className="grid-2 crm-grid">
        <div className="card">
          <h2>Segmentos</h2>
          {r.segmentos.map((s) => (
            <button key={s.id} className="crm-seg-linha" onClick={() => irPara("clientes", s.id)}>
              <span>
                <b>{s.nome}</b>
                {s.dica && <small className="muted"> {s.dica}</small>}
              </span>
              <span className="crm-seg-total">{s.total}</span>
            </button>
          ))}
        </div>

        <div>
          <div className="card">
            <h2>Números de WhatsApp</h2>
            {!r.numeros.length && <div className="muted">Nenhum número configurado ainda. Vá em Configurar.</div>}
            {r.numeros.map((n) => (
              <div key={n.loja} className="crm-numero">
                <span>
                  <b>{n.loja}</b>
                  <small className="muted"> {n.sessao || "sem sessão"}</small>
                </span>
                <span className="crm-numero-dir">
                  <span className="muted">
                    {n.hoje}/{n.teto} hoje
                  </span>
                  {!n.ativo ? (
                    <span className="badge">desligado</span>
                  ) : n.situacao ? (
                    <span className={`badge ${n.situacao.conectado ? "on" : "err"}`} title={n.situacao.detalhe}>
                      {n.situacao.conectado ? "conectado" : "fora"}
                    </span>
                  ) : (
                    <span className="badge">sem provedor</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <CardFonte
            titulo="TOTVS (lojas)"
            fonte={r.totvs}
            rota="/api/crm/totvs"
            dicaVazia="Ainda não sincronizou. Roda sozinho todo dia às 8h30; o botão abaixo puxa os últimos 3 dias agora."
            ocupado={Boolean(ocupado)}
            acao={acao}
          />
          <CardFonte
            titulo="Shopify (site)"
            fonte={r.shopify}
            rota="/api/crm/shopify"
            dicaVazia="Ainda não sincronizou. Roda sozinho todo dia às 8h45. Pedidos pagos entram como vendas da loja Site; cashback só se ligado em Configurar."
            ocupado={Boolean(ocupado)}
            acao={acao}
          />

          <div className="card">
            <h2>Operação</h2>
            <div className="muted" style={{ marginBottom: 8 }}>
              Automações geram as mensagens do dia (cashback, aniversário, reativação). Rodam sozinhas {r.ultimaAutomacao === r.hoje ? "e já rodaram hoje" : "no horário configurado"}; a fila manda uma a uma dentro do horário comercial.
            </div>
            <div className="config-acoes">
              <button className="mini ghost" disabled={Boolean(ocupado)} onClick={() => acao("auto", () => api("/api/crm/mensagens", { method: "POST", body: JSON.stringify({ acao: "automacoes" }) }))}>
                Rodar automações agora
              </button>
              <button className="mini ghost" disabled={Boolean(ocupado)} onClick={() => acao("fila", () => api("/api/crm/mensagens", { method: "POST", body: JSON.stringify({ acao: "processar" }) }))}>
                Processar fila agora
              </button>
            </div>
          </div>
        </div>
      </div>
      {aviso && <div className="card crm-aviso">{aviso}</div>}
    </div>
  );
}

function CardFonte({ titulo, fonte, rota, dicaVazia, ocupado, acao }: { titulo: string; fonte: Resumo["totvs"]; rota: string; dicaVazia: string; ocupado: boolean; acao: (nome: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const p = fonte.progresso;
  return (
    <div className="card">
      <h2>{titulo}</h2>
      {!fonte.configurado ? (
        <div className="muted">Não configurado (veja /configurar).</div>
      ) : (
        <>
          <div className="muted" style={{ marginBottom: 8 }}>
            {p.rodando ? (
              <>
                Sincronizando: {p.etapa}… ({p.vendasNovas} vendas, {p.clientesNovos} clientes novos)
              </>
            ) : fonte.ultima ? (
              <>
                Última sincronização {dataHora(fonte.ultima)}. {fonte.resultado}
                {fonte.desde && <> Vendas carregadas desde {fonte.desde.slice(8, 10)}/{fonte.desde.slice(5, 7)}/{fonte.desde.slice(0, 4)}.</>}
              </>
            ) : (
              dicaVazia
            )}
          </div>
          <div className="config-acoes">
            <button className="mini" disabled={p.rodando || ocupado} onClick={() => acao("sinc", () => api(rota, { method: "POST", body: JSON.stringify({ acao: "sincronizar", creditar: true }) }))}>
              Sincronizar últimos 3 dias
            </button>
            <CargaHistorica desabilitado={p.rodando || ocupado} aoRodar={(de, ate) => acao("carga", () => api(rota, { method: "POST", body: JSON.stringify({ acao: "sincronizar", de, ate, creditar: false }) }))} />
          </div>
        </>
      )}
    </div>
  );
}

function CargaHistorica({ desabilitado, aoRodar }: { desabilitado: boolean; aoRodar: (de: string, ate: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const anoAtras = `${Number(hoje.slice(0, 4)) - 1}${hoje.slice(4)}`;
  const [de, setDe] = useState(anoAtras);
  const [ate, setAte] = useState(hoje);
  if (!aberto)
    return (
      <button className="link" onClick={() => setAberto(true)} disabled={desabilitado}>
        carga histórica…
      </button>
    );
  return (
    <span className="crm-inline">
      <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
      <span className="muted">até</span>
      <input type="date" value={ate} min={de} max={hoje} onChange={(e) => setAte(e.target.value)} />
      <button className="mini" disabled={desabilitado} onClick={() => aoRodar(de, ate)}>
        Carregar (sem gerar cashback)
      </button>
    </span>
  );
}

function resumoDe(res: unknown): string {
  if (!res || typeof res !== "object") return "Feito.";
  const r = res as Record<string, unknown>;
  if ("rodando" in r) return "Sincronização iniciada. Acompanhe no card do TOTVS.";
  if ("enfileiradas" in r) {
    const e = r.enfileiradas as Record<string, number>;
    const total = Object.values(e).reduce((s, n) => s + n, 0);
    const puladas = Object.entries((r.puladas as Record<string, number>) ?? {})
      .map(([k, v]) => `${v}× ${k}`)
      .join(", ");
    return `${total} mensagens entraram na fila (${Object.entries(e).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ") || "nenhuma"}). ${r.expirados ? `${r.expirados} créditos expirados.` : ""} ${puladas ? `Puladas: ${puladas}.` : ""}`;
  }
  if ("enviadas" in r) return `Fila: ${r.enviadas} enviadas, ${r.erros} erros${r.motivo ? ` (${r.motivo})` : ""}.`;
  if ("aviso" in r) return String(r.aviso);
  return "Feito.";
}
