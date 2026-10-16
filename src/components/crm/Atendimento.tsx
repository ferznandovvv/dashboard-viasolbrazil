"use client";

import { useCallback, useEffect, useState } from "react";
import { api, dataHora } from "./comum";
import { formatarTelefone } from "@/lib/crm/telefone";

interface Dados {
  lojas: { loja: string; conversas: number; mensagensClientes: number; respondidas: number; medianaMin: number | null; lentas: number; pendentes: number }[];
  pendentes: { loja: string; telefone: string; cliente?: string; esperando: number; desde: string; texto?: string }[];
  desde: string;
  gatewayUrl?: string;
  eventos: number;
}

const minutos = (m: number | null) => (m === null ? "" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`);

/** Como cada loja está respondendo o WhatsApp. */
export function Atendimento() {
  const [dias, setDias] = useState(7);
  const [d, setD] = useState<Dados | null>(null);
  const carregar = useCallback(async () => setD(await api(`/api/crm/atendimento?dias=${dias}`)), [dias]);
  useEffect(() => {
    carregar().catch(() => setD({ lojas: [], pendentes: [], desde: "", eventos: 0 }));
    const t = setInterval(() => carregar().catch(() => {}), 60000);
    return () => clearInterval(t);
  }, [carregar]);

  if (!d) return <div className="empty">Carregando…</div>;
  return (
    <div>
      <div className="fin-barra">
        <div className="seg">
          {[1, 7, 30].map((n) => (
            <button key={n} className={dias === n ? "on" : ""} onClick={() => setDias(n)}>
              {n === 1 ? "Hoje" : `${n} dias`}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {d.gatewayUrl && (
          <a className="mini ghost" href={d.gatewayUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            Abrir conversas (WA-AKG)
          </a>
        )}
      </div>

      {!d.eventos ? (
        <div className="card">
          <h2>Ainda sem dados</h2>
          <div className="muted">
            Essa aba se alimenta das mensagens que entram e saem pelo gateway. Assim que a WA-AKG estiver pareada com os números das lojas e o webhook cadastrado (eventos message.received e message.sent), cada mensagem da cliente e cada resposta da vendedora, mesmo digitada no celular, passa a contar aqui. Para ler as conversas em si, use a tela da WA-AKG.
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>Por loja</h2>
            <div className="tbl-wrap">
              <table className="prod-tbl fin-tbl">
                <thead>
                  <tr>
                    <th>Loja</th>
                    <th className="n">Conversas</th>
                    <th className="n">Mensagens</th>
                    <th className="n">Respondidas</th>
                    <th className="n">Tempo de resposta</th>
                    <th className="n">Acima de 1h</th>
                    <th className="n">Esperando agora</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lojas.map((l) => (
                    <tr key={l.loja}>
                      <td className="fin-desc">{l.loja}</td>
                      <td className="n">{l.conversas}</td>
                      <td className="n">{l.mensagensClientes}</td>
                      <td className="n">{l.mensagensClientes ? `${Math.round((l.respondidas / Math.max(1, l.respondidas + l.pendentes)) * 100)}%` : ""}</td>
                      <td className="n">{minutos(l.medianaMin)}</td>
                      <td className={`n ${l.lentas ? "vencida" : ""}`}>{l.lentas || ""}</td>
                      <td className={`n ${l.pendentes ? "vencida" : ""}`}>{l.pendentes || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>Tempo de resposta é a mediana da primeira resposta da loja, contando só o horário de atendimento configurado em Envio (sem domingo).</div>
          </div>

          <div className="card">
            <h2>Clientes esperando resposta</h2>
            {!d.pendentes.length ? (
              <div className="muted">Ninguém esperando há mais de 15 minutos.</div>
            ) : (
              <table className="prod-tbl fin-tbl">
                <tbody>
                  {d.pendentes.map((p) => (
                    <tr key={`${p.loja}|${p.telefone}`}>
                      <td className="fin-desc">{p.loja}</td>
                      <td>
                        <div className="fin-desc">{p.cliente ?? <span className="muted">não cadastrada</span>}</div>
                        <div className="fin-sub">{formatarTelefone(p.telefone)}</div>
                      </td>
                      <td className="crm-texto-msg">{p.texto}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className={`fin-status ${p.esperando > 60 ? "vencida" : "hoje"}`}>há {minutos(p.esperando)}</span>
                        <div className="fin-sub">desde {dataHora(p.desde)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
