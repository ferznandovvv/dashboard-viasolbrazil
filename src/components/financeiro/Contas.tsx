"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Conta, Sugestao, UsuarioPublico } from "@/lib/financeiro/tipos";
import { Agenda } from "./Agenda";
import { type Cadastros, api, brl, dataBr, hojeSp, lerValor, nomeMesLongo, valorParaCampo } from "./comum";

type ContaTela = Conta & { criadoPorNome: string; pagoPorNome: string };

interface Resposta {
  hoje: string;
  resumo: Record<"vencidas" | "hoje" | "proximos7" | "pagasMes", { qtd: number; total: number }>;
  contas: ContaTela[];
  totalLista: number;
  porEmpresa: { empresaId: string; nome: string; aPagar: number; qtd: number; vencido: number; pago: number }[];
  /** Em aberto vencendo até daqui a 7 dias (inclui as vencidas) */
  proximos: ContaTela[];
  amanha: string;
  proxima: { vencimento: string; total: number } | null;
}

type Status = "abertas" | "vencidas" | "pagas" | "todas";
type Vista = "agenda" | "lista";
type Janela = "hoje" | "amanha" | "semana";

interface Formulario {
  id?: string;
  /** conta = a pagar; pago = pagamento já feito (PIX, cartão) */
  modo: "conta" | "pago";
  descricao: string;
  fornecedor: string;
  empresaId: string;
  categoriaId: string;
  valor: string;
  data: string;
  competencia: string;
  forma: string;
  observacao: string;
  repetir: "nao" | "parcelado" | "mensal";
  vezes: string;
  /** Conta dividida entre empresas */
  dividir: boolean;
  /** Na divisão: empresa → valor digitado */
  partes: Record<string, string>;
  anexos: Conta["anexos"];
  chavePix: string;
}

const mesAtual = () => hojeSp().slice(0, 7);

/** Divisão salva → campos do formulário. */
const divisaoNoForm = (rateio?: Conta["rateio"]) => {
  const partes = (rateio ?? []).filter((p) => p.empresaId);
  return {
    dividir: partes.length > 1,
    partes: partes.length > 1 ? Object.fromEntries(partes.map((p) => [p.empresaId, valorParaCampo(p.valor)])) : {},
  };
};
const diaCurto = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
const somarDia = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Chave PIX com botão de copiar — é o que se cola no app do banco. */
function ChavePix({ chave, copiada, aoCopiar }: { chave: string; copiada: boolean; aoCopiar: () => void }) {
  return (
    <span className="fin-pix">
      PIX: <code>{chave}</code>
      <button type="button" className="link" onClick={aoCopiar}>
        {copiada ? "copiada ✓" : "copiar"}
      </button>
    </span>
  );
}

const diaExtenso = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const somarMes = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const lerVista = (): Vista => {
  try {
    return localStorage.getItem("fin-vista") === "lista" ? "lista" : "agenda";
  } catch {
    return "agenda";
  }
};

/** Contas a pagar: agenda do mês, lançar (a pagar ou já pago), dividir entre empresas e dar baixa. */
export function Contas({ cad, usuario }: { cad: Cadastros; usuario: UsuarioPublico }) {
  const empresasAtivas = cad.empresas.filter((e) => e.ativa);
  const categoriasAtivas = cad.categorias.filter((c) => c.ativa);
  const [vista, setVista] = useState<Vista>("agenda");
  const [empresa, setEmpresa] = useState("");
  const [status, setStatus] = useState<Status>("abertas");
  const [mes, setMes] = useState(mesAtual());
  const [dia, setDia] = useState("");
  const [q, setQ] = useState("");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState<Formulario | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pagando, setPagando] = useState<{ id: string; pagoEm: string; valor: string } | null>(null);
  const [reagendando, setReagendando] = useState<{ id: string; data: string } | null>(null);
  const [janela, setJanela] = useState<Janela>("hoje");
  const [copiada, setCopiada] = useState("");
  const [sugestoes, setSugestoes] = useState<{ porFornecedor: Sugestao[]; porDescricao: Sugestao[] } | null>(null);
  const [preenchido, setPreenchido] = useState("");
  const anexarEm = useRef<string>("");
  const seletor = useRef<HTMLInputElement>(null);

  useEffect(() => setVista(lerVista()), []);
  const trocarVista = (v: Vista) => {
    setVista(v);
    setDia("");
    if (v === "agenda" && !mes) setMes(mesAtual());
    try {
      localStorage.setItem("fin-vista", v);
    } catch {
      /* só conveniência */
    }
  };

  const carregar = useCallback(async () => {
    const qs = new URLSearchParams({ status, mes, empresa, q });
    try {
      setDados(await api<Resposta>(`/api/financeiro/contas?${qs}`));
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  }, [status, mes, empresa, q]);

  useEffect(() => {
    const t = setTimeout(carregar, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, q]);

  // Ao abrir um lançamento novo, busca o que já foi lançado para completar
  const abrindoNovo = !!form && !form.id;
  useEffect(() => {
    if (!abrindoNovo) return;
    api<{ porFornecedor: Sugestao[]; porDescricao: Sugestao[] }>("/api/financeiro/sugestoes")
      .then(setSugestoes)
      .catch(() => {});
  }, [abrindoNovo]);

  /**
   * Digitou um fornecedor ou uma descrição que já existe: completa o resto
   * com o último lançamento igual — só o que ainda está em branco.
   */
  const completar = (campoDigitado: "fornecedor" | "descricao", texto: string) => {
    if (!form) return;
    const novo = { ...form, [campoDigitado]: texto };
    const lista = campoDigitado === "fornecedor" ? sugestoes?.porFornecedor : sugestoes?.porDescricao;
    const s = form.id ? undefined : lista?.find((x) => x[campoDigitado].trim().toLowerCase() === texto.trim().toLowerCase());
    if (!s) {
      setForm(novo);
      return;
    }
    const empresaValida = cad.empresas.some((e) => e.id === s.empresaId && e.ativa);
    const categoriaValida = cad.categorias.some((c) => c.id === s.categoriaId && c.ativa);
    setPreenchido(`Completei com o último lançamento igual (${dataBr(s.em)}) — confira o valor.`);
    setForm({
      ...novo,
      descricao: novo.descricao || s.descricao,
      fornecedor: novo.fornecedor || s.fornecedor,
      empresaId: empresaValida ? s.empresaId : novo.empresaId,
      categoriaId: categoriaValida ? s.categoriaId : novo.categoriaId,
      // Pagamento já feito não volta a ser "Boleto" só porque a conta era boleto
      forma: form.modo === "pago" && s.forma === "Boleto" ? form.forma : s.forma || form.forma,
      valor: novo.valor || valorParaCampo(s.valor),
      ...divisaoNoForm(s.rateio),
      chavePix: form.chavePix || s.chavePix || "",
    });
  };

  /** Lançar de novo uma conta igual (outro mês, outro comprovante). */
  const copiar = (c: ContaTela) => {
    setArquivo(null);
    setPreenchido(`Copiado de "${c.descricao}" (${dataBr(c.vencimento)}): ajuste a data e o valor.`);
    setForm({
      ...novo("conta"),
      descricao: c.descricao,
      fornecedor: c.fornecedor,
      empresaId: c.empresaId,
      categoriaId: c.categoriaId,
      valor: valorParaCampo(c.valor),
      forma: c.forma,
      ...divisaoNoForm(c.rateio),
      chavePix: c.chavePix ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const nomeEmpresa = (id: string) => cad.empresas.find((e) => e.id === id)?.nome ?? "—";
  const nomeCategoria = (id: string) => cad.categorias.find((c) => c.id === id)?.nome ?? "—";

  const novo = (modo: Formulario["modo"]): Formulario => ({
    modo,
    descricao: "",
    fornecedor: "",
    empresaId: empresa || (empresasAtivas.length === 1 ? empresasAtivas[0].id : ""),
    categoriaId: "",
    valor: "",
    data: dia || hojeSp(),
    competencia: "",
    forma: modo === "pago" ? "PIX" : "Boleto",
    observacao: "",
    repetir: "nao",
    vezes: "2",
    dividir: false,
    partes: {},
    anexos: [],
    chavePix: "",
  });

  const editar = (c: ContaTela) => {
    setArquivo(null);
    setForm({
      id: c.id,
      modo: c.status === "paga" ? "pago" : "conta",
      descricao: c.descricao,
      fornecedor: c.fornecedor,
      empresaId: c.empresaId,
      categoriaId: c.categoriaId,
      valor: valorParaCampo(c.valor),
      data: c.vencimento,
      competencia: c.competencia,
      forma: c.forma,
      observacao: c.observacao,
      repetir: "nao",
      vezes: "1",
      ...divisaoNoForm(c.rateio),
      anexos: c.anexos ?? [],
      chavePix: c.chavePix ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const rateioDoForm = (f: Formulario) =>
    f.dividir
      ? Object.entries(f.partes)
          .map(([empresaId, v]) => ({ empresaId, valor: lerValor(v) }))
          .filter((p) => p.valor > 0)
      : [];

  const enviarAnexo = async (contaId: string, f: File) => {
    const corpo = new FormData();
    corpo.append("conta", contaId);
    corpo.append("arquivo", f);
    const r = await fetch("/api/financeiro/anexos", { method: "POST", body: corpo });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { erro?: string }).erro ?? "Falha ao anexar.");
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSalvando(true);
    setErro("");
    const corpo = {
      descricao: form.descricao,
      fornecedor: form.fornecedor,
      empresaId: form.empresaId,
      categoriaId: form.categoriaId,
      valor: lerValor(form.valor),
      vencimento: form.data,
      competencia: form.competencia || form.data.slice(0, 7),
      forma: form.forma,
      observacao: form.observacao,
      rateio: rateioDoForm(form),
      vezes: form.repetir === "nao" ? 1 : Number(form.vezes) || 1,
      repetir: form.repetir === "nao" ? undefined : form.repetir,
      jaPago: form.modo === "pago",
      chavePix: form.forma === "PIX" ? form.chavePix : "",
    };
    try {
      let contaId = form.id;
      if (form.id) {
        await api(`/api/financeiro/contas/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify({ acao: "editar", ...corpo }),
        });
      } else {
        const r = await api<{ ids: string[] }>("/api/financeiro/contas", { method: "POST", body: JSON.stringify(corpo) });
        contaId = r.ids[0];
        // Vai para o mês da conta lançada, para ela aparecer
        setMes(form.data.slice(0, 7));
        if (form.modo === "pago" && status === "abertas") setStatus("todas");
      }
      if (arquivo && contaId) await enviarAnexo(contaId, arquivo);
      setForm(null);
      setArquivo(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    } finally {
      setSalvando(false);
    }
  };

  const pagar = async () => {
    if (!pagando) return;
    try {
      await api(`/api/financeiro/contas/${pagando.id}`, {
        method: "PATCH",
        body: JSON.stringify({ acao: "pagar", pagoEm: pagando.pagoEm, valorPago: lerValor(pagando.valor) }),
      });
      setPagando(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  };

  const reabrir = async (c: ContaTela) => {
    if (!confirm(`Desfazer o pagamento de "${c.descricao}"?`)) return;
    await api(`/api/financeiro/contas/${c.id}`, { method: "PATCH", body: JSON.stringify({ acao: "reabrir" }) })
      .then(carregar)
      .catch((e) => setErro(e.message));
  };

  const excluir = async (c: ContaTela) => {
    let lote = false;
    if (c.lote) {
      lote = confirm(
        `"${c.descricao}" faz parte de um lançamento repetido.\n\nOK = excluir esta e as outras ainda em aberto\nCancelar = escolher só esta`
      );
      if (!lote && !confirm(`Excluir só esta conta (${dataBr(c.vencimento)})?`)) return;
    } else if (!confirm(`Excluir "${c.descricao}"?`)) return;
    await api(`/api/financeiro/contas/${c.id}${lote ? "?lote=1" : ""}`, { method: "DELETE" })
      .then(carregar)
      .catch((e) => setErro(e.message));
  };

  const anexar = (contaId: string) => {
    anexarEm.current = contaId;
    seletor.current?.click();
  };
  const aoEscolherArquivo = async (f?: File) => {
    if (!f || !anexarEm.current) return;
    try {
      await enviarAnexo(anexarEm.current, f);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    } finally {
      if (seletor.current) seletor.current.value = "";
    }
  };
  const tirarAnexo = async (id: string) => {
    if (!confirm("Tirar este anexo da conta?")) return;
    await api(`/api/financeiro/anexos/${id}`, { method: "DELETE" }).catch((e) => setErro(e.message));
    setForm((f) => (f ? { ...f, anexos: (f.anexos ?? []).filter((a) => a.id !== id) } : f));
    await carregar();
  };

  const copiarChave = async (c: ContaTela) => {
    try {
      await navigator.clipboard.writeText(c.chavePix ?? "");
    } catch {
      // Sem permissão de área de transferência (http): deixa selecionar à mão
      prompt("Copie a chave PIX:", c.chavePix ?? "");
    }
    setCopiada(c.id);
    setTimeout(() => setCopiada((x) => (x === c.id ? "" : x)), 2500);
  };

  const reagendar = async () => {
    if (!reagendando) return;
    try {
      await api(`/api/financeiro/contas/${reagendando.id}`, {
        method: "PATCH",
        body: JSON.stringify({ acao: "reagendar", vencimento: reagendando.data }),
      });
      setReagendando(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  };

  const reagendadoTexto = (c: ContaTela) => {
    const r = c.reagendamentos ?? [];
    if (!r.length) return null;
    return (
      <span className="fin-reagendado" title={r.map((x) => `${dataBr(x.de)} → ${dataBr(x.para)}`).join("\n")}>
        {" "}
        · reagendado{r.length > 1 ? ` ${r.length}x` : ""} (era {dataBr(r[0].de)})
      </span>
    );
  };

  /** Pagar e reagendar, com os campos abrindo no lugar do botão. */
  const acoesRapidas = (c: ContaTela) =>
    pagando?.id === c.id ? (
      <span className="fin-pagar">
        <input type="date" value={pagando.pagoEm} onChange={(e) => setPagando({ ...pagando, pagoEm: e.target.value })} />
        <input inputMode="decimal" value={pagando.valor} onChange={(e) => setPagando({ ...pagando, valor: e.target.value })} />
        <button className="mini" onClick={pagar}>
          Confirmar
        </button>
        <button className="mini ghost" onClick={() => setPagando(null)}>
          ✕
        </button>
      </span>
    ) : reagendando?.id === c.id ? (
      <span className="fin-pagar">
        <input type="date" value={reagendando.data} onChange={(e) => setReagendando({ ...reagendando, data: e.target.value })} />
        <button className="mini" onClick={reagendar}>
          Reagendar
        </button>
        <button className="mini ghost" onClick={() => setReagendando(null)}>
          ✕
        </button>
      </span>
    ) : (
      <span className="fin-rapidas">
        <button className="mini" onClick={() => setPagando({ id: c.id, pagoEm: hojeSp(), valor: valorParaCampo(c.valor) })}>
          Pagar
        </button>
        <button className="link" onClick={() => setReagendando({ id: c.id, data: c.vencimento })}>
          reagendar
        </button>
      </span>
    );

  const podeExcluir = (c: ContaTela) => usuario.papel === "admin" || c.criadoPor === usuario.id;
  const categoriasPorGrupo = cad.grupos
    .map((g) => ({ g, cats: categoriasAtivas.filter((c) => c.grupo === g.id) }))
    .filter((x) => x.cats.length);
  const campo = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const descreverRateio = (c: ContaTela) => {
    if (!c.rateio?.length) return "";
    if (c.rateio.length < 2) return "";
    const total = c.rateio.reduce((s, p) => s + p.valor, 0);
    return "dividida: " + c.rateio.map((p) => `${nomeEmpresa(p.empresaId)} ${Math.round((p.valor / total) * 100)}%`).join(" · ");
  };

  // Rateio na tela
  const valorForm = form ? lerValor(form.valor) : 0;
  const somaPartes = form ? Object.values(form.partes).reduce((s, v) => s + lerValor(v), 0) : 0;
  const empresasDivisao = form ? Object.keys(form.partes) : [];
  /** Abre a divisão já com a empresa da conta marcada com o valor todo */
  const abrirDivisao = () =>
    setForm((f) => (f ? { ...f, dividir: true, partes: f.empresaId ? { [f.empresaId]: f.valor } : {} } : f));
  const alternarEmpresaDivisao = (u: string) =>
    setForm((f) => {
      if (!f) return f;
      const partes = { ...f.partes };
      if (u in partes) delete partes[u];
      else partes[u] = "";
      return { ...f, partes };
    });
  /** Mudou o valor com rateio fechado: as partes acompanham na mesma proporção. */
  const trocarValor = (texto: string) =>
    setForm((f) => {
      if (!f) return f;
      const antes = lerValor(f.valor);
      const depois = lerValor(texto);
      const soma = Object.values(f.partes).reduce((s, v) => s + lerValor(v), 0);
      if (!f.dividir || !(antes > 0) || !(depois > 0) || Math.abs(soma - antes) > 0.05) return { ...f, valor: texto };
      const partes = Object.fromEntries(
        Object.entries(f.partes).map(([u, v]) => [u, valorParaCampo(Math.round((lerValor(v) / antes) * depois * 100) / 100)])
      );
      return { ...f, valor: texto, partes };
    });

  const dividirIgual = () =>
    setForm((f) => {
      if (!f) return f;
      const ids = Object.keys(f.partes);
      if (!ids.length) return f;
      const cada = Math.floor((lerValor(f.valor) / ids.length) * 100) / 100;
      const resto = Math.round((lerValor(f.valor) - cada * ids.length) * 100) / 100;
      const partes = Object.fromEntries(ids.map((u, i) => [u, valorParaCampo(i === ids.length - 1 ? cada + resto : cada)]));
      return { ...f, partes };
    });

  // Painel do dia: hoje (com as atrasadas), amanhã ou os próximos 7 dias
  const proximos = dados?.proximos ?? [];
  const hojeDia = dados?.hoje ?? "";
  const daJanela = (j: Janela) =>
    proximos.filter((c) =>
      j === "hoje" ? c.vencimento <= hojeDia : j === "amanha" ? c.vencimento === dados?.amanha : c.vencimento > hojeDia
    );
  const somaDe = (cs: ContaTela[]) => cs.reduce((s, c) => s + c.valor, 0);
  const doPainel = daJanela(janela);
  const hojeTotal = somaDe(doPainel);
  const hojeAtrasado = janela === "hoje" ? somaDe(doPainel.filter((c) => c.vencimento < hojeDia)) : 0;
  const hojePorEmpresa = cad.empresas
    .map((e) => {
      const contas = doPainel.filter((c) => c.empresaId === e.id);
      return { id: e.id, nome: e.nome, contas, total: somaDe(contas) };
    })
    .filter((g) => g.contas.length)
    .sort((a, b) => b.total - a.total);
  const contasMes = (dados?.contas ?? []).filter((c) => !mes || c.vencimento.startsWith(mes));
  const anteriores = (dados?.contas ?? []).filter((c) => mes && !c.vencimento.startsWith(mes));
  const lista = vista === "agenda" && dia ? (dados?.contas ?? []).filter((c) => c.vencimento === dia) : dados?.contas ?? [];
  const valorDe = (c: ContaTela) => (c.status === "paga" ? c.valorPago ?? c.valor : c.valor);
  const totalLista = lista.reduce((s, c) => s + valorDe(c), 0);
  // Sem filtro de empresa, a lista vem separada por empresa, com o total de cada uma
  const agrupar = !empresa && new Set(lista.map((c) => c.empresaId)).size > 1;
  const grupos = agrupar
    ? cad.empresas
        .map((e) => ({ id: e.id, nome: e.nome, contas: lista.filter((c) => c.empresaId === e.id) }))
        .filter((g) => g.contas.length)
    : [{ id: "todas", nome: "", contas: lista }];
  const colunaEmpresa = !agrupar && empresasAtivas.length > 1;
  const pago = form?.modo === "pago";

  return (
    <div>
      <input
        ref={seletor}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={(e) => aoEscolherArquivo(e.target.files?.[0])}
      />

      {!form && (
        <div className="fin-lancar">
          <button
            className="fin-lancar-btn principal"
            onClick={() => {
              setArquivo(null);
              setPreenchido("");
              setForm(novo("conta"));
            }}
          >
            <span className="fin-lancar-icone">＋</span>
            <span>
              <b>Lançar conta a pagar</b>
              <small>boleto, aluguel, fornecedor — vai para a agenda</small>
            </span>
          </button>
          <button
            className="fin-lancar-btn"
            onClick={() => {
              setArquivo(null);
              setPreenchido("");
              setForm(novo("pago"));
            }}
          >
            <span className="fin-lancar-icone">✓</span>
            <span>
              <b>Lançar pagamento já feito</b>
              <small>comprovante de PIX, cartão — entra como pago</small>
            </span>
          </button>
        </div>
      )}

      {erro && <div className="card err-msg">{erro}</div>}

      {form && (
        <form className="card fin-form" onSubmit={salvar}>
          <div className="fin-cab">
            <h2>{form.id ? "Editar" : pago ? "Lançar pagamento já feito" : "Lançar conta a pagar"}</h2>
            {!form.id && (
              <div className="seg" role="group">
                <button type="button" className={!pago ? "on" : ""} onClick={() => setForm({ ...form, modo: "conta", forma: "Boleto" })}>
                  Conta a pagar
                </button>
                <button type="button" className={pago ? "on" : ""} onClick={() => setForm({ ...form, modo: "pago", forma: "PIX" })}>
                  Já paguei
                </button>
              </div>
            )}
          </div>
          {pago && !form.id && (
            <p className="fin-sub" style={{ margin: "0 0 10px" }}>
              Comprovante de PIX, compra no cartão, transferência: entra direto como pago. Parcelado no cartão, cada parcela
              fica paga no mês dela.
            </p>
          )}
          {!form.id && sugestoes && (
            <>
              <datalist id="fin-fornecedores">
                {sugestoes.porFornecedor.map((x) => (
                  <option key={x.fornecedor} value={x.fornecedor} />
                ))}
              </datalist>
              <datalist id="fin-descricoes">
                {sugestoes.porDescricao.map((x) => (
                  <option key={x.descricao} value={x.descricao} />
                ))}
              </datalist>
            </>
          )}
          {preenchido && <div className="parcial" style={{ margin: "0 0 10px" }}>{preenchido}</div>}
          <div className="fin-grid">
            <label className="config-campo fin-largo">
              <span>Descrição</span>
              <input
                value={form.descricao}
                onChange={(e) => completar("descricao", e.target.value)}
                autoFocus
                list="fin-descricoes"
                placeholder="ex.: Aluguel loja Centro"
              />
            </label>
            <label className="config-campo">
              <span>Fornecedor</span>
              <input value={form.fornecedor} onChange={(e) => completar("fornecedor", e.target.value)} list="fin-fornecedores" />
            </label>
            <label className="config-campo">
              <span>{form.dividir ? "Empresa que paga" : "Empresa"}</span>
              <select value={form.empresaId} onChange={(e) => campo("empresaId", e.target.value)}>
                <option value="">Escolha…</option>
                {empresasAtivas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="config-campo">
              <span>Categoria</span>
              <select value={form.categoriaId} onChange={(e) => campo("categoriaId", e.target.value)}>
                <option value="">Escolha…</option>
                {categoriasPorGrupo.map(({ g, cats }) => (
                  <optgroup key={g.id} label={g.nome}>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="config-campo">
              <span>Valor{form.repetir !== "nao" ? " (de cada uma)" : ""}</span>
              <input inputMode="decimal" value={form.valor} onChange={(e) => trocarValor(e.target.value)} placeholder="0,00" />
            </label>
            <label className="config-campo">
              <span>
                {pago ? "Data do pagamento" : "Vencimento"}
                {form.repetir !== "nao" ? " (da 1ª)" : ""}
              </span>
              <input type="date" value={form.data} onChange={(e) => campo("data", e.target.value)} />
            </label>
            <label className="config-campo">
              <span>Competência (mês do DRE)</span>
              <input type="month" value={form.competencia || form.data.slice(0, 7)} onChange={(e) => campo("competencia", e.target.value)} />
            </label>
            <label className="config-campo">
              <span>Forma de pagamento</span>
              <select value={form.forma} onChange={(e) => campo("forma", e.target.value)}>
                {cad.formas.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            {form.forma === "PIX" && (
              <label className="config-campo">
                <span>Chave PIX de quem recebe</span>
                <input value={form.chavePix} onChange={(e) => campo("chavePix", e.target.value)} placeholder="CPF, CNPJ, telefone, e-mail…" />
              </label>
            )}
            {!form.id && (
              <label className="config-campo">
                <span>Repetir</span>
                <select value={form.repetir} onChange={(e) => campo("repetir", e.target.value as Formulario["repetir"])}>
                  <option value="nao">{pago ? "Não, à vista" : "Não, conta única"}</option>
                  <option value="parcelado">Parcelado (1/3, 2/3…)</option>
                  <option value="mensal">Todo mês (conta fixa)</option>
                </select>
              </label>
            )}
            {!form.id && form.repetir !== "nao" && (
              <label className="config-campo">
                <span>{form.repetir === "parcelado" ? "Quantas parcelas" : "Por quantos meses"}</span>
                <input inputMode="numeric" value={form.vezes} onChange={(e) => campo("vezes", e.target.value)} />
              </label>
            )}
            {!form.dividir && empresasAtivas.length > 1 && (
              <div className="config-campo">
                <span>Dividir com outras empresas?</span>
                <button type="button" className="fin-dividir fin-dividir-largo" onClick={abrirDivisao}>
                  ⇆ Dividir entre empresas
                </button>
              </div>
            )}
          </div>

          {form.dividir && (
            <div className="fin-rateio">
              <div className="fin-sub" style={{ marginBottom: 6 }}>
                Marque as empresas que dividem esta conta e quanto cada uma paga{" "}
                <button type="button" className="fin-dividir" onClick={() => setForm({ ...form, dividir: false, partes: {} })}>
                  ✕ Não dividir
                </button>
              </div>
              <div className="filters" style={{ marginBottom: 8 }}>
                {empresasAtivas.map((e) => (
                  <button key={e.id} type="button" className={e.id in form.partes ? "active" : ""} onClick={() => alternarEmpresaDivisao(e.id)}>
                    {e.nome}
                  </button>
                ))}
              </div>
              {empresasDivisao.length > 0 && (
                <>
                  <div className="fin-rateio-linhas">
                    {empresasDivisao.map((u) => {
                      const v = lerValor(form.partes[u] ?? "");
                      return (
                        <label key={u} className="fin-rateio-linha">
                          <span>{nomeEmpresa(u)}</span>
                          <input
                            inputMode="decimal"
                            value={form.partes[u]}
                            placeholder="0,00"
                            onChange={(e) => setForm({ ...form, partes: { ...form.partes, [u]: e.target.value } })}
                          />
                          <span className="fin-sub">{valorForm > 0 && v > 0 ? `${Math.round((v / valorForm) * 100)}%` : ""}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="fin-rateio-pe">
                    <button type="button" className="mini ghost" onClick={dividirIgual}>
                      Dividir igual
                    </button>
                    <span className={Math.abs(somaPartes - valorForm) > 0.05 ? "err-msg" : "fin-sub"}>
                      Soma {brl.format(somaPartes)} de {brl.format(valorForm)}
                      {Math.abs(somaPartes - valorForm) > 0.05 &&
                        ` — ${somaPartes < valorForm ? "faltam" : "sobram"} ${brl.format(Math.abs(valorForm - somaPartes))}`}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="fin-grid">
            <label className="config-campo fin-largo">
              <span>Observação</span>
              <input value={form.observacao} onChange={(e) => campo("observacao", e.target.value)} />
            </label>
            <label className="config-campo">
              <span>{pago ? "Comprovante" : "Boleto / nota"} (opcional)</span>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {(form.anexos?.length ?? 0) > 0 && (
            <div className="fin-sub" style={{ marginBottom: 10 }}>
              Anexos:{" "}
              {form.anexos!.map((a) => (
                <span key={a.id} className="fin-anexo">
                  <a href={`/api/financeiro/anexos/${a.id}`} target="_blank" rel="noreferrer">
                    📎 {a.nome}
                  </a>
                  <button type="button" className="link fin-excluir" onClick={() => tirarAnexo(a.id)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="config-acoes">
            <button className="buscar" style={{ width: "auto" }} disabled={salvando}>
              {salvando ? "Salvando…" : form.id ? "Salvar alterações" : pago ? "Lançar como pago" : "Lançar"}
            </button>
            <button type="button" className="exportar" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {dados && (
        <div className={`card fin-hoje${hojeTotal > 0 ? "" : " livre"}`}>
          <div className="fin-hoje-cab">
            <div>
              <div className="seg fin-hoje-abas" role="tablist">
                {(
                  [
                    ["hoje", "Pagar hoje"],
                    ["amanha", "Amanhã"],
                    ["semana", "Próximos 7 dias"],
                  ] as [Janela, string][]
                ).map(([j, nome]) => (
                  <button key={j} className={janela === j ? "on" : ""} onClick={() => setJanela(j)}>
                    {nome}
                    {j !== janela && somaDe(daJanela(j)) > 0 && <span className="fin-hoje-aba-valor"> {brl.format(somaDe(daJanela(j)))}</span>}
                  </button>
                ))}
              </div>
              <div className="fin-sub" style={{ marginTop: 6 }}>
                {janela === "hoje"
                  ? diaExtenso(dados.hoje)
                  : janela === "amanha"
                    ? diaExtenso(dados.amanha)
                    : `de ${dataBr(dados.amanha)} até ${dataBr(somarDia(dados.hoje, 7))}`}
              </div>
            </div>
            <div className="fin-hoje-total">
              {hojeTotal > 0
                ? brl.format(hojeTotal)
                : janela === "hoje"
                  ? "Nada para pagar hoje ✓"
                  : janela === "amanha"
                    ? "Nada para amanhã ✓"
                    : "Nada nos próximos 7 dias ✓"}
              {hojeAtrasado > 0 && <span className="fin-hoje-atraso">inclui {brl.format(hojeAtrasado)} atrasado</span>}
              {hojeTotal === 0 && janela === "hoje" && dados.proxima && (
                <span className="fin-sub">
                  próximo: {dataBr(dados.proxima.vencimento)} · {brl.format(dados.proxima.total)}
                </span>
              )}
            </div>
          </div>
          {hojeTotal > 0 && (
            <div className="fin-hoje-empresas">
              {hojePorEmpresa.map((g) => (
                <div key={g.id} className="fin-hoje-empresa">
                  <div className="fin-hoje-empresa-cab">
                    <span>{g.nome}</span>
                    <b>{brl.format(g.total)}</b>
                  </div>
                  {g.contas.map((c) => {
                    const atrasada = c.vencimento < dados.hoje;
                    return (
                      <div key={c.id} className="fin-hoje-conta">
                        <div className="fin-hoje-conta-info">
                          <span className="fin-desc">
                            {janela === "semana" && <span className="fin-hoje-data">{diaCurto(c.vencimento)}</span>}
                            {c.descricao}
                            {c.parcela && <span className="fin-parcela">{c.parcela}</span>}
                            {(c.anexos ?? []).map((a) => (
                              <a key={a.id} className="fin-clipe" href={`/api/financeiro/anexos/${a.id}`} target="_blank" rel="noreferrer" title={a.nome}>
                                📎
                              </a>
                            ))}
                          </span>
                          <span className="fin-sub">
                            {[c.fornecedor, c.forma].filter(Boolean).join(" · ")}
                            {atrasada && <b className="fin-atrasada"> · venceu {dataBr(c.vencimento)}</b>}
                            {reagendadoTexto(c)}
                          </span>
                          {c.chavePix && <ChavePix chave={c.chavePix} copiada={copiada === c.id} aoCopiar={() => copiarChave(c)} />}
                          {c.observacao && <span className="fin-sub fin-obs">{c.observacao}</span>}
                        </div>
                        <span className="fin-hoje-valor">{brl.format(c.valor)}</span>
                        {acoesRapidas(c)}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {dados && dados.porEmpresa.length > 0 && (
        <div className="fin-empresas">
          <div className="fin-empresas-titulo">No mês, por empresa</div>
          {dados.porEmpresa.map((e) => (
            <button
              key={e.empresaId}
              className={`fin-empresa${empresa === e.empresaId ? " sel" : ""}`}
              onClick={() => setEmpresa(empresa === e.empresaId ? "" : e.empresaId)}
              title={empresa === e.empresaId ? "Clique para ver todas" : `Ver só ${e.nome}`}
            >
              <span className="fin-empresa-nome">{e.nome}</span>
              <span className="fin-empresa-valor">{brl.format(e.aPagar)}</span>
              <span className="fin-sub">
                a pagar em {nomeMesLongo(mes || mesAtual()).split(" ")[0]}
                {e.qtd ? ` · ${e.qtd} ${e.qtd === 1 ? "conta" : "contas"}` : ""}
              </span>
              {e.vencido > 0 && <span className="fin-empresa-vencido">{brl.format(e.vencido)} vencido</span>}
              {e.pago > 0 && <span className="fin-sub">pago no mês {brl.format(e.pago)}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="fin-barra">
        <div className="seg" role="group" aria-label="Ver como">
          <button className={vista === "agenda" ? "on" : ""} onClick={() => trocarVista("agenda")}>
            Agenda
          </button>
          <button className={vista === "lista" ? "on" : ""} onClick={() => trocarVista("lista")}>
            Lista
          </button>
        </div>
        <div className="seg" role="group" aria-label="Situação">
          {(["abertas", "vencidas", "pagas", "todas"] as Status[]).map((s) => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="fin-mes">
          <button
            className="mini ghost"
            onClick={() => {
              setDia("");
              setMes(somarMes(mes || mesAtual(), -1));
            }}
            aria-label="Mês anterior"
          >
            ‹
          </button>
          <span>{mes ? nomeMesLongo(mes) : "todos os meses"}</span>
          <button
            className="mini ghost"
            onClick={() => {
              setDia("");
              setMes(somarMes(mes || mesAtual(), 1));
            }}
            aria-label="Próximo mês"
          >
            ›
          </button>
          {vista === "lista" && (
            <button className="link" onClick={() => setMes(mes ? "" : mesAtual())}>
              {mes ? "ver todos" : "só este mês"}
            </button>
          )}
        </div>
        {empresasAtivas.length > 1 && (
          <select className="fin-select" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            <option value="">Todas as empresas</option>
            {empresasAtivas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        )}
        <input className="busca fin-busca" placeholder="Buscar (descrição, fornecedor…)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {vista === "agenda" && dados && mes && (
        <div className="card">
          {anteriores.length > 0 && (
            <button className="fin-anteriores" onClick={() => trocarVista("lista")}>
              ⚠ {anteriores.length} {anteriores.length === 1 ? "conta vencida" : "contas vencidas"} de meses anteriores ·{" "}
              {brl.format(anteriores.reduce((s, c) => s + c.valor, 0))} — ver na lista
            </button>
          )}
          <Agenda mes={mes} hoje={dados.hoje} contas={contasMes} dia={dia} aoEscolherDia={setDia} />
        </div>
      )}

      <div className="card">
        {vista === "agenda" && (
          <div className="fin-cab">
            <h2>{dia ? `Dia ${dataBr(dia)}` : `${mes ? nomeMesLongo(mes) : "Todas"}`}</h2>
            {dia && (
              <button className="link" onClick={() => setDia("")}>
                ver o mês inteiro
              </button>
            )}
          </div>
        )}
        {!dados ? (
          <div className="empty">Carregando…</div>
        ) : lista.length === 0 ? (
          <div className="empty">
            Nada {status === "pagas" ? "pago" : status === "todas" ? "lançado" : "em aberto"} {dia ? "neste dia" : "aqui"}.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="prod-tbl fin-tbl">
              <thead>
                <tr>
                  <th>Venc.</th>
                  <th>Descrição</th>
                  {colunaEmpresa && <th>Empresa</th>}
                  <th>Categoria</th>
                  <th className="n">Valor</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <Fragment key={g.id}>
                    {agrupar && (
                      <tr className="fin-grupo-linha">
                        <td colSpan={6}>
                          <span>{g.nome}</span>
                          <span className="fin-grupo-total">
                            {g.contas.length} {g.contas.length === 1 ? "conta" : "contas"} ·{" "}
                            <b>{brl.format(g.contas.reduce((s, c) => s + valorDe(c), 0))}</b>
                          </span>
                        </td>
                      </tr>
                    )}
                    {g.contas.map((c) => {
                      const vencida = c.status === "aberta" && c.vencimento < dados.hoje;
                      const hoje = c.status === "aberta" && c.vencimento === dados.hoje;
                      const rateio = descreverRateio(c);
                      return (
                        <tr key={c.id} className={c.status === "paga" ? "paga" : ""}>
                          <td className={vencida ? "vencida" : ""}>{dataBr(c.vencimento)}</td>
                          <td title={c.observacao || undefined}>
                            <div className="fin-desc">
                              {c.descricao}
                              {c.parcela && <span className="fin-parcela">{c.parcela}</span>}
                              {(c.anexos ?? []).map((a) => (
                                <a key={a.id} className="fin-clipe" href={`/api/financeiro/anexos/${a.id}`} target="_blank" rel="noreferrer" title={a.nome}>
                                  📎
                                </a>
                              ))}
                            </div>
                            {(c.fornecedor || c.forma || rateio || (c.reagendamentos?.length ?? 0) > 0) && (
                              <div className="fin-sub">
                                {[c.fornecedor, c.forma, rateio].filter(Boolean).join(" · ")}
                                {reagendadoTexto(c)}
                              </div>
                            )}
                            {c.chavePix && c.status === "aberta" && (
                              <ChavePix chave={c.chavePix} copiada={copiada === c.id} aoCopiar={() => copiarChave(c)} />
                            )}
                          </td>
                          {colunaEmpresa && <td className="fin-sub">{nomeEmpresa(c.empresaId)}</td>}
                          <td className="fin-sub">{nomeCategoria(c.categoriaId)}</td>
                          <td className="n">
                            <b>{brl.format(c.status === "paga" ? c.valorPago ?? c.valor : c.valor)}</b>
                          </td>
                          <td>
                            {c.status === "paga" ? (
                              <span className="fin-status paga" title={c.pagoPorNome ? `baixa por ${c.pagoPorNome}` : undefined}>
                                paga {dataBr(c.pagoEm)}
                              </span>
                            ) : vencida ? (
                              <span className="fin-status vencida">vencida</span>
                            ) : hoje ? (
                              <span className="fin-status hoje">vence hoje</span>
                            ) : (
                              <span className="fin-status">a vencer</span>
                            )}
                          </td>
                          <td className="fin-acoes">
                            {pagando?.id === c.id || reagendando?.id === c.id ? (
                              acoesRapidas(c)
                            ) : (
                              <>
                                {c.status === "aberta" ? (
                                  acoesRapidas(c)
                                ) : (
                                  <button className="mini ghost" onClick={() => reabrir(c)}>
                                    Desfazer
                                  </button>
                                )}
                                <button className="link" onClick={() => anexar(c.id)} title="Anexar boleto ou comprovante">
                                  anexar
                                </button>
                                <button className="link" onClick={() => copiar(c)} title="Lançar outra igual a esta">
                                  copiar
                                </button>
                                <button className="link" onClick={() => editar(c)}>
                                  editar
                                </button>
                                {podeExcluir(c) && (
                                  <button className="link fin-excluir" onClick={() => excluir(c)}>
                                    excluir
                                  </button>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lista.length > 0 && (
          <div className="rank-aviso" style={{ margin: "12px 0 0" }}>
            {lista.length} {lista.length === 1 ? "conta" : "contas"} · total <b>{brl.format(totalLista)}</b>
            {vista === "lista" && mes && status !== "pagas" && anteriores.length > 0 && " · as vencidas de meses anteriores aparecem junto, para não serem esquecidas"}
          </div>
        )}
      </div>
    </div>
  );
}
