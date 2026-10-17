"use client";

import { useCallback, useEffect, useState } from "react";
import { api, dataHora } from "./comum";
import { Janela } from "./Clientes";
import { formatarTelefone } from "@/lib/crm/telefone";
import type { CardLoja, Nivel } from "@/lib/crm/painel";

type Loja = CardLoja & { conectado: boolean | null; detalheNumero?: string };

interface Pendente {
  loja: string;
  telefone: string;
  cliente?: string;
  nomeMostrar?: string;
  esperando: number;
  desde: string;
  texto?: string;
}

interface Painel {
  lojas: Loja[];
  geral: {
    conversasHoje: number;
    esperando: number;
    maiorEsperaMin: number;
    mediana7d: number | null;
    rapidas7d: number | null;
    respondidas7d: number;
    vendas30: number;
    comCelular30: number;
    conectados: number;
    numeros: number;
    eventos: number;
  };
  pendentes: Pendente[];
  envio: { modoSombra: boolean; pausado: boolean; provedor: string | null; dentroDaJanela: boolean; naFila: number; inicio: number; fim: number };
  gatewayUrl?: string;
}

export const minutos = (m: number | null | undefined) =>
  m === null || m === undefined ? "–" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;

const NIVEL: Record<Nivel, { nome: string; icone: string }> = {
  ok: { nome: "Tudo certo", icone: "●" },
  atencao: { nome: "Atenção", icone: "▲" },
  critico: { nome: "Agir agora", icone: "■" },
  inativo: { nome: "WhatsApp não ligado", icone: "○" },
};

const DIA = ["D", "S", "T", "Q", "Q", "S", "S"];
const diaSemana = (d: string) => DIA[new Date(`${d}T12:00:00`).getDay()];

/** Visão gerencial: um cartão por loja com atendimento, WhatsApp e captura de celular. */
export function VisaoGeral() {
  const [p, setP] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setP(await api<Painel>("/api/crm/painel"));
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  }, []);
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60000);
    return () => clearInterval(t);
  }, [carregar]);

  if (!p) return <div className="empty">{erro || "Carregando…"}</div>;
  const g = p.geral;
  const pctCel = g.vendas30 ? Math.round((g.comCelular30 / g.vendas30) * 100) : null;
  const e = p.envio;
  const situacaoEnvio = e.modoSombra
    ? { txt: "Modo sombra: nenhuma mensagem automática sai", cls: "aviso" }
    : e.pausado
      ? { txt: "Envio pausado", cls: "aviso" }
      : !e.provedor
        ? { txt: "Sem provedor de WhatsApp configurado", cls: "aviso" }
        : e.dentroDaJanela
          ? { txt: `Mandando · ${e.naFila} na fila`, cls: "ok" }
          : { txt: `Fora do horário de envio (${e.inicio}h às ${e.fim}h) · ${e.naFila} na fila`, cls: "" };

  const ordem: Nivel[] = ["critico", "atencao", "ok", "inativo"];
  const lojas = [...p.lojas].sort((a, b) => ordem.indexOf(a.nivel) - ordem.indexOf(b.nivel));

  return (
    <div>
      <div className={`pg-envio ${situacaoEnvio.cls}`}>{situacaoEnvio.txt}</div>

      <div className="tiles pg-kpis">
        <div className="tile">
          <div className="label">Conversas hoje</div>
          <div className="value">{g.conversasHoje}</div>
          <div className="muted">clientes que chamaram as lojas</div>
        </div>
        <div className={`tile ${g.maiorEsperaMin > 60 ? "alerta" : ""}`}>
          <div className="label">Esperando resposta</div>
          <div className="value">{g.esperando}</div>
          <div className="muted">{g.esperando ? `a mais antiga há ${minutos(g.maiorEsperaMin)}` : "ninguém há mais de 15 min"}</div>
        </div>
        <div className="tile">
          <div className="label">Tempo de resposta</div>
          <div className="value">{minutos(g.mediana7d)}</div>
          <div className="muted">{g.rapidas7d !== null ? `${g.rapidas7d}% em até 15 min · 7 dias` : "mediana dos últimos 7 dias"}</div>
        </div>
        <div className="tile">
          <div className="label">Vendas com celular</div>
          <div className="value">{pctCel === null ? "–" : `${pctCel}%`}</div>
          <div className="muted">
            {g.comCelular30} de {g.vendas30} vendas · 30 dias
          </div>
        </div>
        <div className={`tile ${g.numeros && g.conectados < g.numeros ? "alerta" : ""}`}>
          <div className="label">WhatsApp</div>
          <div className="value">
            {g.conectados}/{g.numeros}
          </div>
          <div className="muted">{g.numeros ? "números conectados" : "nenhum número ligado ainda"}</div>
        </div>
      </div>

      {!g.eventos && (
        <div className="card muted pg-dica">
          O atendimento aparece aqui assim que os números das lojas estiverem pareados na WA-AKG com o webhook cadastrado. A captura de celular já vale: vem das vendas do TOTVS.
        </div>
      )}

      <div className="pg-lojas">
        {lojas.map((l) => (
          <CartaoLoja key={l.loja} l={l} abrir={() => setAberta(l.loja)} />
        ))}
      </div>

      {p.pendentes.length > 0 && (
        <div className="card">
          <h2>Esperando resposta agora</h2>
          <ListaPendentes pendentes={p.pendentes} comLoja />
        </div>
      )}

      {aberta && <DetalheLoja loja={aberta} gatewayUrl={p.gatewayUrl} fechar={() => setAberta(null)} />}
    </div>
  );
}

function CartaoLoja({ l, abrir }: { l: Loja; abrir: () => void }) {
  const a = l.atend;
  const c = l.cadastro;
  const delta = c.pct30 !== null && c.pctAnterior !== null ? c.pct30 - c.pctAnterior : null;
  const maxDia = Math.max(1, ...a.dias.map((d) => d.conversas));
  const n = NIVEL[l.nivel];
  return (
    <button className={`pg-loja nivel-${l.nivel}`} onClick={abrir}>
      <div className="pg-loja-cab">
        <span className="pg-loja-nome">{l.loja}</span>
        <span className="pg-nivel">
          <span aria-hidden>{n.icone}</span> {n.nome}
        </span>
      </div>
      {l.alertas.length > 0 && (
        <ul className="pg-alertas">
          {l.alertas.slice(0, 3).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}

      <div className="pg-sec">Atendimento</div>
      {l.numero.ativo ? (
        <>
          <div className="pg-mini">
            <div>
              <b>{a.conversasHoje}</b>
              <small>conversas hoje</small>
            </div>
            <div className={a.esperando ? (a.maiorEsperaMin > 60 ? "ruim" : "medio") : ""}>
              <b>{a.esperando}</b>
              <small>{a.esperando ? `esperando · ${minutos(a.maiorEsperaMin)}` : "esperando"}</small>
            </div>
            <div className={a.mediana7d !== null && a.mediana7d > 15 ? "medio" : ""}>
              <b>{minutos(a.mediana7d)}</b>
              <small>p/ responder</small>
            </div>
          </div>
          <div className="pg-barras" aria-label="Conversas por dia, últimos 7 dias">
            {a.dias.map((d) => (
              <span key={d.dia} title={`${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}: ${d.conversas} conversas`}>
                <i style={{ height: `${Math.max(d.conversas ? 8 : 2, (d.conversas / maxDia) * 100)}%` }} />
                <em>{diaSemana(d.dia)}</em>
              </span>
            ))}
          </div>
          <div className="pg-rodape">
            <span className={l.conectado === false ? "ruim" : l.conectado ? "bom" : ""}>
              {l.conectado === false ? "■ desconectado" : l.conectado ? "● conectado" : "sem provedor"}
            </span>
            <span>
              enviadas {l.numero.hoje}/{l.numero.teto} hoje{l.numero.naFila ? ` · ${l.numero.naFila} na fila` : ""}
            </span>
          </div>
        </>
      ) : (
        <div className="muted pg-vazio">{l.numero.configurado ? "Número desligado no CRM." : "Ainda sem número de WhatsApp no CRM."}</div>
      )}

      <div className="pg-sec">Celular no caixa · 30 dias</div>
      <div className="pg-cel">
        <span className="pg-cel-pct">{c.pct30 === null ? "–" : `${c.pct30}%`}</span>
        <span className="pg-cel-info">
          {c.comCelular30} de {c.vendas30} vendas
          {delta !== null && delta !== 0 && (
            <small className={delta > 0 ? "bom" : "ruim"}>
              {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} pts vs mês anterior
            </small>
          )}
        </span>
      </div>
      <div className="pg-progresso" role="progressbar" aria-valuenow={c.pct30 ?? 0} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${c.pct30 ?? 0}%` }} />
      </div>
      <div className="pg-semanas" aria-label="Vendas com celular por semana, 8 semanas">
        {c.semanas.map((s) => (
          <span key={s.inicio} title={`Semana de ${s.inicio.slice(8, 10)}/${s.inicio.slice(5, 7)}: ${s.pct === null ? "sem vendas" : `${s.pct}% de ${s.vendas} vendas`}`}>
            <i style={{ height: `${Math.max(s.pct ? 6 : 2, s.pct ?? 0)}%` }} />
          </span>
        ))}
      </div>
      <div className="pg-rodape">
        <span>
          {c.novas7d === 1 ? "1 cliente nova" : `${c.novas7d} clientes novas`} com celular na semana{c.novas7dSemCelular ? ` · ${c.novas7dSemCelular} sem` : ""}
        </span>
      </div>
    </button>
  );
}

export function ListaPendentes({ pendentes, comLoja }: { pendentes: Pendente[]; comLoja?: boolean }) {
  return (
    <table className="prod-tbl fin-tbl">
      <tbody>
        {pendentes.map((p) => (
          <tr key={`${p.loja}|${p.telefone}`}>
            {comLoja && <td className="fin-desc">{p.loja}</td>}
            <td>
              <div className="fin-desc">{p.nomeMostrar ?? <span className="muted">sem nome</span>}</div>
              <div className="fin-sub">
                {/^55\d{10,11}$/.test(p.telefone) ? formatarTelefone(p.telefone) : "número escondido pelo WhatsApp"}
                {!p.cliente && " · não está na base"}
              </div>
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
  );
}

interface Detalhe {
  loja: string;
  atendimento: { conversas: number; mensagensClientes: number; respondidas: number; medianaMin: number | null; lentas: number; rapidas: number; pendentes: number } | null;
  pendentes: Pendente[];
  vendedoras: { nome: string; vendas: number; comCelular: number; semCliente: number; pct: number | null }[];
}

function DetalheLoja({ loja, gatewayUrl, fechar }: { loja: string; gatewayUrl?: string; fechar: () => void }) {
  const [dias, setDias] = useState(7);
  const [d, setD] = useState<Detalhe | null>(null);
  useEffect(() => {
    api<Detalhe>(`/api/crm/painel?loja=${encodeURIComponent(loja)}&dias=${dias}`).then(setD).catch(() => setD(null));
  }, [loja, dias]);
  const a = d?.atendimento;
  return (
    <Janela titulo={loja} fechar={fechar} larga>
      <div className="fin-barra">
        <div className="seg">
          {[1, 7, 30].map((n) => (
            <button key={n} className={dias === n ? "on" : ""} onClick={() => setDias(n)}>
              {n === 1 ? "24 horas" : `${n} dias`}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {gatewayUrl && (
          <a className="mini ghost" href={gatewayUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            Abrir conversas (WA-AKG)
          </a>
        )}
      </div>
      {!d ? (
        <div className="empty">Carregando…</div>
      ) : (
        <>
          <div className="crm-h3">Atendimento</div>
          {!a || !a.mensagensClientes ? (
            <div className="muted">Nenhuma conversa no período.</div>
          ) : (
            <div className="pg-mini pg-mini-largo">
              <div>
                <b>{a.conversas}</b>
                <small>conversas</small>
              </div>
              <div>
                <b>{minutos(a.medianaMin)}</b>
                <small>tempo de resposta (mediana)</small>
              </div>
              <div>
                <b>{a.respondidas ? `${Math.round((a.rapidas / a.respondidas) * 100)}%` : "–"}</b>
                <small>respondidas em até 15 min</small>
              </div>
              <div className={a.lentas ? "ruim" : ""}>
                <b>{a.lentas}</b>
                <small>demoraram mais de 1h</small>
              </div>
            </div>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Conta só o horário de atendimento configurado (sem domingo). Uma sequência de mensagens da cliente vale como uma espera, a partir da primeira.
          </div>

          {d.pendentes.length > 0 && (
            <>
              <div className="crm-h3">Esperando resposta</div>
              <ListaPendentes pendentes={d.pendentes} />
            </>
          )}

          <div className="crm-h3">Celular no caixa por vendedora</div>
          {!d.vendedoras.length ? (
            <div className="muted">Sem vendas com vendedora identificada no período. Rode a carga do TOTVS de novo para puxar as vendedoras.</div>
          ) : (
            <table className="prod-tbl fin-tbl">
              <thead>
                <tr>
                  <th>Vendedora</th>
                  <th className="n">Vendas</th>
                  <th className="n">Com celular</th>
                  <th className="n">Sem cliente na nota</th>
                  <th style={{ width: "30%" }}>%</th>
                </tr>
              </thead>
              <tbody>
                {d.vendedoras.map((v) => (
                  <tr key={v.nome}>
                    <td className="fin-desc">{v.nome}</td>
                    <td className="n">{v.vendas}</td>
                    <td className="n">{v.comCelular}</td>
                    <td className="n">{v.semCliente || ""}</td>
                    <td>
                      <div className="pg-progresso pg-progresso-linha">
                        <i style={{ width: `${v.pct ?? 0}%` }} />
                        <span>{v.pct ?? 0}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Janela>
  );
}
