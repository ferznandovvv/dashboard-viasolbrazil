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
  esperandoLista: { nome?: string; telefone: string; esperando: number; texto?: string }[];
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
  vendedoras: { nome: string; vendas: number; comCelular: number; semCliente: number; pct: number | null }[];
}

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
    async <T,>(url: string): Promise<T> => {
      const sep = url.includes("?") ? "&" : "?";
      const r = await fetch(`${url}${sep}k=${encodeURIComponent(k)}`, { cache: "no-store" });
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
        <Conteudo p={p} />
      )}
    </main>
  );
}

function Conteudo({ p }: { p: Painel }) {
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
            {p.esperandoLista.map((x) => (
              <a key={x.telefone} href={zap(x.telefone)} target="_blank" rel="noreferrer" className={`lp-espera-item ${x.esperando > 60 ? "urgente" : ""}`}>
                <span>
                  <b>{x.nome ? nomeCurto(x.nome) : x.telefone}</b>
                  {x.texto && <small>&quot;{x.texto.slice(0, 70)}&quot;</small>}
                </span>
                <span className="lp-espera-tempo">há {minutos(x.esperando)}</span>
              </a>
            ))}
          </div>
        </section>
      )}

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
          <p className="muted lp-nota">Mediana dos últimos 7 dias, só no horário de atendimento. Quem responde mais rápido fica em cima.</p>
        </section>
      </div>

      <section className="card">
        <h2>Por vendedora, últimos 30 dias</h2>
        {!p.vendedoras.length ? (
          <p className="muted">Ainda sem vendas com a vendedora identificada.</p>
        ) : (
          <div className="lp-vend">
            {p.vendedoras.map((v) => (
              <div key={v.nome} className="lp-rank">
                <span className="lp-rank-nome">{nomeCurto(v.nome)}</span>
                <span className="lp-rank-linha">
                  <i style={{ width: `${v.pct ?? 0}%` }} />
                </span>
                <span className="lp-rank-v">{v.pct ?? 0}%</span>
                <span className="lp-rank-sub">
                  {v.comCelular} de {v.vendas} vendas
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

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
