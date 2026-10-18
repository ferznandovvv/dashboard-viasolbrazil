"use client";

import { useCallback, useEffect, useState } from "react";
import { api, dataHora } from "./comum";
import { Janela } from "./Clientes";
import { formatarTelefone } from "@/lib/crm/telefone";
import type { CardLoja, Nivel } from "@/lib/crm/painel";

type Loja = CardLoja & { conectado: boolean | null; detalheNumero?: string; peloWhats: { vendas: number; valor: number; pctVendas: number | null } };

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
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const ehAlertaCelular = (t: string) => /vendas com celular/.test(t);

function usePainel() {
  const [p, setP] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");
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
  return { p, erro };
}

/** Aba Atendimento: WhatsApp de cada loja, quem está esperando e o que virou venda. */
export function PainelAtendimento() {
  const { p, erro } = usePainel();
  const [aberta, setAberta] = useState<string | null>(null);
  if (!p) return <div className="empty">{erro || "Carregando…"}</div>;
  const g = p.geral;
  const ordem: Nivel[] = ["critico", "atencao", "ok", "inativo"];
  // No atendimento, o semáforo é só do WhatsApp (celular no caixa fica no CRM)
  const lojas = p.lojas.map((l) => {
    const alertas = l.alertas.filter((x) => !ehAlertaCelular(x));
    let nivel = l.nivel;
    if (l.numero.ativo && nivel === "atencao" && !alertas.length) nivel = "ok";
    return { ...l, alertas, nivel };
  });
  const ligadas = lojas.filter((l) => l.numero.ativo).sort((a, b) => ordem.indexOf(a.nivel) - ordem.indexOf(b.nivel));
  const semNumero = lojas.filter((l) => !l.numero.ativo);
  const vendasW = ligadas.reduce((s, l) => s + l.peloWhats.vendas, 0);
  const valorW = ligadas.reduce((s, l) => s + l.peloWhats.valor, 0);

  return (
    <div>
      <div className="tiles pg-kpis">
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
          <div className="label">Clientes hoje</div>
          <div className="value">{g.conversasHoje}</div>
          <div className="muted">chamaram as lojas no WhatsApp</div>
        </div>
        <div className="tile">
          <div className="label">Vendas pelo WhatsApp</div>
          <div className="value">{vendasW}</div>
          <div className="muted">{vendasW ? `${reais(valorW)} no mês` : "no mês"}</div>
        </div>
        <div className={`tile ${g.numeros && g.conectados < g.numeros ? "alerta" : ""}`}>
          <div className="label">WhatsApp</div>
          <div className="value">
            {g.conectados}/{g.numeros}
          </div>
          <div className="muted">{g.numeros ? "números conectados" : "nenhum número ligado ainda"}</div>
        </div>
      </div>

      {p.pendentes.length > 0 && (
        <div className="card pg-esperando">
          <h2>Esperando resposta agora</h2>
          <ListaPendentes pendentes={p.pendentes} comLoja />
        </div>
      )}

      {!g.eventos && ligadas.length > 0 && (
        <div className="card muted pg-dica">
          Nenhuma conversa chegou ainda. O painel confere o webhook de cada número sozinho a cada 10 minutos; se continuar vazio, use &quot;situação&quot; em CRM → Configurar → Números, que mostra se o webhook está ok.
        </div>
      )}

      <div className="pg-lojas">
        {ligadas.map((l) => (
          <CartaoLoja key={l.loja} l={l} abrir={() => setAberta(l.loja)} />
        ))}
      </div>
      {semNumero.length > 0 && (
        <p className="muted pg-semnumero">Sem WhatsApp ligado ao painel: {semNumero.map((l) => l.loja).join(", ")}.</p>
      )}

      {aberta && <DetalheLoja loja={aberta} gatewayUrl={p.gatewayUrl} fechar={() => setAberta(null)} />}
    </div>
  );
}

/** Visão geral do CRM: envio, celular no caixa por loja e conferência do cashback. */
export function VisaoGeral({ r }: { r: { base: { clientes: number; comTelefone: number; saldoTotal: number } } }) {
  const { p, erro } = usePainel();
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
  const lojas = [...p.lojas].filter((l) => l.cadastro.vendas30 > 0).sort((a, b) => (b.cadastro.pct30 ?? 0) - (a.cadastro.pct30 ?? 0));
  const pctBase = r.base.clientes ? Math.round((r.base.comTelefone / r.base.clientes) * 100) : 0;

  return (
    <div>
      <div className={`pg-envio ${situacaoEnvio.cls}`}>{situacaoEnvio.txt}</div>

      <div className="tiles pg-kpis">
        <div className="tile">
          <div className="label">Clientes na base</div>
          <div className="value">{r.base.clientes.toLocaleString("pt-BR")}</div>
          <div className="muted">{pctBase}% com celular</div>
        </div>
        <div className="tile">
          <div className="label">Vendas com celular</div>
          <div className="value">{pctCel === null ? "–" : `${pctCel}%`}</div>
          <div className="muted">
            {g.comCelular30} de {g.vendas30} vendas · 30 dias
          </div>
        </div>
        <div className="tile">
          <div className="label">Cashback em aberto</div>
          <div className="value">{reais(r.base.saldoTotal)}</div>
          <div className="muted">no nome das clientes</div>
        </div>
      </div>

      <section className="card">
        <h2>Celular no caixa por loja</h2>
        <p className="muted pg-nota">Das vendas dos últimos 30 dias, quantas saíram com o celular da cliente (no campo de celular ou no endereço do cadastro).</p>
        <div className="tbl-wrap">
          <table className="prod-tbl fin-tbl">
            <thead>
              <tr>
                <th>Loja</th>
                <th style={{ width: "34%" }}>Vendas com celular</th>
                <th className="n">Vendas</th>
                <th className="n">vs 30 dias antes</th>
                <th className="n">Clientes novas na semana</th>
              </tr>
            </thead>
            <tbody>
              {lojas.map((l) => {
                const c = l.cadastro;
                const delta = c.pct30 !== null && c.pctAnterior !== null ? c.pct30 - c.pctAnterior : null;
                return (
                  <tr key={l.loja}>
                    <td className="fin-desc">{l.loja}</td>
                    <td>
                      <span className="an-linha">
                        <span className={`an-bar ${(c.pct30 ?? 0) < 50 ? "baixo" : "bom"}`} style={{ width: `${c.pct30 ?? 0}%` }} />
                        <em>{c.pct30 ?? 0}%</em>
                      </span>
                    </td>
                    <td className="n">{c.vendas30}</td>
                    <td className={`n ${delta !== null && delta < 0 ? "vencida" : ""}`}>{delta === null || delta === 0 ? "" : `${delta > 0 ? "+" : ""}${delta} pts`}</td>
                    <td className="n">
                      {c.novas7d} com celular{c.novas7dSemCelular ? `, ${c.novas7dSemCelular} sem` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ConferenciaCashback />
    </div>
  );
}

function CartaoLoja({ l, abrir }: { l: Loja; abrir: () => void }) {
  const a = l.atend;
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

      <div className="pg-sec">Vendas pelo WhatsApp no mês</div>
      <div className="pg-cel">
        <span className="pg-cel-pct">{l.peloWhats.vendas}</span>
        <span className="pg-cel-info">
          {l.peloWhats.vendas ? `${reais(l.peloWhats.valor)}${l.peloWhats.pctVendas !== null ? `, ${l.peloWhats.pctVendas}% das vendas` : ""}` : "nenhuma ainda"}
          <small className="muted">frete de motoboy ou conversa nos 7 dias antes</small>
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
            Conta só o horário de atendimento da loja (Configurar → Números). "Obrigada", "ok" e figurinha não contam como espera. Uma sequência de mensagens da cliente vale como uma espera, a partir da primeira.
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

interface ItemConf {
  tipo: "desconto_sem_baixa" | "baixa_sem_desconto";
  data: string;
  loja: string;
  cliente: string;
  vendedora?: string;
  compra?: number;
  desconto?: number;
  saldoNaHora?: number;
  baixa?: number;
}

/** Cashback manual conferido contra as notas: desconto sem baixa e baixa sem desconto. */
function ConferenciaCashback() {
  const [dias, setDias] = useState(14);
  const [c, setC] = useState<{ vendasConferiveis: number; vendasComDesconto: number; baixas: number; itens: ItemConf[]; porLoja: { loja: string; descontoSemBaixa: number; baixaSemDesconto: number; baixas: number }[] } | null>(null);
  useEffect(() => {
    api<NonNullable<typeof c>>(`/api/crm/conferencia?dias=${dias}`).then(setC).catch(() => setC(null));
  }, [dias]);
  const reais = (v?: number) => (v === undefined ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
  const semBaixa = c?.itens.filter((i) => i.tipo === "desconto_sem_baixa").length ?? 0;
  const semDesc = c?.itens.filter((i) => i.tipo === "baixa_sem_desconto").length ?? 0;
  return (
    <section className="card">
      <div className="fin-cab">
        <h2>Conferência do cashback</h2>
        <div className="seg">
          {[7, 14, 30].map((n) => (
            <button key={n} className={dias === n ? "on" : ""} onClick={() => setDias(n)}>
              {n} dias
            </button>
          ))}
        </div>
      </div>
      {!c ? (
        <div className="muted">Carregando…</div>
      ) : !c.vendasConferiveis ? (
        <p className="muted">
          Começa a valer com as vendas sincronizadas a partir de agora: a sincronização diária passou a trazer o desconto de cada nota. Aqui vão aparecer as vendas pra clientes com saldo que tiveram desconto no PDV sem baixa no painel da loja, e as baixas sem desconto na nota.
        </p>
      ) : (
        <>
          <div className="pg-mini pg-mini-largo cf-resumo">
            <div>
              <b>{c.baixas}</b>
              <small>baixas feitas no painel da loja</small>
            </div>
            <div className={semBaixa ? "ruim" : ""}>
              <b>{semBaixa}</b>
              <small>vendas com desconto pra cliente com saldo, sem baixa</small>
            </div>
            <div className={semDesc ? "medio" : ""}>
              <b>{semDesc}</b>
              <small>baixas sem desconto na nota</small>
            </div>
          </div>
          {!c.itens.length ? (
            <p className="muted" style={{ marginTop: 10 }}>Tudo batendo no período.</p>
          ) : (
            <div className="tbl-wrap" style={{ marginTop: 12 }}>
              <table className="prod-tbl fin-tbl">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Loja</th>
                    <th>Cliente</th>
                    <th>Vendedora</th>
                    <th className="n">Compra</th>
                    <th className="n">Desconto</th>
                    <th className="n">Saldo que tinha</th>
                    <th>O que olhar</th>
                  </tr>
                </thead>
                <tbody>
                  {c.itens.slice(0, 60).map((i, k) => (
                    <tr key={k}>
                      <td style={{ whiteSpace: "nowrap" }}>{dataHora(i.data)}</td>
                      <td>{i.loja}</td>
                      <td className="fin-desc">{i.cliente}</td>
                      <td>{i.vendedora ?? ""}</td>
                      <td className="n">{reais(i.compra)}</td>
                      <td className="n">{reais(i.desconto)}</td>
                      <td className="n">{reais(i.saldoNaHora)}</td>
                      <td>
                        {i.tipo === "desconto_sem_baixa" ? (
                          <span className="fin-status vencida">desconto sem baixa</span>
                        ) : (
                          <span className="fin-status hoje">baixa de {reais(i.baixa)} sem desconto na nota</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted cf-nota">
            Desconto sem baixa: ou a vendedora esqueceu de dar baixa (e a cliente pode usar o mesmo cashback de novo), ou o desconto foi por outro motivo. Baixa sem desconto: a nota ainda não chegou ou a baixa foi feita sem o desconto. Desconto com código de aniversário ou de campanha não entra aqui.
          </p>
        </>
      )}
    </section>
  );
}
