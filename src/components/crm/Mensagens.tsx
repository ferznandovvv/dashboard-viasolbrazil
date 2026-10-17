"use client";

import { useCallback, useEffect, useState } from "react";
import type { Recebida, StatusMensagem } from "@/lib/crm/tipos";
import { type MensagemComCliente, STATUS_NOME, api, dataHora } from "./comum";
import { formatarTelefone } from "@/lib/crm/telefone";

interface Dados {
  mensagens: MensagemComCliente[];
  recebidas: (Recebida & { cliente?: string })[];
  porStatus: Record<string, number>;
}

const FILTROS: (StatusMensagem | "todas")[] = ["todas", "fila", "simulada", "enviada", "entregue", "lida", "respondida", "erro", "cancelada"];

/** Fila e histórico de mensagens, e o que as clientes responderam. */
export function Mensagens({ recarregar }: { recarregar: () => Promise<void> }) {
  const [filtro, setFiltro] = useState<StatusMensagem | "todas">("todas");
  const [d, setD] = useState<Dados | null>(null);
  const [aba, setAba] = useState<"enviadas" | "recebidas">("enviadas");
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => setD(await api(`/api/crm/mensagens?status=${filtro}`)), [filtro]);
  useEffect(() => {
    carregar().catch(() => setD({ mensagens: [], recebidas: [], porStatus: {} }));
    const t = setInterval(() => carregar().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [carregar]);

  const acao = async (corpo: object) => {
    setAviso("");
    try {
      const r = await api<Record<string, unknown>>("/api/crm/mensagens", { method: "POST", body: JSON.stringify(corpo) });
      setAviso(
        "canceladas" in r
          ? `${r.canceladas} canceladas.`
          : "enfileiradas" in r
            ? `Automações: ${Object.values(r.enfileiradas as Record<string, number>).reduce((s, n) => s + n, 0)} mensagens geradas.`
            : "aviso" in r
              ? String(r.aviso)
              : `${r.enviadas ?? 0} enviadas, ${r.erros ?? 0} erros${r.motivo ? ` (${r.motivo})` : ""}.`
      );
      await carregar();
      await recarregar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Erro");
    }
  };

  const fila = d?.porStatus.fila ?? 0;
  return (
    <div>
      <div className="fin-barra">
        <div className="seg" role="tablist">
          <button className={aba === "enviadas" ? "on" : ""} onClick={() => setAba("enviadas")}>Nossas</button>
          <button className={aba === "recebidas" ? "on" : ""} onClick={() => setAba("recebidas")}>Respostas</button>
        </div>
        {aba === "enviadas" && (
          <select className="fin-select" value={filtro} onChange={(e) => setFiltro(e.target.value as StatusMensagem | "todas")}>
            {FILTROS.map((f) => (
              <option key={f} value={f}>
                {f === "todas" ? "Todas" : STATUS_NOME[f]} {d?.porStatus[f] ? `(${d.porStatus[f]})` : ""}
              </option>
            ))}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <button className="mini ghost" onClick={() => acao({ acao: "automacoes" })}>Rodar automações agora</button>
        <button className="mini ghost" onClick={() => acao({ acao: "processar" })}>Processar fila agora</button>
        {(d?.porStatus.simulada ?? 0) > 0 && (
          <button className="mini ghost" onClick={() => confirm(`Apagar as ${d?.porStatus.simulada} mensagens simuladas?`) && acao({ acao: "limpar-simuladas" })}>
            Limpar simuladas
          </button>
        )}
        {fila > 0 && (
          <button className="mini ghost fin-excluir" onClick={() => confirm(`Cancelar as ${fila} mensagens que ainda estão na fila?`) && acao({ acao: "cancelar-fila" })}>
            Cancelar fila
          </button>
        )}
      </div>
      {aviso && <div className="crm-aviso">{aviso}</div>}

      <div className="card">
        {!d ? (
          <div className="empty">Carregando…</div>
        ) : aba === "recebidas" ? (
          !d.recebidas.length ? (
            <div className="empty">Nenhuma resposta recebida ainda. Confira se o webhook está configurado na WA-AKG.</div>
          ) : (
            <table className="prod-tbl fin-tbl">
              <tbody>
                {d.recebidas.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{dataHora(r.recebidoEm)}</td>
                    <td>
                      <div className="fin-desc">{r.cliente ?? <span className="muted">número desconhecido</span>}</div>
                      <div className="fin-sub">{formatarTelefone(r.telefone)}{r.loja && <> · {r.loja}</>}</div>
                    </td>
                    <td>{r.texto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : !d.mensagens.length ? (
          <div className="empty">Nada por aqui.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="prod-tbl fin-tbl">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Cliente</th>
                  <th>Campanha</th>
                  <th>Número</th>
                  <th>Texto</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {d.mensagens.map((m) => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{dataHora(m.enviadoEm ?? m.criadoEm)}</td>
                    <td>
                      <div className="fin-desc">{m.cliente}</div>
                      <div className="fin-sub">{formatarTelefone(m.telefone)}</div>
                    </td>
                    <td>{m.campanha.replace(/_/g, " ")}</td>
                    <td>{m.loja}</td>
                    <td className="crm-texto-msg">
                      {m.texto}
                      {m.resposta && <div className="fin-sub">↩ {m.resposta}</div>}
                    </td>
                    <td>
                      <span className={`fin-status ${m.status === "erro" ? "vencida" : m.status === "respondida" ? "paga" : ""}`}>{STATUS_NOME[m.status]}</span>
                      {m.erro && <div className="fin-sub" title={m.erro}>{m.erro.slice(0, 60)}</div>}
                      {m.status === "fila" && (
                        <div>
                          <button className="link" onClick={() => api("/api/crm/mensagens", { method: "POST", body: JSON.stringify({ acao: "cancelar", id: m.id }) }).then(carregar)}>cancelar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
