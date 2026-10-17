"use client";

import { useState } from "react";
import { type Resumo, api, dataHora } from "./comum";

/** De onde vêm as clientes e as vendas (TOTVS e Shopify) e os botões de operação. */
export function Fontes({ r, recarregar }: { r: Resumo; recarregar: () => Promise<void> }) {
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
        dicaVazia="Ainda não sincronizou. Roda sozinho todo dia às 8h45. Pedidos pagos entram como vendas da loja Site."
        ocupado={Boolean(ocupado)}
        acao={acao}
      />
      <div className="card">
        <h2>Operação</h2>
        <div className="muted" style={{ marginBottom: 8 }}>
          As automações geram as mensagens do dia (cashback, aniversário, reativação) sozinhas {r.ultimaAutomacao === r.hoje ? "e já rodaram hoje" : "no horário configurado"}; a fila manda uma a uma dentro do horário comercial.
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
            ) : fonte.resultado?.startsWith("falhou") ? (
              <span className="fin-status vencida">{fonte.resultado}</span>
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
