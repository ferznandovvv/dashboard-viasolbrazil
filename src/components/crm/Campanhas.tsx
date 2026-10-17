"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FAIXAS, type CampanhaManual, type FaixaCliente, type FiltroCampanha } from "@/lib/crm/tipos";
import type { Previa, ResultadoCampanha } from "@/lib/crm/campanhas";
import { api, brl, dataHora } from "./comum";

interface Lista {
  manuais: (CampanhaManual & { resultado: ResultadoCampanha })[];
  automaticas: { id: string; nome: string; dica: string; ativa: boolean; resultado: ResultadoCampanha }[];
  modoSombra: boolean;
  envioInicio: number;
  envioFim: number;
  envioDias: number[];
  intervaloMinSeg: number;
}

const FILTRO_VAZIO: FiltroCampanha = { lojas: [], faixas: [], limite: 50 };
const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

/** Campanhas feitas à mão (público, texto, ritmo) e o resultado das automáticas. */
export function Campanhas({ lojas, filtroInicial, limparFiltroInicial, irPara }: { lojas: string[]; filtroInicial?: Partial<FiltroCampanha>; limparFiltroInicial: () => void; irPara: (aba: "configurar" | "mensagens") => void }) {
  const [d, setD] = useState<Lista | null>(null);
  const [nova, setNova] = useState<Partial<FiltroCampanha> | null>(filtroInicial ?? null);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => setD(await api<Lista>("/api/crm/campanhas")), []);
  useEffect(() => {
    carregar().catch(() => {});
    const t = setInterval(() => carregar().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => {
    if (filtroInicial) setNova(filtroInicial);
  }, [filtroInicial]);

  if (!d) return <div className="empty">Carregando…</div>;

  if (nova)
    return (
      <NovaCampanha
        lojas={lojas}
        inicial={nova}
        lista={d}
        cancelar={() => {
          setNova(null);
          limparFiltroInicial();
        }}
        criada={async (msg) => {
          setNova(null);
          limparFiltroInicial();
          setAviso(msg);
          await carregar();
        }}
      />
    );

  return (
    <div>
      <div className="fin-barra">
        <button className="mini" onClick={() => setNova({})}>
          Nova campanha
        </button>
        <span style={{ flex: 1 }} />
        {d.modoSombra && <span className="badge">modo sombra: campanhas ficam só simuladas</span>}
      </div>
      {aviso && <div className="crm-aviso">{aviso}</div>}

      {!d.manuais.length ? (
        <div className="card">
          <h2>Nenhuma campanha ainda</h2>
          <div className="muted">
            Uma campanha é uma mensagem para um grupo escolhido: por exemplo, clientes Ouro do Centro que não compram há 60 dias. Você vê quem recebe antes de mandar, e as mensagens saem espalhadas no tempo, uma de cada vez, pelo número da loja de cada cliente.
          </div>
        </div>
      ) : (
        <div className="cp-lista">
          {d.manuais.map((c) => (
            <CartaoCampanha key={c.id} c={c} aoMudar={carregar} />
          ))}
        </div>
      )}

      <div className="card">
        <div className="fin-cab">
          <h2>Automáticas · últimos 30 dias</h2>
          <button className="link" onClick={() => irPara("configurar")}>
            regras e textos em Configurar
          </button>
        </div>
        <div className="tbl-wrap">
          <table className="prod-tbl fin-tbl">
            <thead>
              <tr>
                <th>Automação</th>
                <th className="n">Geradas</th>
                <th className="n">Enviadas</th>
                <th className="n">Lidas</th>
                <th className="n">Respondidas</th>
                <th className="n">Compraram em 14 dias</th>
                <th className="n">Receita</th>
              </tr>
            </thead>
            <tbody>
              {d.automaticas.map((a) => (
                <tr key={a.id} className={a.ativa ? "" : "cp-desligada"}>
                  <td>
                    <div className="fin-desc">
                      {a.nome} {!a.ativa && <span className="badge">desligada</span>}
                    </div>
                    <div className="fin-sub">{a.dica}</div>
                  </td>
                  <td className="n">{a.resultado.total || ""}</td>
                  <td className="n">{a.resultado.enviadas || ""}</td>
                  <td className="n">{a.resultado.enviadas ? pct(a.resultado.lidas, a.resultado.enviadas) : ""}</td>
                  <td className="n">{a.resultado.enviadas ? pct(a.resultado.respondidas, a.resultado.enviadas) : ""}</td>
                  <td className="n">{a.resultado.compraram || ""}</td>
                  <td className="n">{a.resultado.receita ? brl.format(a.resultado.receita) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          &quot;Compraram em 14 dias&quot; conta quem comprou depois da mensagem; não prova que foi por causa dela, mas é o melhor sinal que dá pra ter sem grupo de controle.
        </div>
      </div>
    </div>
  );
}

function resumoFiltro(f: FiltroCampanha): string {
  const p: string[] = [];
  p.push(f.lojas.length ? f.lojas.join(", ") : "todas as lojas");
  if (f.faixas.length) p.push(f.faixas.join(" + "));
  if (f.semComprarDias) p.push(`sem comprar há ${f.semComprarDias}+ dias`);
  if (f.compraramDias) p.push(`compraram nos últimos ${f.compraramDias} dias`);
  if (f.gastoMinimo) p.push(`gastaram ${brl.format(f.gastoMinimo)}+`);
  if (f.comSaldo) p.push("com cashback");
  if (f.aniversariantes) p.push("aniversariantes do mês");
  return p.join(" · ");
}

function CartaoCampanha({ c, aoMudar }: { c: CampanhaManual & { resultado: ResultadoCampanha }; aoMudar: () => Promise<void> }) {
  const r = c.resultado;
  const total = r.total || c.total;
  const feitas = r.enviadas + r.erros;
  const situacao = c.canceladaEm
    ? "cancelada"
    : c.simulada
      ? "simulada (modo sombra)"
      : r.fila
        ? r.proxima && r.proxima > new Date().toISOString()
          ? `mandando · próxima às ${hora(new Date(r.proxima))}`
          : "mandando"
        : "concluída";
  return (
    <div className="card cp-cartao">
      <div className="fin-cab">
        <div>
          <h2>{c.nome}</h2>
          <div className="fin-sub">
            {resumoFiltro(c.filtro)} · criada {dataHora(c.criadaEm)}
            {c.oferta ? ` · oferta: ${c.oferta}` : ""}
          </div>
        </div>
        <span className={`badge ${situacao.startsWith("mandando") ? "on" : ""}`}>{situacao}</span>
      </div>
      <div className="pg-progresso cp-progresso">
        <i style={{ width: `${total ? (feitas / total) * 100 : 0}%` }} />
      </div>
      <div className="fin-sub" style={{ marginTop: 4 }}>
        {c.simulada ? `${r.simuladas} simuladas` : `${r.enviadas} de ${total} enviadas`}
        {r.erros ? ` · ${r.erros} com erro` : ""}
        {r.fila && r.ultima ? ` · última prevista às ${hora(new Date(r.ultima))}` : ""}
      </div>
      {r.enviadas > 0 && (
        <div className="pg-mini cp-numeros">
          <div>
            <b>{pct(r.entregues, r.enviadas)}</b>
            <small>entregues</small>
          </div>
          <div>
            <b>{pct(r.lidas, r.enviadas)}</b>
            <small>lidas</small>
          </div>
          <div>
            <b>{r.respondidas}</b>
            <small>responderam</small>
          </div>
          <div className={r.sair ? "ruim" : ""}>
            <b>{r.sair}</b>
            <small>pediram pra sair</small>
          </div>
          <div>
            <b>{r.compraram}</b>
            <small>compraram em 14 dias{r.receita ? ` · ${brl.format(r.receita)}` : ""}</small>
          </div>
          {c.oferta && (
            <div>
              <b>{r.codigosUsados}</b>
              <small>usaram o código</small>
            </div>
          )}
        </div>
      )}
      {(r.fila > 0 || (c.simulada && r.simuladas > 0)) && !c.canceladaEm && (
        <div className="config-acoes" style={{ marginTop: 10 }}>
          <button
            className="mini ghost fin-excluir"
            onClick={async () => {
              if (!confirm(`Cancelar o que ainda não saiu da campanha "${c.nome}"?`)) return;
              await api("/api/crm/campanhas", { method: "POST", body: JSON.stringify({ acao: "cancelar", id: c.id }) });
              await aoMudar();
            }}
          >
            {c.simulada ? "Apagar simulação" : "Parar campanha"}
          </button>
        </div>
      )}
    </div>
  );
}

const VARIAVEIS: [string, string][] = [
  ["{primeiro}", "primeiro nome"],
  ["{vendedora}", "quem assina (da loja)"],
  ["{loja}", "loja dela"],
  ["{valor}", "saldo de cashback"],
  ["{validade}", "quando o cashback vence"],
  ["{oferta}", "a oferta"],
  ["{codigo}", "código único"],
];

function NovaCampanha({ lojas, inicial, lista, cancelar, criada }: { lojas: string[]; inicial: Partial<FiltroCampanha>; lista: Lista; cancelar: () => void; criada: (msg: string) => Promise<void> }) {
  const [filtro, setFiltro] = useState<FiltroCampanha>({ ...FILTRO_VAZIO, ...inicial });
  const [nome, setNome] = useState("");
  const [variacoes, setVariacoes] = useState<string[]>([""]);
  const [oferta, setOferta] = useState("");
  const [agendar, setAgendar] = useState(false);
  const [inicio, setInicio] = useState("");
  const [duracao, setDuracao] = useState(120);
  const [prev, setPrev] = useState<Previa | null>(null);
  const [erro, setErro] = useState("");
  const [criando, setCriando] = useState(false);
  const [foco, setFoco] = useState(0);
  const [maisFiltros, setMaisFiltros] = useState(Boolean(inicial.semComprarDias || inicial.compraramDias || inicial.gastoMinimo || inicial.comSaldo || inicial.aniversariantes));

  const corpoPrevia = useMemo(() => JSON.stringify({ acao: "previa", filtro, variacoes, oferta }), [filtro, variacoes, oferta]);
  useEffect(() => {
    const t = setTimeout(() => {
      api<Previa>("/api/crm/campanhas", { method: "POST", body: corpoPrevia })
        .then(setPrev)
        .catch((e) => setErro(e.message));
    }, 350);
    return () => clearTimeout(t);
  }, [corpoPrevia]);

  const alternar = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  const num = (k: keyof FiltroCampanha) => (e: React.ChangeEvent<HTMLInputElement>) => setFiltro({ ...filtro, [k]: e.target.value ? Number(e.target.value) : undefined });
  const inserir = (v: string) => setVariacoes(variacoes.map((t, i) => (i === foco ? `${t}${t && !t.endsWith(" ") ? " " : ""}${v}` : t)));

  // Quando começa e quando termina, e se cai fora do horário de envio
  const comeca = agendar && inicio ? new Date(inicio) : new Date();
  const dura = Math.max(duracao, prev?.minimoMin ?? 0);
  const termina = new Date(comeca.getTime() + dura * 60000);
  const partesSp = (x: Date) => {
    const t = new Date(x.getTime() - 3 * 3600000); // SP é UTC-3 fixo
    return { min: t.getUTCHours() * 60 + t.getUTCMinutes(), dia: t.getUTCDay(), data: t.toISOString().slice(0, 10) };
  };
  const a0 = partesSp(comeca);
  const a1 = partesSp(termina);
  const foraDoHorario = a0.min < lista.envioInicio * 60 || a1.min > lista.envioFim * 60 || a0.data !== a1.data || !lista.envioDias.includes(a0.dia);
  const semCodigo = Boolean(oferta.trim()) && variacoes.some((v) => v.trim() && !v.includes("{codigo}"));
  const textos = variacoes.filter((v) => v.trim());
  const podeCriar = Boolean(nome.trim() && textos.length && prev?.recebem && !semCodigo && !criando);

  const criar = async () => {
    if (!prev) return;
    const msg = prev.modoSombra
      ? `Criar a campanha em modo sombra? ${prev.recebem} mensagens ficam só simuladas, nada sai.`
      : `Mandar para ${prev.recebem} clientes, das ${hora(comeca)} às ${hora(termina)}?`;
    if (!confirm(msg)) return;
    setErro("");
    setCriando(true);
    try {
      const c = await api<CampanhaManual>("/api/crm/campanhas", {
        method: "POST",
        body: JSON.stringify({ acao: "criar", nome, filtro, variacoes: textos, oferta, inicio: agendar && inicio ? new Date(inicio).toISOString() : undefined, duracaoMin: duracao }),
      });
      await criada(c.simulada ? `Campanha "${c.nome}" simulada: ${c.total} mensagens em Mensagens, nada sai.` : `Campanha "${c.nome}" criada: ${c.total} mensagens na fila.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    } finally {
      setCriando(false);
    }
  };

  return (
    <div className="cp-nova">
      <div className="cp-form">
        <section className="card">
          <div className="fin-cab">
            <h2>Nova campanha</h2>
            <button className="link" onClick={cancelar}>
              voltar
            </button>
          </div>
          <label className="config-campo">
            <span>Nome (só pra você)</span>
            <input className="crm-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ouro do Centro, coleção nova" />
          </label>
        </section>

        <section className="card">
          <h2>Quem recebe</h2>
          <div className="crm-h3">Loja da cliente</div>
          <div className="cp-chips">
            <button className={!filtro.lojas.length ? "on" : ""} onClick={() => setFiltro({ ...filtro, lojas: [] })}>
              Todas
            </button>
            {lojas.map((l) => (
              <button key={l} className={filtro.lojas.includes(l) ? "on" : ""} onClick={() => setFiltro({ ...filtro, lojas: alternar(filtro.lojas, l) })}>
                {l}
              </button>
            ))}
          </div>
          <div className="crm-h3">Faixa</div>
          <div className="cp-chips">
            <button className={!filtro.faixas.length ? "on" : ""} onClick={() => setFiltro({ ...filtro, faixas: [] })}>
              Todas
            </button>
            {FAIXAS.map((f) => (
              <button key={f.id} title={f.dica} className={filtro.faixas.includes(f.id) ? "on" : ""} onClick={() => setFiltro({ ...filtro, faixas: alternar<FaixaCliente>(filtro.faixas, f.id) })}>
                {f.id} {prev && <small>{prev.faixas[f.id]}</small>}
              </button>
            ))}
          </div>
          <div className="fin-sub" style={{ marginTop: 6 }}>
            {filtro.faixas.length ? filtro.faixas.map((f) => `${f}: ${FAIXAS.find((x) => x.id === f)?.dica}`).join(" · ") : "Ouro: 3+ compras ou R$ 1.500+ no último ano. Passe o mouse em cada faixa pra ver a regra."}
          </div>

          {!maisFiltros ? (
            <button className="link" style={{ marginTop: 10 }} onClick={() => setMaisFiltros(true)}>
              mais filtros…
            </button>
          ) : (
            <div className="cp-filtros">
              <label className="config-campo">
                <span>Sem comprar há pelo menos (dias)</span>
                <input className="crm-input" type="number" min={0} value={filtro.semComprarDias ?? ""} onChange={num("semComprarDias")} />
              </label>
              <label className="config-campo">
                <span>Compraram nos últimos (dias)</span>
                <input className="crm-input" type="number" min={0} value={filtro.compraramDias ?? ""} onChange={num("compraramDias")} />
              </label>
              <label className="config-campo">
                <span>Gastaram no total pelo menos (R$)</span>
                <input className="crm-input" type="number" min={0} value={filtro.gastoMinimo ?? ""} onChange={num("gastoMinimo")} />
              </label>
              <label className="cfg-check">
                <input type="checkbox" checked={Boolean(filtro.comSaldo)} onChange={(e) => setFiltro({ ...filtro, comSaldo: e.target.checked || undefined })} />
                <span>Só quem tem cashback pra usar</span>
              </label>
              <label className="cfg-check">
                <input type="checkbox" checked={Boolean(filtro.aniversariantes)} onChange={(e) => setFiltro({ ...filtro, aniversariantes: e.target.checked || undefined })} />
                <span>Só aniversariantes do mês</span>
              </label>
            </div>
          )}
          <label className="config-campo" style={{ marginTop: 10 }}>
            <span>No máximo quantas clientes (as que mais gastaram primeiro)</span>
            <input className="crm-input" type="number" min={1} style={{ width: 120 }} value={filtro.limite ?? ""} onChange={num("limite")} />
          </label>
        </section>

        <section className="card">
          <h2>Mensagem</h2>
          <div className="muted" style={{ marginBottom: 8, fontSize: 12.5 }}>
            Escreva como a vendedora escreveria. Com 2 ou 3 versões, cada cliente recebe uma sorteada: o WhatsApp vê menos mensagens iguais saindo do mesmo número.
          </div>
          {variacoes.map((v, i) => (
            <div key={i} className="cp-variacao">
              <textarea
                className="crm-textarea"
                rows={4}
                value={v}
                onFocus={() => setFoco(i)}
                onChange={(e) => setVariacoes(variacoes.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={i === 0 ? "Oi {primeiro}, aqui é a {vendedora}, da Via Sol {loja} ☀️ Chegou a coleção nova e separei umas peças com a sua cara. Quer que eu te mande fotos?" : "Outra versão (opcional)"}
              />
              {variacoes.length > 1 && (
                <button className="link" onClick={() => setVariacoes(variacoes.filter((_, j) => j !== i))}>
                  tirar
                </button>
              )}
            </div>
          ))}
          {variacoes.length < 3 && (
            <button className="link" onClick={() => setVariacoes([...variacoes, ""])}>
              + outra versão
            </button>
          )}
          <div className="cp-vars">
            {VARIAVEIS.map(([v, dica]) => (
              <button key={v} title={dica} onClick={() => inserir(v)}>
                {v}
              </button>
            ))}
          </div>
          <label className="config-campo" style={{ marginTop: 12 }}>
            <span>Oferta (opcional): cada cliente ganha um código único pra usar no caixa, e dá pra saber quem veio pela campanha</span>
            <input className="crm-input" value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="10% de desconto" />
          </label>
          {semCodigo && <div className="login-error">Com oferta, todo texto precisa ter {"{codigo}"}.</div>}
        </section>

        <section className="card">
          <h2>Quando</h2>
          <div className="cp-chips">
            <button className={!agendar ? "on" : ""} onClick={() => setAgendar(false)}>
              Começar agora
            </button>
            <button className={agendar ? "on" : ""} onClick={() => setAgendar(true)}>
              Agendar
            </button>
            {agendar && <input type="datetime-local" className="crm-input" value={inicio} onChange={(e) => setInicio(e.target.value)} style={{ width: "auto" }} />}
          </div>
          <div className="crm-h3">Espalhar as mensagens em</div>
          <div className="cp-chips">
            {[60, 90, 120, 180, 240].map((m) => (
              <button key={m} className={duracao === m ? "on" : ""} onClick={() => setDuracao(m)}>
                {m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? "30" : ""}`}
              </button>
            ))}
          </div>
          <div className="fin-sub" style={{ marginTop: 8 }}>
            Cada número manda as suas, uma de cada vez, com intervalos irregulares. Das {hora(comeca)} até mais ou menos {hora(termina)}.
            {prev && prev.minimoMin > duracao && ` Leva pelo menos ${prev.minimoMin} min por causa do intervalo mínimo de ${lista.intervaloMinSeg}s entre mensagens.`}
          </div>
          {foraDoHorario && (
            <div className="login-error" style={{ marginTop: 8 }}>
              Parte disso cai fora do horário de envio ({lista.envioInicio}h às {lista.envioFim}h, nos dias configurados). O que não couber sai no próximo horário de envio.
            </div>
          )}
        </section>
      </div>

      <aside className="cp-previa">
        <div className="card">
          <h2>Quem recebe</h2>
          {!prev ? (
            <div className="muted">Calculando…</div>
          ) : (
            <>
              <div className="cp-total">
                <b>{prev.recebem}</b> <span>de {prev.noFiltro} no filtro</span>
              </div>
              {prev.modoSombra && <div className="badge" style={{ marginBottom: 8 }}>modo sombra: vai ficar só simulada</div>}
              {Object.keys(prev.puladas).length > 0 && (
                <ul className="cp-puladas">
                  {Object.entries(prev.puladas)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <li key={k}>
                        <span>{k}</span>
                        <b>{v}</b>
                      </li>
                    ))}
                </ul>
              )}
              {prev.porLoja.length > 0 && (
                <>
                  <div className="crm-h3">Por número</div>
                  {prev.porLoja.map((l) => {
                    const sobra = l.jaHoje + l.naFila + l.n - l.teto;
                    return (
                      <div key={l.loja} className="cp-num">
                        <span>{l.loja}</span>
                        <span>
                          <b>{l.n}</b>
                          {sobra > 0 && !agendar && (
                            <small className="ruim">
                              {" "}
                              teto {l.teto}/dia: {Math.min(sobra, l.n)} ficam pra amanhã
                            </small>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
              {prev.amostra.length > 0 && (
                <>
                  <div className="crm-h3">Primeiras da lista</div>
                  {prev.amostra.map((a) => (
                    <div key={a.nome + a.total} className="cp-num">
                      <span>
                        {a.nome}
                        <small className="muted"> {a.faixa}</small>
                      </span>
                      <span className="muted">{brl.format(a.total)}</span>
                    </div>
                  ))}
                </>
              )}
              {prev.exemplo && (
                <>
                  <div className="crm-h3">Como chega</div>
                  <div className="crm-balao nossa cp-exemplo">{prev.exemplo}</div>
                </>
              )}
            </>
          )}
          {erro && <div className="login-error">{erro}</div>}
          <button className="crm-btn grande" disabled={!podeCriar} onClick={criar}>
            {criando ? "Criando…" : prev?.recebem ? `Criar campanha (${prev.recebem})` : "Criar campanha"}
          </button>
          {!nome.trim() && <div className="fin-sub">Falta o nome.</div>}
          {!textos.length && <div className="fin-sub">Falta o texto.</div>}
        </div>
      </aside>
    </div>
  );
}
