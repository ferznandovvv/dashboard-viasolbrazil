"use client";

import { useCallback, useEffect, useState } from "react";
import type { Conta, UsuarioPublico } from "@/lib/financeiro/tipos";
import { type Cadastros, api, brl, dataBr, hojeSp, lerValor, nomeMesLongo, valorParaCampo } from "./comum";

type ContaTela = Conta & { criadoPorNome: string; pagoPorNome: string };

interface Resposta {
  hoje: string;
  resumo: Record<"vencidas" | "hoje" | "proximos7" | "pagasMes", { qtd: number; total: number }>;
  contas: ContaTela[];
  totalLista: number;
}

type Status = "abertas" | "vencidas" | "pagas" | "todas";

interface Formulario {
  id?: string;
  descricao: string;
  fornecedor: string;
  empresaId: string;
  categoriaId: string;
  valor: string;
  vencimento: string;
  competencia: string;
  forma: string;
  observacao: string;
  repetir: "nao" | "parcelado" | "mensal";
  vezes: string;
}

const mesAtual = () => hojeSp().slice(0, 7);
const somarMes = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Contas a pagar: lançar, acompanhar o vencimento e dar baixa. */
export function Contas({ cad, usuario }: { cad: Cadastros; usuario: UsuarioPublico }) {
  const empresasAtivas = cad.empresas.filter((e) => e.ativa);
  const categoriasAtivas = cad.categorias.filter((c) => c.ativa);
  const [empresa, setEmpresa] = useState("");
  const [status, setStatus] = useState<Status>("abertas");
  const [mes, setMes] = useState(mesAtual());
  const [q, setQ] = useState("");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState<Formulario | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pagando, setPagando] = useState<{ id: string; pagoEm: string; valor: string } | null>(null);

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

  const nomeEmpresa = (id: string) => cad.empresas.find((e) => e.id === id)?.nome ?? "—";
  const nomeCategoria = (id: string) => cad.categorias.find((c) => c.id === id)?.nome ?? "—";

  const novo = (): Formulario => ({
    descricao: "",
    fornecedor: "",
    empresaId: empresa || (empresasAtivas.length === 1 ? empresasAtivas[0].id : ""),
    categoriaId: "",
    valor: "",
    vencimento: hojeSp(),
    competencia: "",
    forma: "Boleto",
    observacao: "",
    repetir: "nao",
    vezes: "2",
  });

  const editar = (c: ContaTela) =>
    setForm({
      id: c.id,
      descricao: c.descricao,
      fornecedor: c.fornecedor,
      empresaId: c.empresaId,
      categoriaId: c.categoriaId,
      valor: valorParaCampo(c.valor),
      vencimento: c.vencimento,
      competencia: c.competencia,
      forma: c.forma,
      observacao: c.observacao,
      repetir: "nao",
      vezes: "1",
    });

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSalvando(true);
    setErro("");
    const corpo = {
      ...form,
      valor: lerValor(form.valor),
      competencia: form.competencia || form.vencimento.slice(0, 7),
      vezes: form.repetir === "nao" ? 1 : Number(form.vezes) || 1,
      repetir: form.repetir === "nao" ? undefined : form.repetir,
    };
    try {
      if (form.id) {
        await api(`/api/financeiro/contas/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify({ acao: "editar", ...corpo }),
        });
      } else {
        await api("/api/financeiro/contas", { method: "POST", body: JSON.stringify(corpo) });
        // Vai para o mês da conta lançada, para ela aparecer na lista
        setMes(form.vencimento.slice(0, 7));
      }
      setForm(null);
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

  const podeExcluir = (c: ContaTela) => usuario.papel === "admin" || c.criadoPor === usuario.id;
  const categoriasPorGrupo = cad.grupos
    .map((g) => ({ g, cats: categoriasAtivas.filter((c) => c.grupo === g.id) }))
    .filter((x) => x.cats.length);
  const campo = (k: keyof Formulario, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const r = dados?.resumo;
  return (
    <div>
      {r && (
        <div className="tiles fin-resumo">
          <button className={`tile${r.vencidas.qtd ? " alerta" : ""}`} onClick={() => setStatus("vencidas")}>
            <div className="label">Vencidas</div>
            <div className="value">{brl.format(r.vencidas.total)}</div>
            <span className="muted">{r.vencidas.qtd} {r.vencidas.qtd === 1 ? "conta" : "contas"}</span>
          </button>
          <div className="tile">
            <div className="label">Vence hoje</div>
            <div className="value">{brl.format(r.hoje.total)}</div>
            <span className="muted">{r.hoje.qtd} {r.hoje.qtd === 1 ? "conta" : "contas"}</span>
          </div>
          <div className="tile">
            <div className="label">Próximos 7 dias</div>
            <div className="value">{brl.format(r.proximos7.total)}</div>
            <span className="muted">{r.proximos7.qtd} {r.proximos7.qtd === 1 ? "conta" : "contas"}</span>
          </div>
          <div className="tile">
            <div className="label">Pago este mês</div>
            <div className="value">{brl.format(r.pagasMes.total)}</div>
            <span className="muted">{r.pagasMes.qtd} {r.pagasMes.qtd === 1 ? "conta" : "contas"}</span>
          </div>
        </div>
      )}

      <div className="fin-barra">
        <div className="seg" role="group" aria-label="Situação">
          {(["abertas", "vencidas", "pagas", "todas"] as Status[]).map((s) => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="fin-mes">
          <button className="mini ghost" onClick={() => setMes(somarMes(mes || mesAtual(), -1))} aria-label="Mês anterior">
            ‹
          </button>
          <span>{mes ? nomeMesLongo(mes) : "todos os meses"}</span>
          <button className="mini ghost" onClick={() => setMes(somarMes(mes || mesAtual(), 1))} aria-label="Próximo mês">
            ›
          </button>
          <button className="link" onClick={() => setMes(mes ? "" : mesAtual())}>
            {mes ? "ver todos" : "só este mês"}
          </button>
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
        <button className="mini" onClick={() => setForm(novo())}>
          + Lançar conta
        </button>
      </div>

      {erro && <div className="card err-msg">{erro}</div>}

      {form && (
        <form className="card fin-form" onSubmit={salvar}>
          <h2>{form.id ? "Editar conta" : "Lançar conta a pagar"}</h2>
          <div className="fin-grid">
            <label className="config-campo fin-largo">
              <span>Descrição</span>
              <input value={form.descricao} onChange={(e) => campo("descricao", e.target.value)} autoFocus placeholder="ex.: Aluguel loja Centro" />
            </label>
            <label className="config-campo">
              <span>Fornecedor</span>
              <input value={form.fornecedor} onChange={(e) => campo("fornecedor", e.target.value)} />
            </label>
            <label className="config-campo">
              <span>Empresa</span>
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
              <input inputMode="decimal" value={form.valor} onChange={(e) => campo("valor", e.target.value)} placeholder="0,00" />
            </label>
            <label className="config-campo">
              <span>Vencimento{form.repetir !== "nao" ? " (da 1ª)" : ""}</span>
              <input type="date" value={form.vencimento} onChange={(e) => campo("vencimento", e.target.value)} />
            </label>
            <label className="config-campo">
              <span>Competência (mês do DRE)</span>
              <input
                type="month"
                value={form.competencia || form.vencimento.slice(0, 7)}
                onChange={(e) => campo("competencia", e.target.value)}
              />
            </label>
            <label className="config-campo">
              <span>Forma de pagamento</span>
              <select value={form.forma} onChange={(e) => campo("forma", e.target.value)}>
                {cad.formas.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            {!form.id && (
              <label className="config-campo">
                <span>Repetir</span>
                <select value={form.repetir} onChange={(e) => campo("repetir", e.target.value)}>
                  <option value="nao">Não, conta única</option>
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
            <label className="config-campo fin-largo">
              <span>Observação</span>
              <input value={form.observacao} onChange={(e) => campo("observacao", e.target.value)} />
            </label>
          </div>
          <div className="config-acoes">
            <button className="buscar" style={{ width: "auto" }} disabled={salvando}>
              {salvando ? "Salvando…" : form.id ? "Salvar alterações" : "Lançar"}
            </button>
            <button type="button" className="exportar" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="card">
        {!dados ? (
          <div className="empty">Carregando…</div>
        ) : dados.contas.length === 0 ? (
          <div className="empty">Nenhuma conta {status === "pagas" ? "paga" : "em aberto"} aqui.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="prod-tbl fin-tbl">
              <thead>
                <tr>
                  <th>Venc.</th>
                  <th>Descrição</th>
                  {empresasAtivas.length > 1 && <th>Empresa</th>}
                  <th>Categoria</th>
                  <th className="n">Valor</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dados.contas.map((c) => {
                  const vencida = c.status === "aberta" && c.vencimento < dados.hoje;
                  const hoje = c.status === "aberta" && c.vencimento === dados.hoje;
                  return (
                    <tr key={c.id} className={c.status === "paga" ? "paga" : ""}>
                      <td className={vencida ? "vencida" : ""}>{dataBr(c.vencimento)}</td>
                      <td title={c.observacao || undefined}>
                        <div className="fin-desc">
                          {c.descricao}
                          {c.parcela && <span className="fin-parcela">{c.parcela}</span>}
                        </div>
                        {(c.fornecedor || c.forma) && (
                          <div className="fin-sub">{[c.fornecedor, c.forma].filter(Boolean).join(" · ")}</div>
                        )}
                      </td>
                      {empresasAtivas.length > 1 && <td className="fin-sub">{nomeEmpresa(c.empresaId)}</td>}
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
                        {pagando?.id === c.id ? (
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
                        ) : (
                          <>
                            {c.status === "aberta" ? (
                              <button
                                className="mini"
                                onClick={() => setPagando({ id: c.id, pagoEm: hojeSp(), valor: valorParaCampo(c.valor) })}
                              >
                                Pagar
                              </button>
                            ) : (
                              <button className="mini ghost" onClick={() => reabrir(c)}>
                                Desfazer
                              </button>
                            )}
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
              </tbody>
            </table>
          </div>
        )}
        {dados && dados.contas.length > 0 && (
          <div className="rank-aviso" style={{ margin: "12px 0 0" }}>
            {dados.contas.length} {dados.contas.length === 1 ? "conta" : "contas"} · total{" "}
            <b>{brl.format(dados.totalLista)}</b>
            {mes && status !== "pagas" && " · as vencidas de meses anteriores aparecem junto, para não serem esquecidas"}
          </div>
        )}
      </div>
    </div>
  );
}
