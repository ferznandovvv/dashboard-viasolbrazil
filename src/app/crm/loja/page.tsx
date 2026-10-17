"use client";

import { useCallback, useEffect, useState } from "react";

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
  rankingCelular: { loja: string; pct: number; vendas: number }[];
  rankingResposta: { loja: string; mediana: number; rapidas: number | null }[];
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
  vendedoras?: { nome: string; vendido: number; vendas: number; ticket: number; hoje: number; comCelular: number; pctCelular: number | null }[];
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
      .then((r) => setLojas(r.lojas))
      .catch((e) => setErro(e.message));
  }, [pronto, buscar]);

  useEffect(() => {
    if (!pronto || !loja) return;
    const carregar = () =>
      buscar<Painel>(`/api/crm/loja?painel=${encodeURIComponent(loja)}`)
        .then((x) => {
          setP(x);
          setErro("");
        })
        .catch((e) => setErro(e.message));
    carregar();
    const t = setInterval(carregar, 60000);
    return () => clearInterval(t);
  }, [pronto, loja, buscar]);

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
          <select className="fin-select" value={loja} onChange={(e) => escolher(e.target.value)} aria-label="Trocar loja">
            {lojas.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
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
  const c = p.celular;
  const delta = c.pct30 !== null && c.pctAnterior !== null ? c.pct30 - c.pctAnterior : null;
  const maxDia = Math.max(1, ...a.dias.map((d) => d.conversas));
  const posCel = p.rankingCelular.findIndex((r) => r.loja === p.loja) + 1;
  const posResp = p.rankingResposta.findIndex((r) => r.loja === p.loja) + 1;
  const maxResp = Math.max(1, ...p.rankingResposta.map((r) => r.mediana));

  return (
    <>
      {p.esperandoLista.length > 0 && (
        <section className="lp-espera">
          <h2>
            {p.esperandoLista.length === 1 ? "1 cliente esperando resposta" : `${p.esperandoLista.length} clientes esperando resposta`}
          </h2>
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

      <BlocoVendas v={p.vendas} loja={p.loja} />

      {p.whatsapp.ativo ? (
        <section className="lp-numeros">
          <div className="lp-num">
            <span className="lp-num-v">{a.conversasHoje}</span>
            <span className="lp-num-r">{a.conversasHoje === 1 ? "cliente chamou hoje" : "clientes chamaram hoje"}</span>
          </div>
          <div className={`lp-num ${a.esperando ? (a.maiorEsperaMin > 60 ? "ruim" : "medio") : "bom"}`}>
            <span className="lp-num-v">{a.esperando}</span>
            <span className="lp-num-r">{a.esperando ? `esperando, a mais antiga há ${minutos(a.maiorEsperaMin)}` : "esperando resposta agora"}</span>
          </div>
          <div className={`lp-num ${a.mediana7d !== null ? (a.mediana7d > 15 ? "medio" : "bom") : ""}`}>
            <span className="lp-num-v">{minutos(a.mediana7d)}</span>
            <span className="lp-num-r">pra responder, nos últimos 7 dias{a.rapidas7d !== null ? `. ${a.rapidas7d}% respondidas em até 15 min` : ""}</span>
          </div>
          <div className={`lp-num ${p.whatsapp.conectado === false ? "ruim" : ""}`}>
            <span className="lp-num-v lp-num-txt">{p.whatsapp.conectado === false ? "Desconectado" : "Conectado"}</span>
            <span className="lp-num-r">{p.whatsapp.conectado === false ? "o WhatsApp da loja caiu; avise o Fernando" : "WhatsApp da loja"}</span>
          </div>
        </section>
      ) : (
        <section className="card lp-aviso">O WhatsApp da loja ainda não está ligado ao painel. Quando estiver, aqui aparecem as conversas e o tempo de resposta.</section>
      )}

      <div className="lp-dupla">
        <section className="card">
          <h2>Celular nas vendas</h2>
          <div className="lp-cel">
            <span className="lp-cel-v">{c.pct30 === null ? "–" : `${c.pct30}%`}</span>
            <span className="lp-cel-r">
              das vendas dos últimos 30 dias saíram com o celular da cliente ({c.comCelular30} de {c.vendas30})
              {delta !== null && delta !== 0 && <b className={delta > 0 ? "bom" : "ruim"}>{delta > 0 ? `Subiu ${delta} pontos` : `Caiu ${-delta} pontos`} em relação aos 30 dias anteriores.</b>}
            </span>
          </div>
          <div className="lp-semanas" role="img" aria-label="Vendas com celular, semana a semana">
            {c.semanas.map((s, i) => (
              <div key={s.inicio} className="lp-semana" title={`Semana de ${s.inicio.slice(8, 10)}/${s.inicio.slice(5, 7)}: ${s.pct === null ? "sem vendas" : `${s.pct}% de ${s.vendas} vendas`}`}>
                <span className="lp-semana-v">{s.pct === null ? "" : `${s.pct}%`}</span>
                <span className="lp-semana-b" style={{ height: `${Math.max(s.pct ? 4 : 1, s.pct ?? 0)}%` }} />
                <span className="lp-semana-r">{i === c.semanas.length - 1 ? "esta" : `${s.inicio.slice(8, 10)}/${s.inicio.slice(5, 7)}`}</span>
              </div>
            ))}
          </div>
          <p className="muted lp-nota">
            Nesta semana, {c.novas7d === 1 ? "1 cliente nova saiu" : `${c.novas7d} clientes novas saíram`} com celular
            {c.novas7dSemCelular ? ` e ${c.novas7dSemCelular} sem` : ""}.
          </p>
        </section>

        <section className="card">
          <h2>Conversas por dia</h2>
          {!p.whatsapp.ativo ? (
            <p className="muted">Aparece quando o WhatsApp da loja estiver ligado.</p>
          ) : (
            <div className="lp-dias" role="img" aria-label="Clientes que chamaram por dia, últimos 7 dias">
              {a.dias.map((d) => (
                <div key={d.dia} className="lp-dia">
                  <span className="lp-dia-v">{d.conversas || ""}</span>
                  <span className="lp-dia-b" style={{ height: `${Math.max(d.conversas ? 4 : 1, (d.conversas / maxDia) * 100)}%` }} />
                  <span className="lp-dia-r">{DIAS[new Date(`${d.dia}T12:00:00`).getDay()]}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="lp-dupla">
        <section className="card">
          <div className="lp-rank-cab">
            <h2>Ranking: celular nas vendas</h2>
            {posCel > 0 && <span className="lp-pos">{posCel}º de {p.rankingCelular.length}</span>}
          </div>
          {p.rankingCelular.map((r, i) => (
            <div key={r.loja} className={`lp-rank ${r.loja === p.loja ? "eu" : ""}`}>
              <span className="lp-rank-pos">{i + 1}</span>
              <span className="lp-rank-nome">{r.loja}</span>
              <span className="lp-rank-linha">
                <i style={{ width: `${r.pct}%` }} />
              </span>
              <span className="lp-rank-v">{r.pct}%</span>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="lp-rank-cab">
            <h2>Ranking: tempo de resposta</h2>
            {posResp > 0 && <span className="lp-pos">{posResp}º de {p.rankingResposta.length}</span>}
          </div>
          {!p.rankingResposta.length ? (
            <p className="muted">Aparece quando os WhatsApps das lojas estiverem ligados ao painel.</p>
          ) : (
            p.rankingResposta.map((r, i) => (
              <div key={r.loja} className={`lp-rank ${r.loja === p.loja ? "eu" : ""}`}>
                <span className="lp-rank-pos">{i + 1}</span>
                <span className="lp-rank-nome">{r.loja}</span>
                <span className="lp-rank-linha lento">
                  <i style={{ width: `${(r.mediana / maxResp) * 100}%` }} />
                </span>
                <span className="lp-rank-v">{minutos(r.mediana)}</span>
              </div>
            ))
          )}
          <p className="muted lp-nota">Mediana dos últimos 7 dias, só no horário de cada loja. Quem responde mais rápido fica em cima.</p>
        </section>
      </div>

      <Vendedoras v={p.vendas} />

      <Produtos loja={p.loja} buscar={buscar} />

      <section className="card lp-porque">
        <h2>Por que pedir o celular</h2>
        <div className="lp-porque-grade">
          <p>Com o celular, a compra vira cashback no nome da cliente e ela recebe uma mensagem da loja lembrando de voltar. Sem ele, a venda sai como consumidor final e a cliente some.</p>
          <p>
            Na hora de fechar: <b>&quot;Me passa seu celular que eu já deixo seu cashback guardado no seu nome?&quot;</b> E aproveita pra pedir o aniversário.
          </p>
          <p>Cadastra direto no PDV, com DDD. É o que conta pro número lá em cima.</p>
        </div>
      </section>
    </>
  );
}

function BlocoVendas({ v, loja }: { v: Vendas; loja: string }) {
  if (!v.configurado) return null;
  const pos = (v.rankingMeta ?? []).findIndex((r) => r.loja === loja) + 1;
  const pct = v.pct ?? null;
  return (
    <section className="lp-vendas">
      <div className="card lp-vendas-mes">
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
        ) : (
          <p className="muted lp-nota">Sem meta cadastrada pra loja.</p>
        )}
        <div className="lp-vendas-mini">
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
        </div>
      </div>
      <div className="card">
        <div className="lp-rank-cab">
          <h2>Ranking: meta do mês</h2>
          {pos > 0 && <span className="lp-pos">{pos}º de {v.rankingMeta?.length}</span>}
        </div>
        {(v.rankingMeta ?? []).map((r, i) => (
          <div key={r.loja} className={`lp-rank ${r.loja === loja ? "eu" : ""}`}>
            <span className="lp-rank-pos">{i + 1}</span>
            <span className="lp-rank-nome">{r.loja}</span>
            <span className="lp-rank-linha">
              <i style={{ width: `${Math.min(100, r.pct ?? 0)}%` }} />
            </span>
            <span className="lp-rank-v">{r.pct === null ? "–" : `${r.pct}%`}</span>
          </div>
        ))}
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
              <th style={{ width: "30%" }}>Vendido no mês</th>
              <th className="n">Vendas</th>
              <th className="n">Ticket</th>
              <th className="n">Hoje</th>
              <th style={{ width: "20%" }}>Com celular da cliente</th>
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

function Produtos({ loja, buscar }: { loja: string; buscar: Buscar }) {
  const [d, setD] = useState<{ produtos: { nome: string; qtd: number; receita: number }[]; incompleto: boolean } | null>(null);
  useEffect(() => {
    setD(null);
    buscar<{ produtos: { nome: string; qtd: number; receita: number }[]; incompleto: boolean }>(`/api/crm/loja?produtos=${encodeURIComponent(loja)}`)
      .then(setD)
      .catch(() => setD({ produtos: [], incompleto: true }));
  }, [loja, buscar]);
  const max = Math.max(1, ...(d?.produtos ?? []).map((x) => x.qtd));
  return (
    <section className="card">
      <h2>O que mais vendeu nos últimos 30 dias</h2>
      {!d ? (
        <p className="muted">Buscando os produtos…</p>
      ) : !d.produtos.length ? (
        <p className="muted">{d.incompleto ? "Ainda juntando as vendas por produto. Atualize em alguns minutos." : "Sem vendas por produto no período."}</p>
      ) : (
        <>
          <ol className="lp-prod">
            {d.produtos.map((x) => (
              <li key={x.nome}>
                <span className="lp-prod-nome">{x.nome}</span>
                <span className="lp-rank-linha marca">
                  <i style={{ width: `${(x.qtd / max) * 100}%` }} />
                </span>
                <span className="lp-prod-q">{x.qtd} pç</span>
                <span className="lp-prod-r">{reais(x.receita)}</span>
              </li>
            ))}
          </ol>
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
    <div className="crm-fundo" onClick={fechar}>
      <div className="crm-janela" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Usar cashback">
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
