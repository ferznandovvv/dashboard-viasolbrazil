"use client";

import { useEffect, useRef, useState } from "react";

interface Ficha {
  id: string;
  nome: string;
  telefone: string;
  nascimento?: string;
  optIn: boolean;
  optOut?: boolean;
  saldo: number;
  compras: number;
  totalGasto: number;
  ultimaCompra?: string;
  creditos: { valor: number; validade: string }[];
  resgateMinimo: number;
  maxPctDaCompra: number;
  multiploCompra: number;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const lerValor = (t: string) => {
  const s = t.trim().replace(/[R$\s]/g, "");
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0;
};

/**
 * Tela do caixa, no celular ou tablet da loja: cadastrar a cliente na hora,
 * consultar o saldo de cashback e registrar o resgate. Entra com o mesmo
 * código da tela de metas (?k=) e a loja pela URL (?loja=).
 */
export default function CaixaCrm() {
  const [k, setK] = useState("");
  const [loja, setLoja] = useState("");
  const [lojas, setLojas] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<Ficha[] | null>(null);
  const [sel, setSel] = useState<Ficha | null>(null);
  const [tela, setTela] = useState<"busca" | "cadastro" | "resgate" | "oferta">("busca");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const busca = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setK(p.get("k") ?? "");
    setLoja(p.get("loja") ?? localStorage.getItem("crm_loja") ?? "");
  }, []);

  const api = async <T,>(url: string, corpo?: object): Promise<T> => {
    const sep = url.includes("?") ? "&" : "?";
    const r = await fetch(`${url}${sep}k=${encodeURIComponent(k)}`, {
      method: corpo ? "POST" : "GET",
      headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { erro?: string }).erro ?? `Erro ${r.status}`);
    return j as T;
  };

  useEffect(() => {
    if (!k && lojas.length) return;
    api<{ lojas: string[] }>("/api/crm/loja")
      .then((r) => setLojas(r.lojas))
      .catch((e) => setErro(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);

  useEffect(() => {
    if (!q.trim()) {
      setLista(null);
      return;
    }
    const t = setTimeout(() => {
      api<{ clientes: Ficha[] }>(`/api/crm/loja?q=${encodeURIComponent(q)}`)
        .then((r) => setLista(r.clientes))
        .catch((e) => setErro(e.message));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const escolherLoja = (l: string) => {
    setLoja(l);
    localStorage.setItem("crm_loja", l);
  };

  const recarregarSel = async () => {
    if (!sel) return;
    const r = await api<{ clientes: Ficha[] }>(`/api/crm/loja?q=${encodeURIComponent(sel.telefone || sel.nome)}`);
    const f = r.clientes.find((c) => c.id === sel.id);
    if (f) setSel(f);
  };

  if (!loja) {
    return (
      <main className="tela-loja crm-caixa">
        <h1 className="crm-caixa-titulo">Qual loja é esta?</h1>
        {erro && <div className="login-error">{erro}</div>}
        <div className="crm-caixa-lojas">
          {lojas.map((l) => (
            <button key={l} className="crm-btn" onClick={() => escolherLoja(l)}>
              {l}
            </button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="tela-loja crm-caixa">
      <div className="crm-caixa-cab">
        <div>
          <div className="muted">Via Sol · cashback</div>
          <h1 className="crm-caixa-titulo">{loja}</h1>
        </div>
        <button className="link" onClick={() => escolherLoja("")}>trocar loja</button>
      </div>

      {tela === "busca" && (
        <>
          <input
            ref={busca}
            className="crm-caixa-busca"
            placeholder="Celular, CPF ou nome da cliente"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(null);
              setAviso("");
            }}
            inputMode="search"
            autoFocus
          />
          {erro && <div className="login-error">{erro}</div>}
          {aviso && <div className="crm-aviso">{aviso}</div>}

          {!sel && lista && (
            <div className="crm-caixa-lista">
              {lista.map((c) => (
                <button key={c.id} className="crm-caixa-item" onClick={() => setSel(c)}>
                  <span>
                    <b>{c.nome}</b>
                    <small>{c.telefone || "sem telefone"}</small>
                  </span>
                  <span className="crm-caixa-saldo">{c.saldo ? brl.format(c.saldo) : ""}</span>
                </button>
              ))}
              {!lista.length && <div className="muted" style={{ padding: 12 }}>Não achei. Cadastre abaixo.</div>}
            </div>
          )}

          {!sel && (
            <>
              <button className="crm-btn grande" onClick={() => { setTela("cadastro"); setErro(""); }}>
                + Cadastrar cliente nova
              </button>
              <button className="crm-btn grande ghost" onClick={() => { setTela("oferta"); setErro(""); }}>
                Cliente trouxe um código de oferta
              </button>
            </>
          )}

          {sel && (
            <div className="crm-caixa-ficha">
              <div className="crm-caixa-nome">{sel.nome}</div>
              <div className="muted">
                {sel.telefone}
                {sel.nascimento && <> · aniversário {dataBr(sel.nascimento).slice(0, 5)}</>}
                {sel.optOut && <> · pediu para não receber mensagens</>}
              </div>
              <div className="crm-caixa-grande">{brl.format(sel.saldo)}</div>
              <div className="muted">
                {sel.creditos.length ? sel.creditos.map((c) => `${brl.format(c.valor)} até ${dataBr(c.validade)}`).join(" · ") : "sem cashback disponível"}
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                {sel.compras} compras · {brl.format(sel.totalGasto)}{sel.ultimaCompra && <> · última {dataBr(sel.ultimaCompra)}</>}
              </div>
              <div className="crm-caixa-acoes">
                <button className="crm-btn" disabled={sel.saldo < sel.resgateMinimo} onClick={() => { setTela("resgate"); setErro(""); }}>
                  Usar cashback
                </button>
                <button className="crm-btn ghost" onClick={() => { setSel(null); setQ(""); busca.current?.focus(); }}>
                  Outra cliente
                </button>
              </div>
              {sel.saldo > 0 && sel.saldo < sel.resgateMinimo && <div className="muted">Resgate liberado a partir de {brl.format(sel.resgateMinimo)}.</div>}
            </div>
          )}
        </>
      )}

      {tela === "cadastro" && (
        <Cadastro
          loja={loja}
          nomeInicial={/\d/.test(q) ? "" : q}
          telInicial={/\d/.test(q) ? q : ""}
          cancelar={() => setTela("busca")}
          salvar={async (d) => {
            setErro("");
            try {
              const r = await api<{ cliente: Ficha; nova: boolean; boasVindas: boolean }>("/api/crm/loja", { acao: "cadastrar", ...d, loja });
              setSel(r.cliente);
              setQ(r.cliente.telefone);
              setTela("busca");
              setAviso(r.nova ? (r.boasVindas ? "Cadastrada! A mensagem de boas-vindas vai sair pelo WhatsApp da loja." : "Cadastrada!") : "Essa cliente já existia; completei o cadastro.");
            } catch (e) {
              setErro(e instanceof Error ? e.message : "Erro");
            }
          }}
          erro={erro}
        />
      )}

      {tela === "oferta" && (
        <Oferta
          loja={loja}
          cancelar={() => setTela("busca")}
          erro={erro}
          confirmar={async (codigo, valorCompra) => {
            setErro("");
            try {
              const r = await api<{ codigo: { oferta: string; campanha?: string }; cliente: Ficha }>("/api/crm/loja", { acao: "usar-oferta", codigo, loja, valorCompra });
              setSel(r.cliente);
              setQ(r.cliente.telefone || r.cliente.nome);
              setTela("busca");
              setAviso(`Código válido: ${r.codigo.oferta} para ${r.cliente.nome}. Aplique na venda; o código já foi dado como usado.`);
            } catch (e) {
              setErro(e instanceof Error ? e.message : "Erro");
            }
          }}
        />
      )}

      {tela === "resgate" && sel && (
        <Resgate
          f={sel}
          cancelar={() => setTela("busca")}
          erro={erro}
          confirmar={async (valor, valorCompra, codigo) => {
            setErro("");
            try {
              await api("/api/crm/loja", { acao: "resgatar", clienteId: sel.id, valor, valorCompra, loja, codigo });
              await recarregarSel();
              setTela("busca");
              setAviso(`Resgate de ${brl.format(valor)} registrado. Aplique o desconto na venda.`);
            } catch (e) {
              setErro(e instanceof Error ? e.message : "Erro");
            }
          }}
        />
      )}
    </main>
  );
}

function Cadastro({ loja, nomeInicial, telInicial, salvar, cancelar, erro }: { loja: string; nomeInicial: string; telInicial: string; salvar: (d: { nome: string; telefone: string; nascimento?: string; cpf?: string; optIn: boolean }) => Promise<void>; cancelar: () => void; erro: string }) {
  const [nome, setNome] = useState(nomeInicial);
  const [tel, setTel] = useState(telInicial);
  const [nasc, setNasc] = useState("");
  const [cpf, setCpf] = useState("");
  const [optIn, setOptIn] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  return (
    <div className="crm-caixa-ficha">
      <div className="crm-caixa-nome">Cadastro na {loja}</div>
      <label className="crm-campo"><span>Nome</span><input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus /></label>
      <label className="crm-campo"><span>Celular (WhatsApp)</span><input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" placeholder="(16) 99999-8888" /></label>
      <label className="crm-campo"><span>Aniversário</span><input type="date" value={nasc} onChange={(e) => setNasc(e.target.value)} /></label>
      <label className="crm-campo"><span>CPF (opcional, ajuda a ligar com as notas)</span><input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" /></label>
      <label className="fin-check crm-aceite">
        <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
        A cliente aceita receber mensagens da Via Sol no WhatsApp (cashback, aniversário, novidades). Ela pode sair quando quiser respondendo SAIR.
      </label>
      {erro && <div className="login-error">{erro}</div>}
      <div className="crm-caixa-acoes">
        <button className="crm-btn" disabled={ocupado || !nome.trim() || !tel.trim()} onClick={async () => { setOcupado(true); await salvar({ nome, telefone: tel, nascimento: nasc || undefined, cpf: cpf || undefined, optIn }); setOcupado(false); }}>
          Salvar
        </button>
        <button className="crm-btn ghost" onClick={cancelar}>Voltar</button>
      </div>
    </div>
  );
}

function Oferta({ loja, confirmar, cancelar, erro }: { loja: string; confirmar: (codigo: string, valorCompra?: number) => Promise<void>; cancelar: () => void; erro: string }) {
  const [codigo, setCodigo] = useState("");
  const [compra, setCompra] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <div className="crm-caixa-ficha">
      <div className="crm-caixa-nome">Código de oferta na {loja}</div>
      <div className="muted">Aniversário, reativação e campanhas mandam um código de 6 letras. Digite aqui pra conferir e dar baixa.</div>
      <label className="crm-campo"><span>Código</span><input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} autoFocus autoCapitalize="characters" /></label>
      <label className="crm-campo"><span>Valor da compra (ajuda a medir a campanha)</span><input value={compra} onChange={(e) => setCompra(e.target.value)} inputMode="decimal" placeholder="opcional" /></label>
      {erro && <div className="login-error">{erro}</div>}
      <div className="crm-caixa-acoes">
        <button className="crm-btn" disabled={ocupado || codigo.trim().length < 6} onClick={async () => { setOcupado(true); await confirmar(codigo.trim(), lerValor(compra) || undefined); setOcupado(false); }}>
          Conferir e usar
        </button>
        <button className="crm-btn ghost" onClick={cancelar}>Voltar</button>
      </div>
    </div>
  );
}

function Resgate({ f, confirmar, cancelar, erro }: { f: Ficha; confirmar: (valor: number, valorCompra: number | undefined, codigo: string | undefined) => Promise<void>; cancelar: () => void; erro: string }) {
  const [compra, setCompra] = useState("");
  const [valor, setValor] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const vCompra = lerValor(compra);
  const teto = vCompra ? (f.multiploCompra > 0 ? Math.floor((vCompra / f.multiploCompra) * 100) / 100 : f.maxPctDaCompra ? Math.round(vCompra * f.maxPctDaCompra) / 100 : f.saldo) : f.saldo;
  const maximo = Math.min(f.saldo, teto);
  useEffect(() => {
    if (vCompra) setValor(maximo.toFixed(2).replace(".", ","));
  }, [vCompra, maximo]);
  return (
    <div className="crm-caixa-ficha">
      <div className="crm-caixa-nome">{f.nome}</div>
      <div className="muted">Saldo {brl.format(f.saldo)}</div>
      <label className="crm-campo"><span>Valor da compra</span><input value={compra} onChange={(e) => setCompra(e.target.value)} inputMode="decimal" placeholder="0,00" autoFocus /></label>
      <label className="crm-campo">
        <span>Quanto de cashback usar {f.multiploCompra > 0 ? `(a compra precisa ser ${f.multiploCompra}x o valor usado)` : f.maxPctDaCompra ? `(até ${f.maxPctDaCompra}% da compra)` : ""}</span>
        <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" />
      </label>
      <label className="crm-campo"><span>Código da cliente (se ela trouxe um)</span><input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="opcional" /></label>
      {erro && <div className="login-error">{erro}</div>}
      <div className="crm-caixa-acoes">
        <button className="crm-btn" disabled={ocupado || lerValor(valor) <= 0} onClick={async () => { setOcupado(true); await confirmar(lerValor(valor), vCompra || undefined, codigo || undefined); setOcupado(false); }}>
          Confirmar {lerValor(valor) ? brl.format(lerValor(valor)) : ""}
        </button>
        <button className="crm-btn ghost" onClick={cancelar}>Voltar</button>
      </div>
      <div className="muted" style={{ marginTop: 10 }}>Depois de confirmar, aplique esse valor como desconto na venda do TOTVS.</div>
    </div>
  );
}
