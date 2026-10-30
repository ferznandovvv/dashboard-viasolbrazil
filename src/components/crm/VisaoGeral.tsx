"use client";

import { useCallback, useEffect, useState } from "react";
import { api, brl, dataBr, dataHora } from "./comum";
import { Janela } from "./Clientes";
import { formatarTelefone } from "@/lib/crm/telefone";
import type { CardLoja } from "@/lib/crm/painel";
import type { LinhaEnvio } from "@/lib/crm/envioPainel";
import type { ResumoEcommerce, ResumoSiteMes } from "@/lib/crm/ecommerce";
import type { CashbackMes, VoltaramLoja } from "@/lib/crm/resumoMes";
import type { ResultadoCampanha } from "@/lib/crm/campanhas";
import type { ResumoIndicacoes } from "@/lib/crm/indicacao";

type Loja = CardLoja & { conectado: boolean | null; detalheNumero?: string; peloWhats: { vendas: number; valor: number; pctVendas: number | null } };

interface Pendente {
  ultima?: string;
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
  sairam?: { telefone: string; nome?: string; em: string; loja?: string; texto?: string }[];
  envioNumeros?: (LinhaEnvio & { conectado: boolean | null })[];
  ecommerce?: ResumoEcommerce;
  siteMes?: ResumoSiteMes;
  indicacoes?: ResumoIndicacoes;
  cashbackMes?: CashbackMes;
  voltaram?: { lojas: VoltaramLoja[]; total: Omit<VoltaramLoja, "loja"> };
  retorno?: { id: string; nome: string; manual: boolean; r: ResultadoCampanha }[];
  siteSombra?: boolean;
  envio: { modoSombra: boolean; pausado: boolean; provedor: string | null; dentroDaJanela: boolean; naFila: number; inicio: number; fim: number };
  gatewayUrl?: string;
}

export const minutos = (m: number | null | undefined) =>
  m === null || m === undefined ? "–" : m < 1 ? "< 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;


/** Visão gerencial: um cartão por loja com atendimento, WhatsApp e captura de celular. */
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

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
  return { p, erro, carregar };
}

/**
 * Aba Atendimento: todas as lojas numa tabela só, para ver de uma vez como
 * cada uma está, e embaixo quem está esperando resposta em qualquer loja.
 * O nome da loja abre os detalhes dela.
 */
export function PainelAtendimento() {
  const { p, erro, carregar } = usePainel();
  const [aberta, setAberta] = useState<string | null>(null);
  const [ignorando, setIgnorando] = useState<Set<string>>(new Set());
  if (!p) return <div className="empty">{erro || "Carregando…"}</div>;

  const ignorar = async (x: Pendente) => {
    const chave = `${x.loja}|${x.telefone}`;
    setIgnorando((s) => new Set(s).add(chave));
    try {
      await api("/api/crm/atendimento", { method: "POST", body: JSON.stringify({ acao: "ignorar", loja: x.loja, telefone: x.telefone, ate: x.ultima }) });
      await carregar();
    } finally {
      setIgnorando((s) => {
        const n = new Set(s);
        n.delete(chave);
        return n;
      });
    }
  };

  const pendentes = p.pendentes.filter((x) => !ignorando.has(`${x.loja}|${x.telefone}`)).sort((a, b) => b.esperando - a.esperando);
  const daLoja = (loja: string) => pendentes.filter((x) => x.loja === loja);
  const ligadas = p.lojas
    .filter((l) => l.numero.ativo)
    .map((l) => ({ l, esp: daLoja(l.loja) }))
    // Desconectada primeiro, depois quem tem gente esperando há mais tempo, depois quem tem mais conversa
    .sort(
      (a, b) =>
        Number(b.l.conectado === false) - Number(a.l.conectado === false) ||
        (b.esp[0]?.esperando ?? -1) - (a.esp[0]?.esperando ?? -1) ||
        b.l.atend.conversasHoje - a.l.atend.conversasHoje
    );
  const semNumero = p.lojas.filter((l) => !l.numero.ativo);
  const desligadas = ligadas.filter(({ l }) => l.conectado === false).map(({ l }) => l.loja);
  const lenta = (m: number | null) => (m === null ? "" : m > 30 ? "ruim" : m > 15 ? "medio" : "bom");

  return (
    <div>
      {!p.geral.eventos && ligadas.length > 0 && (
        <div className="card muted pg-dica">
          Nenhuma conversa chegou ainda. O painel confere o webhook de cada número sozinho a cada 10 minutos; se continuar vazio, use &quot;situação&quot; em Configurações › CRM › Números, que mostra se o webhook está ok.
        </div>
      )}

      <section className="card" aria-labelledby="at-geral-titulo">
        <header className="at-cab">
          <h2 id="at-geral-titulo">Lojas agora</h2>
          {p.gatewayUrl && (
            <span className="at-cab-acoes">
              <a className="mini ghost" href="/whats?volta=%2Fdashboard%2Fchat" target="_blank" rel="noreferrer">
                Abrir conversas <span className="so-leitor">(abre em outra aba)</span>
              </a>
            </span>
          )}
        </header>
        {ligadas.length === 0 ? (
          <p className="at-emdia">Nenhuma loja com WhatsApp ligado ao painel ainda.</p>
        ) : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Atendimento de cada loja">
            <table className="prod-tbl at-geral">
              <thead>
                <tr>
                  <th scope="col">Loja</th>
                  <th scope="col">WhatsApp</th>
                  <th scope="col" className="n">Esperando</th>
                  <th scope="col" className="n">Responde em</th>
                  <th scope="col" className="n">Em até 15 min</th>
                  <th scope="col" className="n">Clientes hoje</th>
                  <th scope="col">Clientes por dia</th>
                  <th scope="col" className="n">Vendas pelo WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {ligadas.map(({ l, esp }) => {
                  const a = l.atend;
                  const desligada = l.conectado === false;
                  const resposta = a.medianaHoje ?? a.mediana7d;
                  return (
                    <tr key={l.loja} className={`clicavel${desligada ? " desligada" : ""}`} onClick={() => setAberta(l.loja)}>
                      <th scope="row">
                        <button type="button" className="link at-nome" onClick={(e) => {
                            e.stopPropagation();
                            setAberta(l.loja);
                          }}>
                          {l.loja}
                        </button>
                      </th>
                      <td className={`at-zap ${desligada ? "ruim" : l.conectado ? "bom" : ""}`}>
                        {desligada ? "■ desconectado" : l.conectado ? "● conectado" : "sem provedor"}
                      </td>
                      <td className={`n ${esp.length ? (esp[0].esperando > 60 ? "ruim" : "medio") : "bom"}`}>
                        <b>{esp.length}</b>
                        {esp.length > 0 && <small>a mais antiga há {minutos(esp[0].esperando)}</small>}
                      </td>
                      <td className={`n ${lenta(resposta)}`}>
                        <b>{minutos(resposta)}</b>
                        <small>{a.medianaHoje !== null ? `hoje · 7 dias: ${minutos(a.mediana7d)}` : "nos 7 dias"}</small>
                      </td>
                      <td className="n">
                        <b>{a.rapidas7d === null ? "–" : `${a.rapidas7d}%`}</b>
                        <small>7 dias</small>
                      </td>
                      <td className="n">
                        <b>{a.conversasHoje}</b>
                      </td>
                      <td>
                        <MiniBarras dias={a.dias} />
                      </td>
                      <td className="n">
                        <b>{l.peloWhats.vendas}</b>
                        {l.peloWhats.vendas > 0 && <small>{reais(l.peloWhats.valor)} no mês</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {semNumero.length > 0 && <p className="muted pg-semnumero">Sem WhatsApp ligado ao painel: {semNumero.map((l) => l.loja).join(", ")}.</p>}
        <p className="at-rodape">
          Toque numa loja para ver os detalhes dela. &quot;Responde em&quot; é o tempo do meio das respostas de hoje (ou dos 7 dias, se ainda não teve
          conversa hoje).
        </p>
      </section>

      <section className="card" aria-labelledby="at-espera-titulo">
        <h2 id="at-espera-titulo">Esperando resposta{pendentes.length ? ` · ${pendentes.length}` : ""}</h2>
        {pendentes.length ? (
          <ListaPendentes pendentes={pendentes} comLoja ignorar={ignorar} />
        ) : (
          <p className="at-emdia">Ninguém esperando em nenhuma loja. Tudo respondido.</p>
        )}
        {desligadas.length > 0 && (
          <p className="at-emdia">
            Com o WhatsApp desconectado em {desligadas.join(", ")}, as conversas novas de lá não chegam aqui.
          </p>
        )}
      </section>

      {aberta && <DetalheLoja loja={aberta} gatewayUrl={p.gatewayUrl} fechar={() => setAberta(null)} />}
    </div>
  );
}

/** Clientes por dia nos últimos 7 dias, pequeno, para caber na linha da loja. */
function MiniBarras({ dias }: { dias: { dia: string; conversas: number }[] }) {
  const max = Math.max(1, ...dias.map((d) => d.conversas));
  return (
    <span className="at-mini" role="img" aria-label={`Clientes por dia, últimos 7 dias: ${dias.map((d) => d.conversas).join(", ")}`}>
      {dias.map((d) => (
        <i
          key={d.dia}
          title={`${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}: ${d.conversas} clientes`}
          style={{ height: `${Math.max(d.conversas ? 15 : 4, (d.conversas / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** Visão geral do CRM: envio por número, dinheiro do cashback, clientes que voltaram, retorno das mensagens, site, celular no caixa. */
export function VisaoGeral({ r }: { r: { base: { clientes: number; comTelefone: number; saldoTotal: number } } }) {
  const { p, erro } = usePainel();
  if (!p) return <div className="empty">{erro || "Carregando…"}</div>;
  const g = p.geral;
  const pctCel = g.vendas30 ? Math.round((g.comCelular30 / g.vendas30) * 100) : null;
  const pctBase = r.base.clientes ? Math.round((r.base.comTelefone / r.base.clientes) * 100) : 0;
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
  return (
    <div>
      <div className="pg-status">
        <div className={`pg-envio ${situacaoEnvio.cls}`}>Lojas: {situacaoEnvio.txt}</div>
        {p.ecommerce && <div className={`pg-envio ${p.ecommerce.sombra ? "aviso" : "ok"}`}>Site: {p.ecommerce.sombra ? "modo sombra" : p.ecommerce.configurado ? "mandando" : "número do site não configurado"}</div>}
      </div>

      {p.cashbackMes && <ResultadoCashback c={p.cashbackMes} v={p.voltaram} emAberto={r.base.saldoTotal} />}
      {p.siteMes && <SiteMes s={p.siteMes} />}
      {p.indicacoes && (p.indicacoes.ativo || p.indicacoes.ultimas.length > 0) && <Indicacoes r={p.indicacoes} />}
      {p.retorno && p.retorno.length > 0 && <Retorno linhas={p.retorno} />}
      <ConferenciaCashback />

      <h2 className="secao-titulo">Operação</h2>
      {p.envioNumeros && p.envioNumeros.length > 0 && <EnvioNumeros linhas={p.envioNumeros} />}
      <CapturaCelular resumo={{ clientes: r.base.clientes, pctBase, pctCel, vendas30: g.vendas30, comCelular30: g.comCelular30 }} />

      {p.sairam && p.sairam.length > 0 && (
        <section className="card">
          <h2>Pediram para não receber mensagens</h2>
          <p className="muted pg-nota">
            Responderam SAIR (ou parecido) nos últimos 60 dias. O sistema não manda mais nada automático para esse telefone, em nenhuma loja. A loja pode continuar respondendo se a cliente chamar, mas não deve mandar promoção.
          </p>
          <ul className="pend-lista">
            {p.sairam.map((x) => (
              <li key={x.telefone} className="pend sair">
                <div className="pend-quem">
                  {x.loja && <span className="pend-loja">{x.loja}</span>}
                  <b>{x.nome ?? "Não cadastrada"}</b>
                  <small>{formatarTelefone(x.telefone)}</small>
                </div>
                {x.texto && <p className="pend-texto">“{x.texto}”</p>}
                <div className="pend-tempo">
                  <small>{dataHora(x.em)}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ListaPendentes({ pendentes, comLoja, ignorar }: { pendentes: Pendente[]; comLoja?: boolean; ignorar?: (p: Pendente) => void }) {
  return (
    <ul className="pend-lista">
      {pendentes.map((p) => (
        <li key={`${p.loja}|${p.telefone}`} className="pend">
          <div className="pend-quem">
            {comLoja && <span className="pend-loja">{p.loja}</span>}
            <b>{p.nomeMostrar ?? <span className="muted">sem nome</span>}</b>
            <small>
              {/^55\d{10,11}$/.test(p.telefone) ? formatarTelefone(p.telefone) : "número escondido pelo WhatsApp"}
              {!p.cliente && " · não está na base"}
            </small>
          </div>
          {p.texto && <p className="pend-texto">{p.texto}</p>}
          <div className="pend-tempo">
            <span className={`fin-status ${p.esperando > 60 ? "vencida" : "hoje"}`}>há {minutos(p.esperando)}</span>
            <small>desde {dataHora(p.desde)}</small>
            {ignorar && (
              <button className="link pend-ignorar" onClick={() => ignorar(p)} title="Tira da lista até ela escrever de novo">
                não precisa responder
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
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
          <a className="mini ghost" href="/whats?volta=%2Fdashboard%2Fchat" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            Abrir conversas (WA-AKG) <span className="so-leitor">(abre em outra aba)</span>
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
        <h2>Descontos pra conferir</h2>
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
            <div className="tbl-wrap" style={{ marginTop: 12 }} tabIndex={0} role="region" aria-label="Conferência do cashback">
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
            Nem tudo aqui é erro: a loja dá desconto por outros motivos (troca, promoção, desconto da vendedora). Serve pra conferir. Desconto sem baixa: a cliente tinha saldo e teve desconto na nota, mas ninguém deu baixa no cashback (se era cashback, ela pode usar de novo). Baixa sem desconto: a nota ainda não chegou ou a baixa foi feita sem o desconto. Código de aniversário ou de campanha não entra aqui.
          </p>
        </>
      )}
    </section>
  );
}

interface LinhaCap {
  vendas: number;
  comCelular: number;
  cadastroSemCelular: number;
  semCadastro: number;
  pct: number | null;
}
interface Captura {
  dias: number;
  total: LinhaCap;
  lojas: (LinhaCap & { loja: string; pctAnterior: number | null })[];
  loja?: string;
  vendedoras?: (LinhaCap & { nome: string })[];
  lista?: { data: string; vendedora: string; cliente: string; valor: number; tipo: "cadastro_sem_celular" | "sem_cadastro" }[];
}

/** Barra empilhada: com celular, cadastro sem celular, sem cadastro. */
function BarraCaptura({ l }: { l: LinhaCap }) {
  const w = (n: number) => `${l.vendas ? (n / l.vendas) * 100 : 0}%`;
  return (
    <span className="cap-barra" aria-hidden>
      <i className="com" style={{ width: w(l.comCelular) }} />
      <i className="semcel" style={{ width: w(l.cadastroSemCelular) }} />
      <i className="semcad" style={{ width: w(l.semCadastro) }} />
    </span>
  );
}

const PERIODOS = [7, 30] as const;

/** Celular no caixa por loja, separando cadastro sem celular de venda sem cadastro. */
function CapturaCelular({ resumo }: { resumo: { clientes: number; pctBase: number; pctCel: number | null; vendas30: number; comCelular30: number } }) {
  const [dias, setDias] = useState<number>(30);
  const [d, setD] = useState<Captura | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [tabela, setTabela] = useState(false);
  useEffect(() => {
    api<Captura>(`/api/crm/captura?dias=${dias}`).then(setD).catch(() => setD(null));
  }, [dias]);
  return (
    <section className="card">
      <div className="fin-cab">
        <h2>Celular no caixa por loja</h2>
        <div className="seg">
          {PERIODOS.map((n) => (
            <button key={n} className={dias === n ? "on" : ""} onClick={() => setDias(n)}>
              {n} dias
            </button>
          ))}
        </div>
      </div>
      <p className="muted pg-nota">
        {resumo.pctCel ?? 0}% das vendas dos últimos 30 dias saíram com o celular da cliente ({resumo.comCelular30} de {resumo.vendas30}). A base tem {resumo.clientes.toLocaleString("pt-BR")} clientes, {resumo.pctBase}% com celular. Clique na loja para ver por vendedora e as vendas sem celular.
      </p>
      {d && !tabela && (
        <ul className="cap-resumo">
          {d.lojas.map((l) => {
            const delta = l.pct !== null && l.pctAnterior !== null ? l.pct - l.pctAnterior : null;
            return (
              <li key={l.loja}>
                <button className="cap-resumo-l" onClick={() => setAberta(l.loja)}>
                  <span className="cap-resumo-nome">{l.loja}</span>
                  <BarraCaptura l={l} />
                  <b>{l.pct ?? 0}%</b>
                  {delta ? <small className={delta < 0 ? "cap-pior" : "cap-melhor"}>{delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</small> : <small />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button className="link" onClick={() => setTabela(!tabela)}>{tabela ? "ver resumo" : "ver tabela completa"}</button>
      {tabela && (
      <>
      <div className="cap-legenda">
        <span><i className="com" /> com celular</span>
        <span><i className="semcel" /> cliente cadastrada, mas sem celular</span>
        <span><i className="semcad" /> venda sem cliente na nota</span>
      </div>
      {!d ? (
        <div className="empty">Carregando…</div>
      ) : (
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Celular no caixa por loja">
          <table className="prod-tbl fin-tbl cap-tbl">
            <thead>
              <tr>
                <th>Loja</th>
                <th className="n">Vendas</th>
                <th className="n">Com celular</th>
                <th className="n">Cadastro sem celular</th>
                <th className="n">Sem cliente na nota</th>
                <th style={{ width: "26%" }}>
                  <span className="so-leitor">Proporção</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.lojas.map((l) => {
                const delta = l.pct !== null && l.pctAnterior !== null ? l.pct - l.pctAnterior : null;
                return (
                  <tr key={l.loja} className="cap-linha" onClick={() => setAberta(l.loja)}>
                    <td className="fin-desc">
                      <button className="link cap-loja" onClick={() => setAberta(l.loja)}>
                        {l.loja}
                      </button>
                    </td>
                    <td className="n">{l.vendas}</td>
                    <td className="n">
                      <b>{l.pct ?? 0}%</b> <small className="muted">({l.comCelular})</small>
                      {delta ? <small className={delta < 0 ? "cap-pior" : "cap-melhor"}> {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</small> : null}
                    </td>
                    <td className={`n ${l.cadastroSemCelular ? "cap-semcel" : ""}`}>{l.cadastroSemCelular}</td>
                    <td className={`n ${l.semCadastro ? "cap-semcad" : ""}`}>{l.semCadastro}</td>
                    <td>
                      <BarraCaptura l={l} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted pg-nota cap-rodape">▲▼ = pontos a mais ou a menos que nos {dias} dias anteriores.</p>
        </div>
      )}
      </>
      )}
      {aberta && <CapturaDaLoja loja={aberta} dias={dias} fechar={() => setAberta(null)} />}
    </section>
  );
}

function CapturaDaLoja({ loja, dias, fechar }: { loja: string; dias: number; fechar: () => void }) {
  const [d, setD] = useState<Captura | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "cadastro_sem_celular" | "sem_cadastro">("todas");
  useEffect(() => {
    api<Captura>(`/api/crm/captura?dias=${dias}&loja=${encodeURIComponent(loja)}`).then(setD).catch(() => setD(null));
  }, [loja, dias]);
  const lista = (d?.lista ?? []).filter((x) => filtro === "todas" || x.tipo === filtro);
  return (
    <Janela titulo={`${loja}: celular no caixa, ${dias} dias`} fechar={fechar} larga>
      {!d?.vendedoras ? (
        <div className="empty">Carregando…</div>
      ) : (
        <>
          <h3 className="cap-sub">Por vendedora</h3>
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Celular por vendedora">
            <table className="prod-tbl fin-tbl cap-tbl">
              <thead>
                <tr>
                  <th>Vendedora</th>
                  <th className="n">Vendas</th>
                  <th className="n">Com celular</th>
                  <th className="n">Cadastro sem celular</th>
                  <th className="n">Sem cliente na nota</th>
                  <th style={{ width: "24%" }}>
                    <span className="so-leitor">Proporção</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.vendedoras.map((v) => (
                  <tr key={v.nome}>
                    <td className="fin-desc">{v.nome}</td>
                    <td className="n">{v.vendas}</td>
                    <td className="n">
                      <b>{v.pct ?? 0}%</b> <small className="muted">({v.comCelular})</small>
                    </td>
                    <td className={`n ${v.cadastroSemCelular ? "cap-semcel" : ""}`}>{v.cadastroSemCelular}</td>
                    <td className={`n ${v.semCadastro ? "cap-semcad" : ""}`}>{v.semCadastro}</td>
                    <td>
                      <BarraCaptura l={v} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="fin-cab cap-lista-cab">
            <h3 className="cap-sub">Vendas sem celular ({(d.lista ?? []).length})</h3>
            <div className="seg">
              <button className={filtro === "todas" ? "on" : ""} onClick={() => setFiltro("todas")}>
                Todas
              </button>
              <button className={filtro === "cadastro_sem_celular" ? "on" : ""} onClick={() => setFiltro("cadastro_sem_celular")}>
                Cadastro sem celular
              </button>
              <button className={filtro === "sem_cadastro" ? "on" : ""} onClick={() => setFiltro("sem_cadastro")}>
                Sem cliente
              </button>
            </div>
          </div>
          {lista.length ? (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Vendas sem celular">
              <table className="prod-tbl fin-tbl">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Vendedora</th>
                    <th>Cliente</th>
                    <th className="n">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((x, i) => (
                    <tr key={i}>
                      <td>{new Date(x.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</td>
                      <td>{x.vendedora}</td>
                      <td className={x.tipo === "sem_cadastro" ? "cap-semcad" : ""}>{x.cliente}</td>
                      <td className="n">{reais(x.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Nenhuma venda sem celular nesse filtro.</p>
          )}
        </>
      )}
    </Janela>
  );
}

const pctTxt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n}%`);
const nivelUso = (usado: number, teto: number) => (teto <= 0 ? "" : usado / teto >= 0.9 ? "ruim" : usado / teto >= 0.7 ? "medio" : "bom");

/** Quanto cada número já mandou hoje perto do teto, a fila e os sinais de risco. */
function EnvioNumeros({ linhas }: { linhas: (LinhaEnvio & { conectado: boolean | null })[] }) {
  return (
    <section className="card">
      <h2>Envio por número</h2>
      <p className="muted pg-nota">
        Hoje = mensagens que já saíram de quantas o número pode mandar no dia. Em modo sombra, &quot;sairiam hoje&quot; mostra quantas teriam saído: se passar do teto, a fila vai acumular quando ligar. SAIR e erro altos nos últimos 7 dias são o sinal de risco de bloqueio.
      </p>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Envio por número">
        <table className="prod-tbl fin-tbl env-tbl">
          <thead>
            <tr>
              <th>Número</th>
              <th style={{ width: "28%" }}>Hoje</th>
              <th className="n">Na fila</th>
              <th className="n">Enviadas 7d</th>
              <th className="n">Responderam</th>
              <th className="n">SAIR 7d</th>
              <th className="n">Erros 7d</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const usado = Math.max(l.hoje, l.simuladasHoje);
              const pct = l.teto ? Math.min(100, Math.round((usado / l.teto) * 100)) : 0;
              return (
                <tr key={`${l.provedor}-${l.loja}`} className={l.ativo ? "" : "off"}>
                  <td className="fin-desc">
                    <b>{l.loja}</b>
                    <small className="muted">
                      {" "}
                      {l.provedor === "oficial" ? "oficial" : "WA-AKG"}
                      {!l.ativo ? " · desligado" : l.ligarEm ? ` · volta em ${l.ligarEm.slice(8, 10)}/${l.ligarEm.slice(5, 7)}` : l.conectado === false ? " · desconectado" : ""}
                    </small>
                  </td>
                  <td>
                    <div className={`env-barra ${nivelUso(usado, l.teto)}`} title={`${usado} de ${l.teto}`}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <small>
                      {l.hoje} de {l.teto}
                      {l.simuladasHoje > 0 ? ` · ${l.simuladasHoje} sairiam hoje` : ""}
                    </small>
                  </td>
                  <td className="n">
                    {l.naFila}
                    {l.filaDias > 0 && <small className="cap-pior"> · {l.filaDias}d</small>}
                  </td>
                  <td className="n">{l.enviadas7d}</td>
                  <td className="n">{pctTxt(l.pctResposta)}</td>
                  <td className={`n ${l.sair7d >= 3 ? "cap-semcad" : ""}`}>{l.sair7d}</td>
                  <td className={`n ${l.erros7d >= 3 ? "cap-semcad" : ""}`}>{l.erros7d}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const pctDe = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const reais2 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nomeDoMes = (mes: string) => new Date(`${mes}T12:00:00`).toLocaleDateString("pt-BR", { month: "long" });

/**
 * O que o cashback trouxe no mês: quanto vendeu nas compras em que a cliente
 * usou, quanto de desconto isso custou e quantas clientes voltaram. O que foi
 * creditado e o que está em aberto fica numa linha no fim (não é resultado).
 */
function ResultadoCashback({ c, v, emAberto }: { c: CashbackMes; v?: { lojas: VoltaramLoja[]; total: Omit<VoltaramLoja, "loja"> }; emAberto: number }) {
  const mes = nomeDoMes(c.mes);
  const porReal = c.usado ? c.comprasComCashback / c.usado : null;
  const lojas = Array.from(new Set([...c.porLoja.map((l) => l.loja), ...(v?.lojas ?? []).map((l) => l.loja)]))
    .map((loja) => ({ loja, cb: c.porLoja.find((l) => l.loja === loja), vt: v?.lojas.find((l) => l.loja === loja) }))
    .sort((x, y) => (y.cb?.comprasComCashback ?? 0) - (x.cb?.comprasComCashback ?? 0) || (y.vt?.compradoras ?? 0) - (x.vt?.compradoras ?? 0));
  const dVolta = v && v.total.pct !== null && v.total.pctAnterior !== null ? v.total.pct - v.total.pctAnterior : null;
  return (
    <section className="card">
      <h2>Resultado do cashback em {mes}</h2>
      <div className="res-kpis">
        <div className="res-kpi destaque">
          <div className="k-label">Vendas com cashback</div>
          <div className="k-valor">{reais(c.comprasComCashback)}</div>
          <div className="k-sub">
            {c.vendasComCashback} {c.vendasComCashback === 1 ? "venda" : "vendas"}
            {c.vendasMes ? ` · ${pctDe(c.vendasComCashback, c.vendasMes) ?? 0}% das ${c.vendasMes.toLocaleString("pt-BR")} vendas do mês` : ""}
          </div>
        </div>
        <div className="res-kpi">
          <div className="k-label">Desconto dado com cashback</div>
          <div className="k-valor">{reais(c.usado)}</div>
          <div className="k-sub">{c.comprasComCashback ? `${pctDe(c.usado, c.comprasComCashback)}% do valor dessas vendas` : "nenhum uso ainda"}</div>
        </div>
        <div className="res-kpi">
          <div className="k-label">Cada R$ 1 de desconto</div>
          <div className="k-valor">{porReal ? reais2(porReal) : "–"}</div>
          <div className="k-sub">em vendas</div>
        </div>
        {v && (
          <div className="res-kpi">
            <div className="k-label">Clientes que voltaram</div>
            <div className="k-valor">{pctTxt(v.total.pct)}</div>
            <div className="k-sub">
              {v.total.voltaram} de {v.total.compradoras} clientes já tinham comprado antes
              {dVolta ? <span className={dVolta < 0 ? "cap-pior" : "cap-melhor"}> · {dVolta > 0 ? "▲" : "▼"}{Math.abs(dVolta)} pts</span> : null}
            </div>
          </div>
        )}
      </div>

      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`Resultado do cashback em ${mes}, por loja`}>
        <table className="prod-tbl res-tbl">
          <thead>
            <tr>
              <th scope="col">Loja</th>
              <th scope="col" className="n">Vendas com cashback</th>
              <th scope="col" className="n">Desconto</th>
              <th scope="col" className="n">Voltaram</th>
            </tr>
          </thead>
          <tbody>
            {lojas.map(({ loja, cb, vt }) => (
              <tr key={loja}>
                <th scope="row">{loja}</th>
                <td className="n">
                  {cb?.vendasComCashback && !cb.comprasComCashback ? (
                    <>
                      <span className="muted">–</span>
                      <small>
                        {cb.vendasComCashback} {cb.vendasComCashback === 1 ? "uso" : "usos"} sem a venda do dia
                      </small>
                    </>
                  ) : cb?.vendasComCashback ? (
                    <>
                      <b>{reais(cb.comprasComCashback)}</b>
                      <small>
                        {cb.vendasComCashback} {cb.vendasComCashback === 1 ? "venda" : "vendas"}
                        {cb.vendasMes ? ` de ${cb.vendasMes}` : ""}
                      </small>
                    </>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
                <td className="n">
                  {cb?.usado ? (
                    <>
                      {reais(cb.usado)}
                      {cb.comprasComCashback ? <small>{pctDe(cb.usado, cb.comprasComCashback)}% da venda</small> : null}
                    </>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
                <td className="n">
                  {vt ? (
                    <>
                      {pctTxt(vt.pct)}
                      <small>
                        {vt.voltaram} de {vt.compradoras}
                      </small>
                    </>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="n">
                {reais(c.comprasComCashback)}
                <small>
                  {c.vendasComCashback} {c.vendasComCashback === 1 ? "venda" : "vendas"}
                </small>
              </td>
              <td className="n">{reais(c.usado)}</td>
              <td className="n">{v ? pctTxt(v.total.pct) : "–"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="res-nota">
        Venda com cashback é a compra da cliente no dia e na loja em que ela usou o saldo. Voltaram: das clientes identificadas que compraram no mês, quantas já tinham comprado antes. Ainda no nome das clientes: {reais(emAberto)}
        {c.vencendo10d > 0 ? `, ${reais(c.vencendo10d)} vence nos próximos 10 dias (os lembretes saem sozinhos)` : ""}.
      </p>
    </section>
  );
}

/** Site no mês: faturamento e o que veio de cada mensagem automática. */
function SiteMes({ s }: { s: ResumoSiteMes }) {
  const mes = nomeDoMes(s.mes);
  const u = s.ultimo;
  return (
    <section className="card">
      <h2>Site em {mes}</h2>
      <div className="res-kpis">
        <div className="res-kpi">
          <div className="k-label">Vendas do site</div>
          <div className="k-valor">{reais(s.faturado)}</div>
          <div className="k-sub">{s.pedidos} {s.pedidos === 1 ? "pedido pago" : "pedidos pagos"}</div>
        </div>
        <div className="res-kpi destaque">
          <div className="k-label">Vieram das mensagens</div>
          <div className="k-valor">{reais(s.valorRecuperado)}</div>
          <div className="k-sub">
            {s.vendasRecuperadas} {s.vendasRecuperadas === 1 ? "pedido" : "pedidos"}
            {s.faturado ? ` · ${pctDe(s.valorRecuperado, s.faturado) ?? 0}% do faturamento` : ""}
          </div>
        </div>
      </div>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label={`Mensagens do site em ${mes}`}>
        <table className="prod-tbl res-tbl">
          <thead>
            <tr>
              <th scope="col">Mensagem</th>
              <th scope="col" className="n">Saíram</th>
              <th scope="col" className="n">Viraram venda</th>
              <th scope="col" className="n">Valor vendido</th>
              <th scope="col" className="n">Desconto</th>
            </tr>
          </thead>
          <tbody>
            {s.linhas.map((l) => (
              <tr key={l.campanha}>
                <th scope="row">
                  {l.nome}
                  {s.sombra && l.simuladas > 0 && <small>{l.simuladas} simuladas</small>}
                </th>
                <td className="n">{l.enviadas}</td>
                <td className="n">
                  {l.vendas}
                  {l.enviadas ? <small>{pctDe(l.vendas, l.enviadas)}%</small> : null}
                </td>
                <td className="n">{l.valor ? <b>{reais(l.valor)}</b> : <span className="muted">–</span>}</td>
                <td className="n">{l.desconto ? reais(l.desconto) : <span className="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="res-nota">
        Venda = pedido pago em até 3 dias depois da mensagem (no cashback do site, o cupom usado). Cada pedido conta uma vez, pro último aviso antes dele. O desconto do 2º aviso do carrinho é o que o cupom tirou.
        {u && ` Última leitura da Shopify: ${dataHora(u.em)}${u.erro ? ` (erro: ${u.erro})` : ""}.`}
      </p>
    </section>
  );
}

/** Retorno de cada campanha nos últimos 30 dias. */
function Retorno({ linhas }: { linhas: { id: string; nome: string; manual: boolean; r: ResultadoCampanha }[] }) {
  return (
    <section className="card">
      <h2>Retorno das mensagens</h2>
      <p className="muted pg-nota">
        Últimos 30 dias, por campanha. &quot;Compraram&quot; = compra em até 14 dias depois da mensagem (em qualquer loja ou no site); não prova que foi a mensagem, mas comparando campanhas dá pra ver qual puxa mais. Simuladas = modo sombra.
      </p>
      <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Retorno das mensagens">
        <table className="prod-tbl fin-tbl">
          <thead>
            <tr>
              <th>Campanha</th>
              <th className="n">Saíram</th>
              <th className="n">Responderam</th>
              <th className="n">SAIR</th>
              <th className="n">Compraram</th>
              <th className="n">Valor</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ id, nome, manual, r }) => (
              <tr key={id}>
                <td className="fin-desc">
                  {nome}
                  {manual && <small className="muted"> · campanha</small>}
                  {r.simuladas > 0 && <small className="muted"> · {r.simuladas} simuladas</small>}
                  {r.fila > 0 && <small className="muted"> · {r.fila} na fila</small>}
                </td>
                <td className="n">{r.enviadas}</td>
                <td className="n">
                  {r.respondidas} <small className="muted">{r.enviadas ? `${Math.round((r.respondidas / r.enviadas) * 100)}%` : ""}</small>
                </td>
                <td className={`n ${r.enviadas && r.sair / r.enviadas > 0.03 ? "cap-semcad" : ""}`}>{r.sair}</td>
                <td className="n">
                  {r.compraram} <small className="muted">{r.enviadas ? `${Math.round((r.compraram / r.enviadas) * 100)}%` : ""}</small>
                </td>
                <td className="n">{r.receita ? reais(r.receita) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const ROTULO_IND: Record<string, string> = { pendente: "esperando a carência", creditada: "cashback pago", recusada: "não valeu", sem_venda: "venda não achada" };

/** Indique uma amiga no mês: quantas vieram, quanto venderam, quanto custou; e as que precisam de olho. */
function Indicacoes({ r }: { r: ResumoIndicacoes }) {
  const mes = nomeDoMes(r.mes);
  const [msg, setMsg] = useState("");
  const [feitas, setFeitas] = useState<Set<string>>(new Set());
  const resolver = async (id: string, acao: "indicacao-aprovar" | "indicacao-recusar") => {
    try {
      const j = await api<{ detalhe: string }>("/api/crm/campanhas", { method: "POST", body: JSON.stringify({ acao, id }) });
      setMsg(j.detalhe);
      setFeitas(new Set([...feitas, id]));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro");
    }
  };
  return (
    <section className="card">
      <h2>Indique uma amiga em {mes}</h2>
      {!r.ativo && <p className="muted pg-nota">Desligado. Liga em Configurar › Campanhas, escolhendo as lojas.</p>}
      {r.ativo && <p className="muted pg-nota">Vale em: {r.lojas.join(", ") || "nenhuma loja marcada"}.</p>}
      <div className="res-kpis">
        <div className="res-kpi destaque">
          <div className="k-label">Amigas que compraram</div>
          <div className="k-valor">{r.compraram}</div>
          <div className="k-sub">{r.pendentes ? `${r.pendentes} esperando a carência` : "clientes novas"}</div>
        </div>
        <div className="res-kpi">
          <div className="k-label">Vendas das amigas</div>
          <div className="k-valor">{reais(r.vendas)}</div>
          <div className="k-sub">primeira compra</div>
        </div>
        <div className="res-kpi">
          <div className="k-label">Cashback pago</div>
          <div className="k-valor">{reais(r.cashback)}</div>
          <div className="k-sub">pra quem indicou{r.recusadas ? ` · ${r.recusadas} não valeram` : ""}</div>
        </div>
      </div>
      {r.conferir.filter((i) => !feitas.has(i.id)).length > 0 && (
        <>
          <h3 className="cap-sub">Pra conferir: a venda da amiga não apareceu</h3>
          <ul className="pend-lista">
            {r.conferir
              .filter((i) => !feitas.has(i.id))
              .map((i) => (
                <li key={i.id} className="pend">
                  <div className="pend-quem">
                    <span className="pend-loja">{i.loja}</span>
                    <b>{i.amigaNome ?? "Amiga"}</b>
                    <small>{i.amigaTelefone ? formatarTelefone(i.amigaTelefone) : ""} · indicada por {i.indicadora ?? "?"}</small>
                  </div>
                  <p className="pend-texto">
                    Registrada no caixa em {dataHora(i.em)}
                    {i.valorCompra ? `, compra de ${reais(i.valorCompra)}` : ""}. A venda não apareceu na TOTVS com esse celular.
                  </p>
                  <div className="pend-tempo">
                    <button className="mini" onClick={() => resolver(i.id, "indicacao-aprovar")}>
                      Pagar cashback
                    </button>
                    <button className="mini ghost" onClick={() => resolver(i.id, "indicacao-recusar")}>
                      Recusar
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}
      {msg && <div className="cfg-resultado" role="status">{msg}</div>}
      {r.ultimas.length > 0 && (
        <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Últimas indicações" style={{ marginTop: 12 }}>
          <table className="prod-tbl res-tbl">
            <thead>
              <tr>
                <th scope="col">Amiga</th>
                <th scope="col">Indicada por</th>
                <th scope="col" className="n">Compra</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {r.ultimas.map((i) => (
                <tr key={i.id}>
                  <th scope="row">
                    {i.amigaNome ?? "Amiga"}
                    <small>
                      {i.loja} · {dataBr(i.em.slice(0, 10))}
                    </small>
                  </th>
                  <td>{i.indicadora ?? "–"}</td>
                  <td className="n">{i.valorCompra ? reais(i.valorCompra) : "–"}</td>
                  <td>
                    {ROTULO_IND[i.status]}
                    {i.motivo && i.status !== "creditada" ? <small>{i.motivo}</small> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
