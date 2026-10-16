"use client";

import { useCallback, useEffect, useState } from "react";
import type { CodigoResgate, Mensagem, MovimentoCashback, Recebida, Venda } from "@/lib/crm/tipos";
import { type ClienteResumo, type Resumo, STATUS_NOME, api, brl, dataBrAno, dataHora, lerValor } from "./comum";
import { formatarTelefone } from "@/lib/crm/telefone";

interface Ficha {
  cliente: ClienteResumo;
  vendas: Venda[];
  extrato: MovimentoCashback[];
  creditos: { restante: number; validade: string }[];
  mensagens: Mensagem[];
  recebidas: Recebida[];
  codigos: CodigoResgate[];
}

/** Lista de clientes por segmento, com ficha e ações. */
export function Clientes({ r, segmentoInicial, recarregar }: { r: Resumo; segmentoInicial?: string; recarregar: () => Promise<void> }) {
  const [segmento, setSegmento] = useState(segmentoInicial ?? "todos");
  const [loja, setLoja] = useState("");
  const [busca, setBusca] = useState("");
  const [dados, setDados] = useState<{ total: number; clientes: ClienteResumo[] } | null>(null);
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [avulsa, setAvulsa] = useState(false);

  useEffect(() => {
    if (segmentoInicial) setSegmento(segmentoInicial);
  }, [segmentoInicial]);

  const carregar = useCallback(async () => {
    const qs = new URLSearchParams({ segmento, ...(loja ? { loja } : {}), ...(busca ? { busca } : {}) });
    setDados(await api(`/api/crm/clientes?${qs}`));
  }, [segmento, loja, busca]);

  useEffect(() => {
    const t = setTimeout(() => carregar().catch(() => setDados({ total: 0, clientes: [] })), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);

  const seg = r.segmentos.find((s) => s.id === segmento);
  return (
    <div>
      <div className="fin-barra">
        <select className="fin-select" value={segmento} onChange={(e) => setSegmento(e.target.value)}>
          {r.segmentos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome} ({s.total})
            </option>
          ))}
        </select>
        <select className="fin-select" value={loja} onChange={(e) => setLoja(e.target.value)}>
          <option value="">Todas as lojas</option>
          {r.lojas.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <input className="fin-busca config-campo" placeholder="Buscar por nome, telefone ou CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="mini ghost" onClick={() => setNova(true)}>
          Nova cliente
        </button>
        {segmento !== "todos" && segmento !== "sem_telefone" && segmento !== "opt_out" && (
          <button className="mini" onClick={() => setAvulsa(true)}>
            Mandar mensagem para este segmento
          </button>
        )}
      </div>
      {seg?.dica && <div className="muted" style={{ marginBottom: 10 }}>{seg.dica}</div>}

      <div className="card">
        {!dados ? (
          <div className="empty">Carregando…</div>
        ) : !dados.clientes.length ? (
          <div className="empty">Ninguém aqui ainda.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="prod-tbl fin-tbl">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Telefone</th>
                  <th>Loja</th>
                  <th className="n">Compras</th>
                  <th className="n">Total gasto</th>
                  <th>Última compra</th>
                  <th className="n">Saldo</th>
                  <th>Aniversário</th>
                  <th>WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {dados.clientes.map((c) => (
                  <tr key={c.id} className="clicavel" onClick={() => setFichaId(c.id)}>
                    <td className="fin-desc">{c.nome}</td>
                    <td>{formatarTelefone(c.telefone) || <span className="muted">sem telefone</span>}</td>
                    <td>{c.ultimaLoja ?? c.lojaOrigem ?? ""}</td>
                    <td className="n">{c.compras}</td>
                    <td className="n">{brl.format(c.totalGasto)}</td>
                    <td>{dataBrAno(c.ultimaCompra)}</td>
                    <td className="n">
                      {c.saldo ? brl.format(c.saldo) : ""}
                      {c.vencendo > 0 && <div className="fin-sub">vence {dataBrAno(c.vencendoEm)}</div>}
                    </td>
                    <td>{c.nascimento ? c.nascimento.slice(8, 10) + "/" + c.nascimento.slice(5, 7) : ""}</td>
                    <td>
                      {c.optOut ? <span className="badge err">não receber</span> : !c.optIn ? <span className="badge">sem aceite</span> : c.podeMarketing ? <span className="badge on">ok</span> : <span className="badge">só avisos</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dados.total > dados.clientes.length && <div className="muted" style={{ marginTop: 8 }}>Mostrando {dados.clientes.length} de {dados.total}. Refine a busca para ver o resto.</div>}
          </div>
        )}
      </div>

      {fichaId && (
        <FichaCliente
          id={fichaId}
          lojas={r.lojas}
          fechar={() => setFichaId(null)}
          aoMudar={async () => {
            await carregar();
            await recarregar();
          }}
        />
      )}
      {nova && (
        <NovaCliente
          lojas={r.lojas}
          fechar={() => setNova(false)}
          aoSalvar={async (id) => {
            setNova(false);
            await carregar();
            await recarregar();
            setFichaId(id);
          }}
        />
      )}
      {avulsa && dados && (
        <MensagemSegmento
          segmento={segmento}
          nome={seg?.nome ?? ""}
          loja={loja}
          total={dados.total}
          fechar={() => setAvulsa(false)}
          aoEnviar={async () => {
            setAvulsa(false);
            await recarregar();
          }}
        />
      )}
    </div>
  );
}

function Janela({ titulo, fechar, children, larga }: { titulo: string; fechar: () => void; children: React.ReactNode; larga?: boolean }) {
  return (
    <div className="crm-fundo" onClick={fechar}>
      <div className={`crm-janela ${larga ? "larga" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="fin-cab">
          <h2>{titulo}</h2>
          <button className="link" onClick={fechar}>
            fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FichaCliente({ id, lojas, fechar, aoMudar }: { id: string; lojas: string[]; fechar: () => void; aoMudar: () => Promise<void> }) {
  const [f, setF] = useState<Ficha | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [editando, setEditando] = useState(false);
  const [acao, setAcao] = useState<"" | "resgate" | "ajuste" | "mensagem" | "codigo">("");

  const carregar = useCallback(async () => setF(await api<Ficha>(`/api/crm/clientes/${id}`)), [id]);
  useEffect(() => {
    carregar().catch((e) => setErro(e.message));
  }, [carregar]);

  const executar = async (corpo: object, msg = "Feito.") => {
    setErro("");
    setAviso("");
    try {
      const r = await api<Record<string, unknown>>(`/api/crm/clientes/${id}`, { method: "POST", body: JSON.stringify(corpo) });
      await carregar();
      await aoMudar();
      setAcao("");
      if (r.codigo && typeof r.codigo === "object") setAviso(`Código ${(r.codigo as CodigoResgate).codigo} gerado, vale 7 dias.`);
      else setAviso(msg);
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
      return false;
    }
  };

  if (!f) return <Janela titulo="Cliente" fechar={fechar}>{erro ? <div className="login-error">{erro}</div> : <div className="empty">Carregando…</div>}</Janela>;
  const c = f.cliente;
  return (
    <Janela titulo={c.nome} fechar={fechar} larga>
      {editando ? (
        <FormCliente
          lojas={lojas}
          inicial={c}
          cancelar={() => setEditando(false)}
          salvar={async (d) => {
            try {
              await api("/api/crm/clientes", { method: "POST", body: JSON.stringify({ ...d, id }) });
              setEditando(false);
              await carregar();
              await aoMudar();
            } catch (e) {
              setErro(e instanceof Error ? e.message : "Erro");
            }
          }}
        />
      ) : (
        <div className="crm-ficha-topo">
          <div>
            <div>{formatarTelefone(c.telefone) || <span className="muted">sem telefone</span>}{c.email && <span className="muted"> · {c.email}</span>}</div>
            <div className="muted">
              {c.nascimento && <>Aniversário {dataBrAno(c.nascimento)} · </>}
              {c.cpf && <>CPF {c.cpf.slice(0, 3)}.•••.•••-{c.cpf.slice(9)} · </>}
              {c.lojaOrigem && <>Loja {c.lojaOrigem} · </>}
              {c.codigoTotvs && <>TOTVS #{c.codigoTotvs} · </>}
              cadastro {dataBrAno(c.criadoEm.slice(0, 10))}
            </div>
            {c.obs && <div className="muted">Obs.: {c.obs}</div>}
            <div style={{ marginTop: 6 }}>
              {c.optOut ? <span className="badge err">pediu para não receber</span> : c.optIn ? <span className="badge on">aceita mensagens</span> : <span className="badge">sem aceite</span>}
              {c.semResposta > 0 && <span className="badge" style={{ marginLeft: 6 }}>{c.semResposta} sem resposta</span>}
            </div>
          </div>
          <div className="crm-ficha-acoes">
            <button className="link" onClick={() => setEditando(true)}>editar</button>
            <button className="link" onClick={() => executar({ acao: "optout", valor: !c.optOut }, c.optOut ? "Voltou a receber." : "Não recebe mais.")}>
              {c.optOut ? "voltar a receber" : "não receber"}
            </button>
          </div>
        </div>
      )}

      <div className="tiles tiles-2" style={{ marginTop: 14 }}>
        <div className="tile">
          <div className="label">Saldo de cashback</div>
          <div className="value">{brl.format(c.saldo)}</div>
          <div className="muted">
            {f.creditos.map((x) => `${brl.format(x.restante)} até ${dataBrAno(x.validade)}`).join(" · ") || "nenhum crédito aberto"}
          </div>
        </div>
        <div className="tile">
          <div className="label">Compras</div>
          <div className="value">{brl.format(c.totalGasto)}</div>
          <div className="muted">{c.compras} compras{c.ultimaCompra && <> · última {dataBrAno(c.ultimaCompra)} em {c.ultimaLoja}</>}</div>
        </div>
      </div>

      <div className="config-acoes" style={{ margin: "12px 0" }}>
        <button className="mini" onClick={() => setAcao(acao === "resgate" ? "" : "resgate")} disabled={c.saldo <= 0}>Registrar resgate</button>
        <button className="mini ghost" onClick={() => setAcao(acao === "codigo" ? "" : "codigo")} disabled={c.saldo <= 0}>Gerar código</button>
        <button className="mini ghost" onClick={() => setAcao(acao === "ajuste" ? "" : "ajuste")}>Ajustar cashback</button>
        <button className="mini ghost" onClick={() => setAcao(acao === "mensagem" ? "" : "mensagem")} disabled={!c.telefone}>Mandar mensagem</button>
      </div>
      {acao === "resgate" && <FormResgate lojas={lojas} saldo={c.saldo} executar={executar} />}
      {acao === "codigo" && <FormValor rotulo="Valor do código (a cliente mostra no caixa)" max={c.saldo} executar={(v) => executar({ acao: "codigo", valor: v })} />}
      {acao === "ajuste" && <FormAjuste executar={executar} />}
      {acao === "mensagem" && <FormMensagem lojas={lojas} lojaPadrao={c.ultimaLoja ?? c.lojaOrigem} executar={executar} />}
      {erro && <div className="login-error">{erro}</div>}
      {aviso && <div className="crm-aviso">{aviso}</div>}
      {f.codigos.length > 0 && (
        <div className="muted" style={{ marginBottom: 8 }}>
          Códigos ativos: {f.codigos.map((x) => `${x.codigo} (${brl.format(x.valor)}, até ${dataBrAno(x.validade)})`).join(", ")}
        </div>
      )}

      <div className="grid-2 crm-grid">
        <div>
          <h3 className="crm-h3">Extrato de cashback</h3>
          {!f.extrato.length ? (
            <div className="muted">Nada ainda.</div>
          ) : (
            <table className="prod-tbl fin-tbl">
              <tbody>
                {f.extrato.slice(0, 30).map((m) => (
                  <tr key={m.id}>
                    <td>{dataBrAno(m.criadoEm.slice(0, 10))}</td>
                    <td>
                      {m.tipo === "credito" ? "Crédito" : m.tipo === "resgate" ? "Resgate" : m.tipo === "expiracao" ? "Expirou" : "Ajuste"}
                      {m.loja && <span className="fin-sub"> {m.loja}</span>}
                      {m.codigo && <span className="fin-sub"> cód. {m.codigo}</span>}
                      {m.validade && m.tipo === "credito" && <div className="fin-sub">vale até {dataBrAno(m.validade)}</div>}
                      {m.obs && <div className="fin-sub">{m.obs}</div>}
                    </td>
                    <td className={`n ${m.valor < 0 ? "vencida" : ""}`}>{brl.format(m.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="crm-h3">Compras</h3>
          {!f.vendas.length ? (
            <div className="muted">Nenhuma venda ligada a esta cliente.</div>
          ) : (
            <table className="prod-tbl fin-tbl">
              <tbody>
                {f.vendas.slice(0, 30).map((v) => (
                  <tr key={v.id}>
                    <td>{dataBrAno(v.data.slice(0, 10))}</td>
                    <td>{v.loja}{v.pecas ? <span className="fin-sub"> {v.pecas} pç</span> : null}</td>
                    <td className="n">{brl.format(v.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3 className="crm-h3">Conversa</h3>
          {!f.mensagens.length && !f.recebidas.length ? (
            <div className="muted">Nenhuma mensagem ainda.</div>
          ) : (
            <div className="crm-conversa">
              {[...f.mensagens.map((m) => ({ t: m.enviadoEm ?? m.criadoEm, m })), ...f.recebidas.map((r) => ({ t: r.recebidoEm, r }))]
                .sort((a, b) => b.t.localeCompare(a.t))
                .slice(0, 40)
                .map((x, i) =>
                  "m" in x && x.m ? (
                    <div key={i} className={`crm-balao nossa ${x.m.status}`}>
                      <div className="fin-sub">
                        {x.m.campanha.replace(/_/g, " ")} · {x.m.loja} · {dataHora(x.m.enviadoEm ?? x.m.criadoEm)} · {STATUS_NOME[x.m.status]}
                        {x.m.status === "fila" && (
                          <>
                            {" "}
                            <button className="link" onClick={() => api("/api/crm/mensagens", { method: "POST", body: JSON.stringify({ acao: "cancelar", id: x.m!.id }) }).then(carregar)}>
                              cancelar
                            </button>
                          </>
                        )}
                        {x.m.erro && <span className="fin-status vencida"> {x.m.erro}</span>}
                      </div>
                      {x.m.texto}
                    </div>
                  ) : "r" in x && x.r ? (
                    <div key={i} className="crm-balao dela">
                      <div className="fin-sub">{dataHora(x.r.recebidoEm)}</div>
                      {x.r.texto}
                    </div>
                  ) : null
                )}
            </div>
          )}
        </div>
      </div>
    </Janela>
  );
}

function FormResgate({ lojas, saldo, executar }: { lojas: string[]; saldo: number; executar: (c: object, msg?: string) => Promise<boolean> }) {
  const [valor, setValor] = useState("");
  const [compra, setCompra] = useState("");
  const [loja, setLoja] = useState(lojas[0] ?? "");
  const [codigo, setCodigo] = useState("");
  return (
    <div className="card crm-form">
      <div className="fin-grid">
        <label className="config-campo"><span>Valor a usar (saldo {brl.format(saldo)})</span><input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></label>
        <label className="config-campo"><span>Valor da compra</span><input value={compra} onChange={(e) => setCompra(e.target.value)} placeholder="opcional, para o teto" /></label>
        <label className="config-campo"><span>Loja</span><select value={loja} onChange={(e) => setLoja(e.target.value)}>{lojas.map((l) => <option key={l}>{l}</option>)}</select></label>
        <label className="config-campo"><span>Código (se a cliente trouxe um)</span><input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} /></label>
      </div>
      <button className="mini" onClick={() => executar({ acao: "resgate", valor: lerValor(valor), valorCompra: lerValor(compra) || undefined, loja, codigo: codigo || undefined }, "Resgate registrado.")}>Confirmar resgate</button>
    </div>
  );
}

function FormValor({ rotulo, max, executar }: { rotulo: string; max: number; executar: (v: number) => Promise<boolean> }) {
  const [valor, setValor] = useState(max.toFixed(2).replace(".", ","));
  return (
    <div className="card crm-form">
      <label className="config-campo"><span>{rotulo}</span><input value={valor} onChange={(e) => setValor(e.target.value)} /></label>
      <button className="mini" onClick={() => executar(lerValor(valor))}>Gerar</button>
    </div>
  );
}

function FormAjuste({ executar }: { executar: (c: object, msg?: string) => Promise<boolean> }) {
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  return (
    <div className="card crm-form">
      <div className="fin-grid">
        <label className="config-campo"><span>Valor (negativo para tirar)</span><input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ex.: 25,00 ou -10,00" /></label>
        <label className="config-campo fin-largo"><span>Motivo</span><input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: troca, cortesia, correção" /></label>
      </div>
      <button className="mini" onClick={() => executar({ acao: "ajuste", valor: lerValor(valor), obs }, "Ajuste lançado.")} disabled={!obs.trim()}>Lançar ajuste</button>
    </div>
  );
}

function FormMensagem({ lojas, lojaPadrao, executar }: { lojas: string[]; lojaPadrao?: string; executar: (c: object, msg?: string) => Promise<boolean> }) {
  const [texto, setTexto] = useState("");
  const [loja, setLoja] = useState(lojaPadrao ?? lojas[0] ?? "");
  return (
    <div className="card crm-form">
      <label className="config-campo"><span>Texto (sai pelo número da loja escolhida, dentro do horário de envio)</span><textarea className="crm-textarea" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} /></label>
      <div className="config-acoes">
        <select className="fin-select" value={loja} onChange={(e) => setLoja(e.target.value)}>{lojas.map((l) => <option key={l}>{l}</option>)}</select>
        <button className="mini" disabled={!texto.trim()} onClick={() => executar({ acao: "mensagem", texto, loja }, "Entrou na fila.")}>Colocar na fila</button>
      </div>
    </div>
  );
}

interface DadosForm {
  nome: string;
  telefone: string;
  cpf: string;
  email: string;
  nascimento: string;
  lojaOrigem: string;
  optIn: boolean;
  obs: string;
}

function FormCliente({ lojas, inicial, salvar, cancelar }: { lojas: string[]; inicial?: ClienteResumo; salvar: (d: DadosForm) => Promise<void>; cancelar: () => void }) {
  const [d, setD] = useState<DadosForm>({
    nome: inicial?.nome ?? "",
    telefone: formatarTelefone(inicial?.telefone),
    cpf: inicial?.cpf ?? "",
    email: inicial?.email ?? "",
    nascimento: inicial?.nascimento ?? "",
    lojaOrigem: inicial?.lojaOrigem ?? "",
    optIn: inicial?.optIn ?? true,
    obs: inicial?.obs ?? "",
  });
  const campo = (k: keyof DadosForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <div>
      <div className="fin-grid">
        <label className="config-campo fin-largo"><span>Nome</span><input value={d.nome} onChange={campo("nome")} /></label>
        <label className="config-campo"><span>Celular</span><input value={d.telefone} onChange={campo("telefone")} placeholder="(16) 99999-8888" /></label>
        <label className="config-campo"><span>Aniversário</span><input type="date" value={d.nascimento} onChange={campo("nascimento")} /></label>
        <label className="config-campo"><span>CPF</span><input value={d.cpf} onChange={campo("cpf")} /></label>
        <label className="config-campo"><span>E-mail</span><input value={d.email} onChange={campo("email")} /></label>
        <label className="config-campo"><span>Loja</span><select value={d.lojaOrigem} onChange={campo("lojaOrigem")}><option value="">(sem loja)</option>{lojas.map((l) => <option key={l}>{l}</option>)}</select></label>
        <label className="config-campo"><span>Observação</span><input value={d.obs} onChange={campo("obs")} /></label>
      </div>
      <label className="fin-check"><input type="checkbox" checked={d.optIn} onChange={(e) => setD({ ...d, optIn: e.target.checked })} /> Aceitou receber mensagens no WhatsApp</label>
      <div className="config-acoes">
        <button className="mini" disabled={!d.nome.trim()} onClick={() => salvar(d)}>Salvar</button>
        <button className="link" onClick={cancelar}>cancelar</button>
      </div>
    </div>
  );
}

function NovaCliente({ lojas, fechar, aoSalvar }: { lojas: string[]; fechar: () => void; aoSalvar: (id: string) => Promise<void> }) {
  const [erro, setErro] = useState("");
  return (
    <Janela titulo="Nova cliente" fechar={fechar}>
      <FormCliente
        lojas={lojas}
        cancelar={fechar}
        salvar={async (d) => {
          try {
            const r = await api<{ cliente: ClienteResumo }>("/api/crm/clientes", { method: "POST", body: JSON.stringify(d) });
            await aoSalvar(r.cliente.id);
          } catch (e) {
            setErro(e instanceof Error ? e.message : "Erro");
          }
        }}
      />
      {erro && <div className="login-error">{erro}</div>}
    </Janela>
  );
}

function MensagemSegmento({ segmento, nome, loja, total, fechar, aoEnviar }: { segmento: string; nome: string; loja: string; total: number; fechar: () => void; aoEnviar: () => Promise<void> }) {
  const [texto, setTexto] = useState("");
  const [limite, setLimite] = useState(String(Math.min(total, 100)));
  const [res, setRes] = useState("");
  const [erro, setErro] = useState("");
  return (
    <Janela titulo={`Mensagem para: ${nome}`} fechar={fechar}>
      <div className="muted" style={{ marginBottom: 10 }}>
        {total} clientes no segmento{loja ? ` (loja ${loja})` : ""}. Quem está sem aceite, pediu para não receber ou não respondeu às últimas campanhas fica de fora. Use {"{primeiro}"}, {"{nome}"} e {"{loja}"} no texto.
      </div>
      <label className="config-campo"><span>Texto</span><textarea className="crm-textarea" rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} /></label>
      <div className="config-acoes">
        <label className="config-campo" style={{ margin: 0 }}><span>Máximo de clientes</span><input value={limite} onChange={(e) => setLimite(e.target.value)} style={{ width: 100 }} /></label>
        <button
          className="mini"
          disabled={!texto.trim()}
          onClick={async () => {
            setErro("");
            try {
              const r = await api<{ enfileiradas: number; puladas: Record<string, number> }>("/api/crm/mensagens", { method: "POST", body: JSON.stringify({ acao: "avulsa", segmento, loja: loja || undefined, texto, limite: Number(limite) || 100 }) });
              const puladas = Object.entries(r.puladas).map(([k, v]) => `${v}× ${k}`).join(", ");
              setRes(`${r.enfileiradas} entraram na fila.${puladas ? ` Puladas: ${puladas}.` : ""}`);
              await aoEnviar();
            } catch (e) {
              setErro(e instanceof Error ? e.message : "Erro");
            }
          }}
        >
          Colocar na fila
        </button>
      </div>
      {res && <div className="crm-aviso">{res}</div>}
      {erro && <div className="login-error">{erro}</div>}
    </Janela>
  );
}
