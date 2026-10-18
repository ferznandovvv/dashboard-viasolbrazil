"use client";

import { useCallback, useEffect, useState } from "react";
import { MetasVendedoras } from "@/components/MetasVendedoras";

interface Painel {
  loja: string;
  atualizado: string;
  modoSombra: boolean;
  whatsapp: { ativo: boolean; conectado: boolean | null };
  atendimento: {
    conversasHoje: number;
    msgsHoje: number;
    esperando: number;
    maiorEsperaMin: number;
    medianaHoje: number | null;
    mediana7d: number | null;
    rapidas7d: number | null;
    dias: { dia: string; conversas: number }[];
  };
  esperandoLista: { nome?: string; cadastrada: boolean; telefone: string; esperando: number; texto?: string }[];
  celular: {
    vendas30: number;
    comCelular30: number;
    pct30: number | null;
    pctAnterior: number | null;
    novas7d: number;
    novas7dSemCelular: number;
    semanas: { inicio: string; pct: number | null; vendas: number }[];
    clientes: number;
    pctBase: number | null;
  };
  atendidas: { hoje: number; semana: number; mes: number };
  peloWhats: {
    vendas: number;
    valor: number;
    pctVendas: number | null;
    pctValor: number | null;
    comEntrega: boolean;
    lista: { cliente: string; data: string; valor: number; vendedora?: string; motivo: string }[];
  };
  vendas: Vendas;
  semBaixa: { cliente: string; data: string; desconto?: number; vendedora?: string }[];
}

interface Vendas {
  configurado: boolean;
  erro?: string;
  mes?: string;
  vendido?: number;
  meta?: number;
  pct?: number | null;
  hoje?: number;
  vendas?: number;
  ticket?: number;
  diasRestantes?: number;
  porDia?: number;
  rankingMeta?: { loja: string; pct: number | null; vendido: number }[];
  vendedoras?: { nome: string; vendido: number; vendas: number; ticket: number; hoje: number; comCelular: number; pctCelular: number | null; peloWhats: number }[];
  semVendedora?: number;
}

interface FichaCashback {
  id: string;
  nome: string;
  telefone: string;
  saldo: number;
  creditos: { valor: number; validade: string }[];
  multiploCompra: number;
  maxPctDaCompra: number;
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: v >= 1000 ? 0 : 2 });
const lerValor = (t: string) => {
  const s = t.trim().replace(/[R$\s]/g, "");
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0;
};

const minutos = (m: number | null | undefined) => (m === null || m === undefined ? "–" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`);
const zap = (tel: string) => `https://wa.me/55${tel.replace(/\D/g, "")}`;
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const nomeCurto = (nome: string) =>
  nome
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ");

/**
 * Painel da loja, pra gerente e vendedoras: como está o atendimento no
 * WhatsApp, quantas vendas saíram com o celular da cliente e em que lugar a
 * loja está entre as outras. Entra com o código da TV (?k=) e a loja (?loja=).
 */
export default function PainelDaLoja() {
  const [k, setK] = useState("");
  const [loja, setLoja] = useState("");
  const [lojas, setLojas] = useState<string[]>([]);
  const [p, setP] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");
  const [pronto, setPronto] = useState(false);
  const [cashback, setCashback] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setK(q.get("k") ?? "");
    let salva = "";
    try {
      salva = localStorage.getItem("crm_loja") ?? "";
    } catch {
      /* sem armazenamento */
    }
    setLoja(q.get("loja") ?? salva);
    setPronto(true);
  }, []);

  const buscar = useCallback(
    async <T,>(url: string, corpo?: object): Promise<T> => {
      const sep = url.includes("?") ? "&" : "?";
      const r = await fetch(`${url}${sep}k=${encodeURIComponent(k)}`, {
        cache: "no-store",
        method: corpo ? "POST" : "GET",
        headers: corpo ? { "Content-Type": "application/json" } : undefined,
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { erro?: string }).erro ?? `Erro ${r.status}`);
      return j as T;
    },
    [k]
  );

  useEffect(() => {
    if (!pronto) return;
    buscar<{ lojas: string[] }>("/api/crm/loja")
      .then((r) => {
        setLojas(r.lojas);
        // Usuário de loja (uma loja só): vai direto nela; loja guardada que não vale mais sai
        setLoja((atual) => (r.lojas.length === 1 ? r.lojas[0] : r.lojas.includes(atual) ? atual : ""));
      })
      .catch((e) => setErro(e.message));
  }, [pronto, buscar]);

  useEffect(() => {
    if (!pronto || !loja || !lojas.includes(loja)) return;
    const carregar = () =>
      buscar<Painel>(`/api/crm/loja?painel=${encodeURIComponent(loja)}${document.visibilityState === "visible" ? "&visivel=1" : ""}`)
        .then((x) => {
          setP(x);
          setErro("");
        })
        .catch((e) => setErro(e.message));
    carregar();
    const t = setInterval(carregar, 60000);
    // Voltou pra aba: atualiza na hora
    const aoVoltar = () => document.visibilityState === "visible" && carregar();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [pronto, loja, lojas, buscar]);

  const escolher = (l: string) => {
    setP(null);
    setLoja(l);
    try {
      if (l) localStorage.setItem("crm_loja", l);
      else localStorage.removeItem("crm_loja");
    } catch {
      /* sem armazenamento */
    }
  };

  if (!loja)
    return (
      <main className="wrap lp">
        <h1 className="lp-titulo">Qual loja?</h1>
        {erro && <div className="login-error">{erro}</div>}
        <div className="lp-escolha">
          {lojas.map((l) => (
            <button key={l} onClick={() => escolher(l)}>
              {l}
            </button>
          ))}
        </div>
      </main>
    );

  return (
    <main className="wrap lp">
      <header className="lp-cab">
        <div>
          <span className="lp-marca">Via Sol</span>
          <h1 className="lp-titulo">{loja}</h1>
        </div>
        <div className="lp-cab-dir">
          {p && (
            <button className="crm-btn lp-btn-cashback" onClick={() => setCashback(true)}>
              Cliente veio usar o cashback
            </button>
          )}
          {lojas.length > 1 && (
            <select className="fin-select" value={loja} onChange={(e) => escolher(e.target.value)} aria-label="Trocar loja">
              {lojas.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          )}
          {p && <span className="muted">atualizado às {new Date(p.atualizado).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
      </header>

      {erro && <div className="login-error">{erro}</div>}
      {!p ? (
        <div className="empty">Carregando…</div>
      ) : (
        <Conteudo p={p} buscar={buscar} />
      )}
      {cashback && p && <UsarCashback loja={loja} buscar={buscar} fechar={() => setCashback(false)} />}
    </main>
  );
}

type Buscar = <T>(url: string, corpo?: object) => Promise<T>;

function Conteudo({ p, buscar }: { p: Painel; buscar: Buscar }) {
  const a = p.atendimento;
  const maxDia = Math.max(1, ...a.dias.map((d) => d.conversas));

  return (
    <>
      {p.esperandoLista.length > 0 && (
        <section className="lp-espera">
          <h2>{p.esperandoLista.length === 1 ? "1 cliente esperando resposta" : `${p.esperandoLista.length} clientes esperando resposta`}</h2>
          <div className="lp-espera-lista">
            {p.esperandoLista.map((x, i) => {
              const corpo = (
                <>
                  <span>
                    <b>{x.nome ? nomeCurto(x.nome) : x.telefone || "Contato sem número visível"}</b>
                    <small>
                      {x.nome && x.telefone ? `${x.telefone} · ` : ""}
                      {x.texto ? `"${x.texto.slice(0, 70)}"` : ""}
                    </small>
                  </span>
                  <span className="lp-espera-tempo">há {minutos(x.esperando)}</span>
                </>
              );
              return x.telefone ? (
                <a key={i} href={zap(x.telefone)} target="_blank" rel="noreferrer" className={`lp-espera-item ${x.esperando > 60 ? "urgente" : ""}`}>
                  {corpo}
                </a>
              ) : (
                <div key={i} className={`lp-espera-item ${x.esperando > 60 ? "urgente" : ""}`}>
                  {corpo}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {p.semBaixa.length > 0 && (
        <section className="lp-semBaixa">
          <h2>{p.semBaixa.length === 1 ? "1 desconto sem baixa no cashback" : `${p.semBaixa.length} descontos sem baixa no cashback`}</h2>
          <p>Essas clientes tinham cashback e a nota saiu com desconto, mas ninguém deu baixa aqui. Se o desconto foi o cashback, dê baixa agora pelo botão lá em cima; senão o mesmo cashback pode ser usado de novo.</p>
          <div className="lp-espera-lista">
            {p.semBaixa.map((x, i) => (
              <div key={i} className="lp-espera-item">
                <span>
                  <b>{nomeCurto(x.cliente)}</b>
                  <small>
                    {new Date(x.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    {x.vendedora ? ` · ${nomeCurto(x.vendedora)}` : ""}
                  </small>
                </span>
                <span className="lp-espera-tempo">{x.desconto ? reais(x.desconto) : ""}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="lp-bloco">
        <h2 className="lp-bloco-titulo">WhatsApp da loja</h2>
        {!p.whatsapp.ativo ? (
          <div className="card lp-aviso">O WhatsApp da loja ainda não está ligado ao painel. Quando estiver, aqui aparecem as clientes atendidas, quem está esperando e o tempo de resposta.</div>
        ) : (
          <div className="lp-whats">
            <div className="lp-numeros lp-numeros-3">
              <div className={`lp-num ${a.esperando ? (a.maiorEsperaMin > 60 ? "ruim" : "medio") : "bom"}`}>
                <span className="lp-num-v">{a.esperando}</span>
                <span className="lp-num-r">{a.esperando ? `esperando resposta, a mais antiga há ${minutos(a.maiorEsperaMin)}` : "ninguém esperando resposta"}</span>
              </div>
              <div className={`lp-num ${a.mediana7d !== null ? (a.mediana7d > 15 ? "medio" : "bom") : ""}`}>
                <span className="lp-num-v">{minutos(a.mediana7d)}</span>
                <span className="lp-num-r">pra responder, nos últimos 7 dias{a.rapidas7d !== null ? `. ${a.rapidas7d}% respondidas em até 15 min` : ""}</span>
              </div>
              <div className={`lp-num ${p.whatsapp.conectado === false ? "ruim" : ""}`}>
                <span className="lp-num-v lp-num-txt">{p.whatsapp.conectado === false ? "Desconectado" : "Conectado"}</span>
                <span className="lp-num-r">{p.whatsapp.conectado === false ? "o WhatsApp da loja caiu; avise o Fernando" : "WhatsApp da loja"}</span>
              </div>
            </div>
            <div className="card lp-atendidas">
              <div className="lp-atendidas-n">
                <div>
                  <b>{p.atendidas.hoje}</b>
                  <small>{p.atendidas.hoje === 1 ? "cliente atendida hoje" : "clientes atendidas hoje"}</small>
                </div>
                <div>
                  <b>{p.atendidas.semana}</b>
                  <small>nos últimos 7 dias</small>
                </div>
                <div>
                  <b>{p.atendidas.mes}</b>
                  <small>no mês</small>
                </div>
              </div>
              <div className="lp-dias lp-dias-baixo" role="img" aria-label="Clientes que chamaram por dia, últimos 7 dias">
                {a.dias.map((d) => (
                  <div key={d.dia} className="lp-dia">
                    <span className="lp-dia-v">{d.conversas || ""}</span>
                    <span className="lp-dia-b" style={{ height: `${Math.max(d.conversas ? 4 : 1, (d.conversas / maxDia) * 100)}%` }} />
                    <span className="lp-dia-r">{DIAS[new Date(`${d.dia}T12:00:00`).getDay()]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <VendasWhats w={p.peloWhats} mes={p.vendas.mes} ativo={p.whatsapp.ativo} />

      <BlocoVendas v={p.vendas} celular={p.celular} />

      <MetasVendedoras loja={p.loja} />

      <Vendedoras v={p.vendas} />

      <Produtos loja={p.loja} buscar={buscar} />

      <section className="card lp-porque">
        <h2>Por que pedir o celular</h2>
        <div className="lp-porque-grade">
          <p>Com o celular, a compra vira cashback no nome da cliente e ela recebe uma mensagem da loja lembrando de voltar. Sem ele, a venda sai como consumidor final e a cliente some.</p>
          <p>
            Na hora de fechar: <b>&quot;Me passa seu celular que eu já deixo seu cashback guardado no seu nome?&quot;</b> E aproveita pra pedir o aniversário.
          </p>
          <p>No PDV, pode anotar no campo de celular ou no complemento do endereço, como vocês já fazem: só o número com DDD (16 98216-5086). O painel acha nos dois.</p>
        </div>
      </section>
    </>
  );
}

function VendasWhats({ w, mes, ativo }: { w: Painel["peloWhats"]; mes?: string; ativo: boolean }) {
  return (
    <section className="card lp-pw">
      <div className="lp-pw-cab">
        <div>
          <h2>Vendas pelo WhatsApp{mes ? ` em ${mes}` : ""}</h2>
          <p className="muted lp-nota">Venda com frete de motoboy, ou de cliente que conversou com a loja no WhatsApp nos 7 dias antes de comprar.</p>
        </div>
        <div className="lp-pw-n">
          <span>
            <b>{w.vendas}</b>
            <small>{w.vendas === 1 ? "venda" : "vendas"}{w.pctVendas !== null ? `, ${w.pctVendas}% das vendas` : ""}</small>
          </span>
          <span>
            <b>{reais(w.valor)}</b>
            <small>{w.pctValor !== null ? `${w.pctValor}% do faturamento` : "faturamento"}</small>
          </span>
        </div>
      </div>
      {w.lista.length ? (
        <div className="tbl-wrap">
          <table className="prod-tbl fin-tbl">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Cliente</th>
                <th>Vendedora</th>
                <th className="n">Valor</th>
                <th>Como</th>
              </tr>
            </thead>
            <tbody>
              {w.lista.map((x, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(x.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</td>
                  <td className="fin-desc">{nomeCurto(x.cliente)}</td>
                  <td>{x.vendedora ?? ""}</td>
                  <td className="n">{reais(x.valor)}</td>
                  <td className="muted">{x.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          {!ativo && !w.comEntrega
            ? "Começa a contar quando o WhatsApp da loja estiver ligado e as notas trouxerem o frete de motoboy."
            : "Nenhuma venda pelo WhatsApp no mês ainda."}
        </p>
      )}
    </section>
  );
}

function BlocoVendas({ v, celular }: { v: Vendas; celular: Painel["celular"] }) {
  if (!v.configurado) return null;
  const pct = v.pct ?? null;
  return (
    <section className="card lp-vendas-mes">
      <h2>Vendas de {v.mes}</h2>
      <div className="lp-vendas-topo">
        <span className="lp-vendas-v">{reais(v.vendido ?? 0)}</span>
        {pct !== null && <span className={`lp-vendas-pct ${pct >= 100 ? "bom" : ""}`}>{pct}% da meta</span>}
      </div>
      {v.meta ? (
        <>
          <div className="lp-meta" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
          </div>
          <div className="lp-vendas-info">
            <span>Meta {reais(v.meta)}</span>
            {v.porDia ? (
              <span>
                Faltam <b>{reais(v.porDia)} por dia</b> nos {v.diasRestantes} dias que restam
              </span>
            ) : (
              <span className="bom">Meta batida</span>
            )}
          </div>
        </>
      ) : null}
      <div className="lp-vendas-mini lp-vendas-mini-4">
        <div>
          <b>{reais(v.hoje ?? 0)}</b>
          <small>vendido hoje</small>
        </div>
        <div>
          <b>{v.vendas ?? 0}</b>
          <small>vendas no mês</small>
        </div>
        <div>
          <b>{reais(v.ticket ?? 0)}</b>
          <small>ticket médio</small>
        </div>
        <div>
          <b>{celular.pct30 === null ? "–" : `${celular.pct30}%`}</b>
          <small>das vendas com celular da cliente (30 dias)</small>
        </div>
      </div>
    </section>
  );
}

function Vendedoras({ v }: { v: Vendas }) {
  const lista = v.vendedoras ?? [];
  if (!v.configurado || !lista.length) return null;
  const max = Math.max(1, ...lista.map((x) => x.vendido));
  return (
    <section className="card">
      <h2>Vendedoras em {v.mes}</h2>
      <div className="tbl-wrap">
        <table className="prod-tbl fin-tbl lp-tab">
          <thead>
            <tr>
              <th>Vendedora</th>
              <th style={{ width: "28%" }}>Vendido no mês</th>
              <th className="n">Vendas</th>
              <th className="n">Ticket</th>
              <th className="n">Hoje</th>
              <th className="n">Pelo WhatsApp</th>
              <th style={{ width: "18%" }}>Com celular da cliente</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((x) => (
              <tr key={x.nome}>
                <td className="fin-desc">{x.nome}</td>
                <td>
                  <span className="lp-barra-v">
                    <span className="lp-rank-linha marca">
                      <i style={{ width: `${(x.vendido / max) * 100}%` }} />
                    </span>
                    <em>{reais(x.vendido)}</em>
                  </span>
                </td>
                <td className="n">{x.vendas}</td>
                <td className="n">{reais(x.ticket)}</td>
                <td className="n">{x.hoje ? reais(x.hoje) : ""}</td>
                <td className="n">{x.peloWhats || ""}</td>
                <td>
                  <span className="lp-barra-v">
                    <span className="lp-rank-linha">
                      <i style={{ width: `${x.pctCelular ?? 0}%` }} />
                    </span>
                    <em>{x.pctCelular ?? 0}%</em>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.semVendedora ? <p className="muted lp-nota">{reais(v.semVendedora)} em vendas sem vendedora na nota.</p> : null}
    </section>
  );
}

type DadosProdutos = { produtos: { nome: string; qtd: number; receita: number }[]; pecas: number; receita: number; incompleto: boolean };

function Produtos({ loja, buscar }: { loja: string; buscar: Buscar }) {
  const [periodo, setPeriodo] = useState<"mes" | "7" | "30">("mes");
  const [ordem, setOrdem] = useState<"qtd" | "receita">("qtd");
  const [todos, setTodos] = useState(false);
  const [d, setD] = useState<DadosProdutos | null>(null);
  useEffect(() => {
    setD(null);
    buscar<DadosProdutos>(`/api/crm/loja?produtos=${encodeURIComponent(loja)}&periodo=${periodo}`)
      .then(setD)
      .catch(() => setD({ produtos: [], pecas: 0, receita: 0, incompleto: true }));
  }, [loja, periodo, buscar]);
  const lista = (d?.produtos ?? []).slice().sort((a, b) => (ordem === "qtd" ? b.qtd - a.qtd || b.receita - a.receita : b.receita - a.receita));
  const mostrar = todos ? lista : lista.slice(0, 12);
  const max = Math.max(1, ...mostrar.map((x) => (ordem === "qtd" ? x.qtd : x.receita)));
  return (
    <section className="card">
      <div className="lp-prod-cab">
        <h2>Produtos vendidos</h2>
        <div className="lp-prod-filtros">
          <div className="seg">
            {(
              [
                ["mes", "Este mês"],
                ["7", "7 dias"],
                ["30", "30 dias"],
              ] as const
            ).map(([k, nome]) => (
              <button key={k} className={periodo === k ? "on" : ""} onClick={() => setPeriodo(k)}>
                {nome}
              </button>
            ))}
          </div>
          <div className="seg">
            <button className={ordem === "qtd" ? "on" : ""} onClick={() => setOrdem("qtd")}>
              Por quantidade
            </button>
            <button className={ordem === "receita" ? "on" : ""} onClick={() => setOrdem("receita")}>
              Por valor
            </button>
          </div>
        </div>
      </div>
      {!d ? (
        <p className="muted">Buscando os produtos…</p>
      ) : !lista.length ? (
        <p className="muted">{d.incompleto ? "Ainda juntando as vendas por produto. Atualize em alguns minutos." : "Sem vendas por produto no período."}</p>
      ) : (
        <>
          <p className="muted lp-nota" style={{ marginTop: 0 }}>
            {d.pecas} peças, {reais(d.receita)} no período. Frete de motoboy não entra.
          </p>
          <ol className="lp-prod">
            {mostrar.map((x) => (
              <li key={x.nome}>
                <span className="lp-prod-nome">{x.nome}</span>
                <span className="lp-rank-linha marca">
                  <i style={{ width: `${((ordem === "qtd" ? x.qtd : x.receita) / max) * 100}%` }} />
                </span>
                <span className={`lp-prod-q ${ordem === "qtd" ? "forte" : ""}`}>{x.qtd} pç</span>
                <span className={`lp-prod-r ${ordem === "receita" ? "forte" : ""}`}>{reais(x.receita)}</span>
              </li>
            ))}
          </ol>
          {lista.length > 12 && (
            <button className="link" style={{ marginTop: 8 }} onClick={() => setTodos(!todos)}>
              {todos ? "mostrar menos" : `ver os ${lista.length} produtos`}
            </button>
          )}
          {d.incompleto && <p className="muted lp-nota">Ainda faltam alguns dias na conta; atualize daqui a pouco.</p>}
        </>
      )}
    </section>
  );
}

/**
 * A cliente mostra a mensagem do cashback; a vendedora confere aqui se o
 * saldo é dela e ainda vale, dá o desconto no PDV e dá baixa. A baixa é o
 * que impede usar o mesmo cashback duas vezes (ou em outra loja) e para os
 * lembretes de vencimento.
 */
function UsarCashback({ loja, buscar, fechar }: { loja: string; buscar: Buscar; fechar: () => void }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<FichaCashback[] | null>(null);
  const [sel, setSel] = useState<FichaCashback | null>(null);
  const [compra, setCompra] = useState("");
  const [usar, setUsar] = useState("");
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (q.replace(/\D/g, "").length < 8 && q.trim().length < 4) {
      setLista(null);
      return;
    }
    const t = setTimeout(() => {
      buscar<{ clientes: FichaCashback[] }>(`/api/crm/loja?q=${encodeURIComponent(q)}`)
        .then((r) => setLista(r.clientes))
        .catch((e) => setErro(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [q, buscar]);

  const valorCompra = lerValor(compra);
  const teto = sel ? (sel.multiploCompra > 0 ? valorCompra / sel.multiploCompra : sel.maxPctDaCompra > 0 ? (valorCompra * sel.maxPctDaCompra) / 100 : sel.saldo) : 0;
  const podeUsar = sel ? Math.floor(Math.min(sel.saldo, valorCompra ? teto : sel.saldo) * 100) / 100 : 0;

  return (
    <div className="crm-fundo" onClick={fechar} onKeyDown={(e) => e.key === "Escape" && fechar()}>
      <div className="crm-janela" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Usar cashback">
        <div className="fin-cab">
          <h2>Usar cashback na {loja}</h2>
          <button className="link" onClick={fechar}>
            fechar
          </button>
        </div>
        {feito ? (
          <>
            <div className="crm-aviso">{feito}</div>
            <button className="crm-btn grande" onClick={fechar}>
              Pronto
            </button>
          </>
        ) : !sel ? (
          <>
            <label className="crm-campo">
              <span>Celular ou CPF da cliente</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus inputMode="tel" placeholder="(16) 99999-8888" />
            </label>
            {lista && !lista.length && <p className="muted">Ninguém com esse celular ou CPF.</p>}
            {lista?.map((c) => (
              <button key={c.id} className="lp-cliente" onClick={() => setSel(c)}>
                <span>
                  <b>{c.nome}</b>
                  <small>{c.telefone}</small>
                </span>
                <span className={c.saldo > 0 ? "bom" : "muted"}>{c.saldo > 0 ? reais(c.saldo) : "sem saldo"}</span>
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="lp-saldo">
              <span>{sel.nome}</span>
              <b>{reais(sel.saldo)}</b>
              <small>{sel.creditos.length ? `de cashback, o primeiro vence em ${sel.creditos[0].validade.slice(8, 10)}/${sel.creditos[0].validade.slice(5, 7)}` : "sem cashback válido"}</small>
            </div>
            {sel.saldo > 0 && (
              <>
                <label className="crm-campo">
                  <span>Valor da compra</span>
                  <input value={compra} onChange={(e) => setCompra(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" autoFocus />
                </label>
                {valorCompra > 0 && (
                  <p className="lp-regra">
                    Nesta compra dá pra usar até <b>{reais(podeUsar)}</b>
                    {sel.multiploCompra > 0 && podeUsar < sel.saldo ? ` (a compra precisa ser ${sel.multiploCompra}x o cashback usado)` : ""}.
                  </p>
                )}
                <label className="crm-campo">
                  <span>Desconto dado no PDV</span>
                  <input value={usar} onChange={(e) => setUsar(e.target.value)} inputMode="decimal" placeholder={podeUsar ? reais(podeUsar) : "R$ 0,00"} />
                </label>
                {erro && <div className="login-error">{erro}</div>}
                <button
                  className="crm-btn grande"
                  disabled={ocupado || !valorCompra}
                  onClick={async () => {
                    setErro("");
                    setOcupado(true);
                    const valor = lerValor(usar) || podeUsar;
                    try {
                      const r = await buscar<{ saldo: number }>("/api/crm/loja", { acao: "resgatar", clienteId: sel.id, valor, valorCompra, loja });
                      setFeito(`Baixa de ${reais(valor)} feita. Sobrou ${reais(r.saldo)} de cashback pra ${sel.nome.split(" ")[0]}.`);
                    } catch (e) {
                      setErro(e instanceof Error ? e.message : "Erro");
                    } finally {
                      setOcupado(false);
                    }
                  }}
                >
                  Dar baixa no cashback
                </button>
              </>
            )}
            <button className="link" onClick={() => setSel(null)} style={{ marginTop: 10 }}>
              buscar outra cliente
            </button>
          </>
        )}
      </div>
    </div>
  );
}
