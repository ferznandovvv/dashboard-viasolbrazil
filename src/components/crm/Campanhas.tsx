"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CampanhaManual, FaixaCliente, FiltroCampanha } from "@/lib/crm/tipos";
import type { Previa, ResultadoCampanha } from "@/lib/crm/campanhas";
import { api, brl, dataHora } from "./comum";
import { Chips, SeletorFaixas } from "./faixa";
import { Mensagens } from "./Mensagens";
import { Abas } from "@/components/Abas";

interface Lista {
  manuais: (CampanhaManual & { resultado: ResultadoCampanha })[];
  automaticas: { id: string; nome: string; dica: string; ativa: boolean; resultado: ResultadoCampanha }[];
  modoSombra: boolean;
  envioInicio: number;
  envioFim: number;
  envioDias: number[];
  intervaloMinSeg: number;
}

/** Ponto de partida: público + texto prontos, pra ajustar. */
interface Ideia {
  id: string;
  titulo: string;
  porque: string;
  filtro: Partial<FiltroCampanha>;
  texto: string;
  oferta?: string;
}

const IDEIAS: Ideia[] = [
  {
    id: "boas-paradas",
    titulo: "Boas clientes sumidas",
    porque: "Ouro e Prata que não compram há 60 dias. É onde uma mensagem pessoal mais traz de volta.",
    filtro: { faixas: ["Ouro", "Prata"], semComprarDias: 60, limite: 50 },
    texto: "Oi {primeiro}, aqui é a {vendedora}, da Via Sol {loja} ☀️ Faz um tempinho que você não aparece e chegou coleção nova com a sua cara. Quer que eu te mande umas fotos?",
  },
  {
    id: "cashback-parado",
    titulo: "Cashback esquecido",
    porque: "Quem tem crédito pra usar. O motivo pra voltar já está pronto, só falta lembrar.",
    filtro: { comSaldo: true, limite: 50 },
    texto: "Oi {primeiro}! {vendedora} da Via Sol {loja} aqui 🧡 Você tem {valor} de cashback guardado no seu nome, válido até {validade}. Quer que eu separe umas peças do seu tamanho pra você usar?",
  },
  {
    id: "segunda-compra",
    titulo: "Segunda compra",
    porque: "Compraram uma vez nos últimos 6 meses e não voltaram há 30 dias. A segunda compra é a que mais segura cliente.",
    filtro: { faixas: ["Nova"], semComprarDias: 30, limite: 50 },
    texto: "Oi {primeiro}, é a {vendedora}, da Via Sol {loja} ☀️ Como ficaram as peças que você levou? Chegaram novidades que combinam com elas, posso te mostrar?",
  },
  {
    id: "lancamento",
    titulo: "Lançamento de coleção",
    porque: "Quem comprou nos últimos 6 meses: a base mais quente pra novidade.",
    filtro: { compraramDias: 180, limite: 50 },
    texto: "{primeiro}, aqui é a {vendedora}, da Via Sol {loja} ☀️ A coleção nova acabou de chegar na loja e eu lembrei de você. Quer que eu te mande as fotos antes de postar?",
  },
];

const FILTRO_VAZIO: FiltroCampanha = { lojas: [], faixas: [], limite: 50 };
const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const pctTxt = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const n = (v: number) => v.toLocaleString("pt-BR");

/** Campanhas: ideias prontas, as feitas à mão com o resultado, as automáticas e a fila de envio. */
export function Campanhas({ lojas, filtroInicial, limparFiltroInicial, irPara, recarregar }: { lojas: string[]; filtroInicial?: Partial<FiltroCampanha>; limparFiltroInicial: () => void; irPara: (aba: "configurar") => void; recarregar: () => Promise<void> }) {
  const [d, setD] = useState<Lista | null>(null);
  const [vista, setVista] = useState<"campanhas" | "fila">("campanhas");
  const [nova, setNova] = useState<{ filtro: Partial<FiltroCampanha>; texto?: string; oferta?: string; nome?: string } | null>(filtroInicial ? { filtro: filtroInicial } : null);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => setD(await api<Lista>("/api/crm/campanhas")), []);
  useEffect(() => {
    carregar().catch(() => {});
    const t = setInterval(() => carregar().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => {
    if (filtroInicial) setNova({ filtro: filtroInicial });
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
      <div className="cp-barra">
        <Abas
          className="seg"
          rotulo="Campanhas"
          abas={[
            { id: "campanhas", nome: "Campanhas" },
            { id: "fila", nome: "Fila de envio" },
          ]}
          atual={vista}
          aoMudar={setVista}
        />
        <span style={{ flex: 1 }} />
        {vista === "campanhas" && (
          <button className="mini" onClick={() => setNova({ filtro: {} })}>
            Nova campanha em branco
          </button>
        )}
      </div>
      {d.modoSombra && (
        <div className="cp-sombra">
          <b>Modo sombra ligado.</b> Dá pra montar e criar campanhas, mas as mensagens ficam simuladas e nenhuma sai. Bom pra ensaiar o texto e ver quem receberia.
        </div>
      )}
      {aviso && <div className="crm-aviso">{aviso}</div>}

      {vista === "fila" ? (
        <Mensagens recarregar={recarregar} />
      ) : (
        <>
          <section className="cp-ideias">
            <h2 className="cp-titulo">Começar por uma ideia</h2>
            <div className="cp-ideias-grade">
              {IDEIAS.map((i) => (
                <CartaoIdeia key={i.id} ideia={i} abrir={() => setNova({ filtro: i.filtro, texto: i.texto, oferta: i.oferta, nome: i.titulo })} />
              ))}
            </div>
          </section>

          {d.manuais.length > 0 && (
            <section>
              <h2 className="cp-titulo">Suas campanhas</h2>
              <div className="cp-lista">
                {d.manuais.map((c) => (
                  <CartaoCampanha key={c.id} c={c} aoMudar={carregar} />
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <div className="fin-cab">
              <h2>Automáticas nos últimos 30 dias</h2>
              <button className="link" onClick={() => irPara("configurar")}>
                regras e textos em Configurar
              </button>
            </div>
            <div className="cp-auto">
              {d.automaticas.map((a) => (
                <div key={a.id} className={`cp-auto-linha ${a.ativa ? "" : "off"}`}>
                  <div>
                    <div className="fin-desc">
                      {a.nome} {!a.ativa && <span className="badge">desligada</span>}
                    </div>
                    <div className="fin-sub">{a.dica}</div>
                  </div>
                  <Funil r={a.resultado} compacto />
                </div>
              ))}
            </div>
            <div className="muted cp-nota">&quot;Compraram&quot; conta quem comprou em até 14 dias depois da mensagem. Mostra para onde olhar, mas não prova que a compra veio da mensagem.</div>
          </section>
        </>
      )}
    </div>
  );
}

function CartaoIdeia({ ideia, abrir }: { ideia: Ideia; abrir: () => void }) {
  const [p, setP] = useState<Previa | null>(null);
  useEffect(() => {
    api<Previa>("/api/crm/campanhas", { method: "POST", body: JSON.stringify({ acao: "previa", filtro: { ...FILTRO_VAZIO, ...ideia.filtro, limite: undefined } }) })
      .then(setP)
      .catch(() => {});
  }, [ideia]);
  return (
    <button className="cp-ideia" onClick={abrir}>
      <span className="cp-ideia-n">{p ? n(p.noFiltro) : "…"}</span>
      <span className="cp-ideia-sub">{p ? `clientes · ${n(p.podem)} podem receber hoje` : "contando"}</span>
      <span className="cp-ideia-titulo">{ideia.titulo}</span>
      <span className="cp-ideia-porque">{ideia.porque}</span>
      <span className="cp-ideia-acao">Montar campanha</span>
    </button>
  );
}

/** Do envio à compra: cada etapa como barra proporcional ao que foi enviado. */
function Funil({ r, compacto }: { r: ResultadoCampanha; compacto?: boolean }) {
  if (!r.enviadas)
    return <div className="cp-funil-vazio muted">{r.simuladas ? `${n(r.simuladas)} simuladas, nada enviado` : r.fila ? `${n(r.fila)} na fila` : "nada enviado"}</div>;
  const etapas: [string, number][] = [
    ["Enviadas", r.enviadas],
    ["Entregues", r.entregues],
    ["Lidas", r.lidas],
    ["Responderam", r.respondidas],
    ["Compraram", r.compraram],
  ];
  return (
    <div className={`cp-funil ${compacto ? "compacto" : ""}`}>
      {etapas.map(([nome, v]) => (
        <div key={nome} className="cp-funil-etapa" title={`${nome}: ${v} (${pctTxt(v, r.enviadas)})`}>
          <span className="cp-funil-rot">{nome}</span>
          <span className="cp-funil-barra">
            <i style={{ width: `${Math.max(v ? 2 : 0, (v / r.enviadas) * 100)}%` }} />
          </span>
          <span className="cp-funil-v">
            {n(v)}
            {nome !== "Enviadas" && <small>{pctTxt(v, r.enviadas)}</small>}
          </span>
        </div>
      ))}
      {!compacto && (r.receita > 0 || r.sair > 0) && (
        <div className="cp-funil-extra">
          {r.receita > 0 && <span>{brl.format(r.receita)} em compras</span>}
          {r.sair > 0 && <span className="ruim">{r.sair} pediram pra sair</span>}
        </div>
      )}
    </div>
  );
}

function resumoFiltro(f: FiltroCampanha): string {
  const p: string[] = [];
  p.push(f.lojas.length ? f.lojas.join(", ") : "todas as lojas");
  if (f.faixas.length) p.push(f.faixas.join(" e "));
  if (f.semComprarDias) p.push(`sem comprar há ${f.semComprarDias}+ dias`);
  if (f.compraramDias) p.push(`compraram nos últimos ${f.compraramDias} dias`);
  if (f.gastoMinimo) p.push(`gastaram ${brl.format(f.gastoMinimo)}+`);
  if (f.comSaldo) p.push("com cashback");
  if (f.aniversariantes) p.push("aniversariantes");
  return p.join(", ");
}

function CartaoCampanha({ c, aoMudar }: { c: CampanhaManual & { resultado: ResultadoCampanha }; aoMudar: () => Promise<void> }) {
  const r = c.resultado;
  const total = r.total || c.total;
  const feitas = r.enviadas + r.erros;
  const estado = c.canceladaEm ? "parada" : c.simulada ? "simulada" : r.fila ? "mandando" : "concluída";
  return (
    <article className={`card cp-cartao est-${estado.replace("í", "i")}`}>
      <div className="cp-cartao-cab">
        <div>
          <h3>{c.nome}</h3>
          <div className="fin-sub">
            {resumoFiltro(c.filtro)}
            {c.oferta ? `. Oferta: ${c.oferta}` : ""}
          </div>
        </div>
        <span className="cp-estado">{estado === "mandando" && r.proxima ? `mandando, próxima ${hora(new Date(r.proxima))}` : estado}</span>
      </div>
      <div className="cp-andamento">
        <div className="pg-progresso">
          <i style={{ width: `${total ? ((c.simulada ? r.simuladas : feitas) / total) * 100 : 0}%` }} />
        </div>
        <span className="fin-sub">
          {c.simulada ? `${n(r.simuladas)} simuladas` : `${n(r.enviadas)} de ${n(total)} enviadas`}
          {r.erros ? `, ${r.erros} com erro` : ""}
          {r.fila && r.ultima ? `, termina perto das ${hora(new Date(r.ultima))}` : ""}. Criada {dataHora(c.criadaEm)}.
        </span>
      </div>
      <Funil r={r} />
      {c.oferta && r.enviadas > 0 && <div className="fin-sub">{r.codigosUsados} usaram o código</div>}
      {(r.fila > 0 || (c.simulada && r.simuladas > 0)) && !c.canceladaEm && (
        <div className="config-acoes">
          <button
            className="mini ghost fin-excluir"
            onClick={async () => {
              if (!confirm(`${c.simulada ? "Apagar a simulação" : "Parar o que ainda não saiu"} da campanha "${c.nome}"?`)) return;
              await api("/api/crm/campanhas", { method: "POST", body: JSON.stringify({ acao: "cancelar", id: c.id }) });
              await aoMudar();
            }}
          >
            {c.simulada ? "Apagar simulação" : "Parar campanha"}
          </button>
        </div>
      )}
    </article>
  );
}

const VARIAVEIS: [string, string][] = [
  ["{primeiro}", "Primeiro nome"],
  ["{vendedora}", "Quem assina"],
  ["{loja}", "Loja dela"],
  ["{valor}", "Saldo de cashback"],
  ["{validade}", "Vencimento do cashback"],
  ["{oferta}", "A oferta"],
  ["{codigo}", "Código da oferta"],
];

const DURACOES = [60, 90, 120, 180, 240];

function NovaCampanha({ lojas, inicial, lista, cancelar, criada }: { lojas: string[]; inicial: { filtro: Partial<FiltroCampanha>; texto?: string; oferta?: string; nome?: string }; lista: Lista; cancelar: () => void; criada: (msg: string) => Promise<void> }) {
  const [filtro, setFiltro] = useState<FiltroCampanha>({ ...FILTRO_VAZIO, ...inicial.filtro });
  const [nome, setNome] = useState(inicial.nome ?? "");
  const [variacoes, setVariacoes] = useState<string[]>([inicial.texto ?? ""]);
  const [versao, setVersao] = useState(0);
  const [comOferta, setComOferta] = useState(Boolean(inicial.oferta));
  const [oferta, setOferta] = useState(inicial.oferta ?? "10% de desconto");
  const [agendar, setAgendar] = useState(false);
  const [inicio, setInicio] = useState("");
  const [duracao, setDuracao] = useState(120);
  const [prev, setPrev] = useState<Previa | null>(null);
  const [erro, setErro] = useState("");
  const [criando, setCriando] = useState(false);
  const [exemplo, setExemplo] = useState(0);
  const [verFora, setVerFora] = useState(false);
  const texto = useRef<HTMLTextAreaElement>(null);
  const ofertaUsada = comOferta ? oferta.trim() : "";

  const corpoPrevia = useMemo(() => JSON.stringify({ acao: "previa", filtro, variacoes, oferta: ofertaUsada }), [filtro, variacoes, ofertaUsada]);
  useEffect(() => {
    const t = setTimeout(() => {
      api<Previa>("/api/crm/campanhas", { method: "POST", body: corpoPrevia })
        .then((p) => {
          setPrev(p);
          setErro("");
        })
        .catch((e) => setErro(e.message));
    }, 350);
    return () => clearTimeout(t);
  }, [corpoPrevia]);

  const alternar = <T,>(l: T[], v: T) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);
  const num = (k: keyof FiltroCampanha) => (e: React.ChangeEvent<HTMLInputElement>) => setFiltro({ ...filtro, [k]: e.target.value ? Number(e.target.value) : undefined });

  // Insere a variável onde está o cursor
  const inserir = (v: string) => {
    const el = texto.current;
    const atual = variacoes[versao] ?? "";
    const pos = el?.selectionStart ?? atual.length;
    const novo = atual.slice(0, pos) + v + atual.slice(el?.selectionEnd ?? pos);
    setVariacoes(variacoes.map((t, i) => (i === versao ? novo : t)));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + v.length, pos + v.length);
    });
  };

  // Horários (SP é UTC-3 fixo)
  const comeca = agendar && inicio ? new Date(inicio) : new Date();
  const dura = Math.max(duracao, prev?.minimoMin ?? 0);
  const termina = new Date(comeca.getTime() + dura * 60000);
  const minSp = (x: Date) => {
    const t = new Date(x.getTime() - 3 * 3600000);
    return { min: t.getUTCHours() * 60 + t.getUTCMinutes(), dia: t.getUTCDay(), data: t.toISOString().slice(0, 10) };
  };
  const a0 = minSp(comeca);
  const a1 = minSp(termina);
  const ini = lista.envioInicio * 60;
  const fim = lista.envioFim * 60;
  const foraDoHorario = a0.min < ini || a1.min > fim || a0.data !== a1.data || !lista.envioDias.includes(a0.dia);

  const textos = variacoes.filter((v) => v.trim());
  const semCodigo = Boolean(ofertaUsada) && textos.some((v) => !v.includes("{codigo}"));
  const faltando = [!nome.trim() && "nome", !textos.length && "texto", !prev?.recebem && "alguém pra receber"].filter(Boolean) as string[];
  const podeCriar = !faltando.length && !semCodigo && !criando;
  const ex = prev?.exemplos.length ? prev.exemplos[exemplo % prev.exemplos.length] : null;
  const temDias = Boolean(filtro.semComprarDias || filtro.compraramDias || filtro.gastoMinimo || filtro.comSaldo || filtro.aniversariantes);

  const criar = async () => {
    if (!prev) return;
    const msg = prev.modoSombra ? `Criar em modo sombra? ${prev.recebem} mensagens ficam só simuladas, nada sai.` : `Mandar para ${prev.recebem} clientes, das ${hora(comeca)} até perto das ${hora(termina)}?`;
    if (!confirm(msg)) return;
    setErro("");
    setCriando(true);
    try {
      const c = await api<CampanhaManual>("/api/crm/campanhas", {
        method: "POST",
        body: JSON.stringify({ acao: "criar", nome, filtro, variacoes: textos, oferta: ofertaUsada, inicio: agendar && inicio ? new Date(inicio).toISOString() : undefined, duracaoMin: duracao }),
      });
      await criada(c.simulada ? `"${c.nome}" simulada: ${c.total} mensagens na Fila de envio, nenhuma sai.` : `"${c.nome}" criada: ${c.total} mensagens na fila.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    } finally {
      setCriando(false);
    }
  };

  // Linha do tempo do dia de envio
  const posicao = (m: number) => `${Math.min(100, Math.max(0, ((m - ini) / Math.max(1, fim - ini)) * 100))}%`;
  const fimNoDia = a0.data === a1.data ? a1.min : fim;

  return (
    <div className="cp-nova">
      <div className="cp-form">
        <div className="cp-nova-cab">
          <button className="link" onClick={cancelar}>
            ← campanhas
          </button>
          <input className="cp-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da campanha" aria-label="Nome da campanha" />
        </div>

        <section className="card cp-passo">
          <h2>
            <span className="cp-num">1</span> Quem recebe
          </h2>
          <div className="cl-rotulo">Loja da cliente</div>
          <Chips
            opcoes={lojas.map((l) => ({ id: l, nome: l }))}
            marcadas={filtro.lojas}
            alternar={(l) => setFiltro({ ...filtro, lojas: alternar(filtro.lojas, l) })}
            limpar={() => setFiltro({ ...filtro, lojas: [] })}
            contagens={prev?.lojas}
          />
          <div className="cl-rotulo">Faixa</div>
          <SeletorFaixas
            contagens={prev?.faixas}
            marcadas={filtro.faixas}
            alternar={(f) => setFiltro({ ...filtro, faixas: alternar<FaixaCliente>(filtro.faixas, f) })}
            limpar={() => setFiltro({ ...filtro, faixas: [] })}
            total={prev ? Object.values(prev.faixas).reduce((a, b) => a + b, 0) : undefined}
          />
          <details className="cp-mais" open={temDias}>
            <summary>Mais filtros {temDias && <span className="badge">em uso</span>}</summary>
            <div className="cp-filtros">
              <label className="cp-campo">
                <span>Sem comprar há pelo menos</span>
                <span className="cp-sufixo">
                  <input type="number" min={0} value={filtro.semComprarDias ?? ""} onChange={num("semComprarDias")} />
                  <em>dias</em>
                </span>
              </label>
              <label className="cp-campo">
                <span>Comprou nos últimos</span>
                <span className="cp-sufixo">
                  <input type="number" min={0} value={filtro.compraramDias ?? ""} onChange={num("compraramDias")} />
                  <em>dias</em>
                </span>
              </label>
              <label className="cp-campo">
                <span>Gastou no total pelo menos</span>
                <span className="cp-sufixo">
                  <em>R$</em>
                  <input type="number" min={0} value={filtro.gastoMinimo ?? ""} onChange={num("gastoMinimo")} />
                </span>
              </label>
              <label className="cp-check">
                <input type="checkbox" checked={Boolean(filtro.comSaldo)} onChange={(e) => setFiltro({ ...filtro, comSaldo: e.target.checked || undefined })} />
                Tem cashback pra usar
              </label>
              <label className="cp-check">
                <input type="checkbox" checked={Boolean(filtro.aniversariantes)} onChange={(e) => setFiltro({ ...filtro, aniversariantes: e.target.checked || undefined })} />
                Faz aniversário este mês
              </label>
            </div>
          </details>
          <div className="cp-limite">
            <span>No máximo</span>
            <div className="ux-chips">
              {[30, 50, 100, 200].map((v) => (
                <button key={v} className={filtro.limite === v ? "on" : ""} onClick={() => setFiltro({ ...filtro, limite: v })}>
                  {v}
                </button>
              ))}
              <button className={!filtro.limite ? "on" : ""} onClick={() => setFiltro({ ...filtro, limite: undefined })}>
                sem limite
              </button>
            </div>
            <span className="muted">clientes, começando pelas que mais gastaram</span>
          </div>
        </section>

        <section className="card cp-passo">
          <h2>
            <span className="cp-num">2</span> Mensagem
          </h2>
          <p className="cp-ajuda">Escreva como a vendedora escreveria pra uma cliente que conhece. Duas ou três versões diferentes ajudam: o WhatsApp vê menos mensagens iguais saindo do mesmo número.</p>
          <div className="cp-versoes" role="tablist">
            {variacoes.map((_, i) => (
              <button key={i} className={versao === i ? "on" : ""} onClick={() => setVersao(i)} role="tab" aria-selected={versao === i}>
                Versão {i + 1}
              </button>
            ))}
            {variacoes.length < 3 && (
              <button
                className="cp-versao-nova"
                onClick={() => {
                  setVariacoes([...variacoes, ""]);
                  setVersao(variacoes.length);
                }}
              >
                + versão
              </button>
            )}
            {variacoes.length > 1 && (
              <button
                className="link cp-versao-tirar"
                onClick={() => {
                  setVariacoes(variacoes.filter((_, j) => j !== versao));
                  setVersao(0);
                }}
              >
                tirar esta versão
              </button>
            )}
          </div>
          <textarea
            ref={texto}
            className="crm-textarea cp-texto"
            rows={5}
            value={variacoes[versao] ?? ""}
            onChange={(e) => setVariacoes(variacoes.map((x, j) => (j === versao ? e.target.value : x)))}
            placeholder="Oi {primeiro}, aqui é a {vendedora}, da Via Sol {loja} ☀️ ..."
          />
          <div className="cp-vars">
            <span className="muted">Inserir:</span>
            {VARIAVEIS.filter(([v]) => comOferta || (v !== "{oferta}" && v !== "{codigo}")).map(([v, rotulo]) => (
              <button key={v} onClick={() => inserir(v)} title={v}>
                {rotulo}
              </button>
            ))}
          </div>
          <label className="cp-check cp-oferta">
            <input type="checkbox" checked={comOferta} onChange={(e) => setComOferta(e.target.checked)} />
            <span>
              Incluir uma oferta com código
              <small>Cada cliente recebe um código só dela; quem usar no caixa fica registrado como vindo da campanha.</small>
            </span>
          </label>
          {comOferta && (
            <label className="cp-campo">
              <span>Oferta</span>
              <input className="crm-input" value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="10% de desconto" />
            </label>
          )}
          {semCodigo && <div className="login-error">Com oferta, todas as versões precisam ter o código. Use o botão &quot;Código da oferta&quot;.</div>}
        </section>

        <section className="card cp-passo">
          <h2>
            <span className="cp-num">3</span> Quando
          </h2>
          <div className="cp-quando">
            <div className="ux-chips">
              <button className={!agendar ? "on" : ""} onClick={() => setAgendar(false)}>
                Começar agora
              </button>
              <button className={agendar ? "on" : ""} onClick={() => setAgendar(true)}>
                Agendar
              </button>
            </div>
            {agendar && <input type="datetime-local" className="crm-input" value={inicio} onChange={(e) => setInicio(e.target.value)} />}
          </div>
          <div className="cl-rotulo">Espalhar as mensagens ao longo de</div>
          <div className="ux-chips">
            {DURACOES.map((m) => (
              <button key={m} className={duracao === m ? "on" : ""} onClick={() => setDuracao(m)}>
                {Math.floor(m / 60)}h{m % 60 ? "30" : ""}
              </button>
            ))}
          </div>
          <div className="cp-linha" aria-label="Horário de envio do dia e o trecho da campanha">
            <div className="cp-linha-dia">
              {!foraDoHorario || a0.data === a1.data ? (
                <i className={foraDoHorario ? "fora" : ""} style={{ left: posicao(a0.min), width: `calc(${posicao(fimNoDia)} - ${posicao(a0.min)})` }} />
              ) : null}
            </div>
            <div className="cp-linha-horas">
              {Array.from({ length: lista.envioFim - lista.envioInicio + 1 }, (_, i) => lista.envioInicio + i)
                .filter((h, i, arr) => i === 0 || i === arr.length - 1 || h % 2 === 0)
                .map((h) => (
                  <span key={h} style={{ left: posicao(h * 60) }}>
                    {h}h
                  </span>
                ))}
            </div>
          </div>
          <p className="cp-ajuda">
            Das {hora(comeca)} até perto das {hora(termina)}. Cada número manda as suas, uma de cada vez, com intervalos irregulares.
            {prev && prev.minimoMin > duracao && ` Leva pelo menos ${prev.minimoMin} min pelo intervalo mínimo de ${lista.intervaloMinSeg}s entre mensagens.`}
          </p>
          {foraDoHorario && <div className="cp-alerta">Parte cai fora do horário de envio ({lista.envioInicio}h às {lista.envioFim}h). O que não couber sai no próximo horário.</div>}
          {prev?.porLoja.map((l) => {
            const sobra = l.jaHoje + l.naFila + l.n - l.teto;
            return sobra > 0 && !agendar ? (
              <div key={l.loja} className="cp-alerta">
                {l.loja}: o teto é {l.teto} mensagens por dia e já tem {l.jaHoje + l.naFila} hoje. {Math.min(sobra, l.n)} ficam pra amanhã.
              </div>
            ) : null;
          })}
        </section>
      </div>

      <aside className="cp-lado">
        <div className="card cp-publico">
          <h2>Quem recebe</h2>
          {!prev ? (
            <div className="muted">Calculando…</div>
          ) : (
            <>
              <div className="cp-etapas">
                {[
                  ["No filtro", prev.noFiltro],
                  ["Podem receber", prev.podem],
                  ["Vão receber", prev.recebem],
                ].map(([rot, v], i) => (
                  <div key={rot as string} className={`cp-etapa ${i === 2 ? "fim" : ""}`}>
                    <span className="cp-etapa-rot">{rot}</span>
                    <span className="cp-etapa-barra">
                      <i style={{ width: `${prev.noFiltro ? Math.max(Number(v) ? 3 : 0, (Number(v) / prev.noFiltro) * 100) : 0}%` }} />
                    </span>
                    <span className="cp-etapa-v">{n(Number(v))}</span>
                  </div>
                ))}
              </div>
              {prev.fora.length > 0 && (
                <>
                  <button className="link cp-fora-botao" onClick={() => setVerFora(!verFora)}>
                    {verFora ? "esconder" : "por que"} {n(prev.noFiltro - prev.podem)} ficaram de fora
                  </button>
                  {verFora && (
                    <ul className="cp-fora">
                      {prev.fora.map((f) => (
                        <li key={f.motivo}>
                          <span>
                            {f.motivo}
                            {f.detalhe && <small>{f.detalhe.map((d) => `${d.loja} ${d.n}`).join(", ")}</small>}
                          </span>
                          <b>{n(f.n)}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {prev.porLoja.length > 1 && (
                <div className="cp-porloja">
                  {prev.porLoja.map((l) => (
                    <span key={l.loja}>
                      {l.loja} <b>{l.n}</b>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="cp-fone" aria-label="Como a mensagem chega">
          <div className="cp-fone-cab">
            <span className="cp-fone-av" aria-hidden>
              VS
            </span>
            <span>
              <b>Via Sol {ex?.loja ?? ""}</b>
              <small>{ex ? `para ${ex.nome.split(" ").slice(0, 2).join(" ")}` : "prévia"}</small>
            </span>
          </div>
          <div className="cp-fone-chat">
            {ex ? (
              <div className="cp-balao">
                {ex.texto}
                <span className="cp-balao-hora">{hora(comeca)} ✓✓</span>
              </div>
            ) : (
              <div className="cp-fone-vazio">{textos.length ? "Ninguém pra receber com esse filtro." : "Escreva a mensagem pra ver como ela chega."}</div>
            )}
          </div>
          {prev && prev.exemplos.length > 1 && (
            <div className="cp-fone-nav">
              <button onClick={() => setExemplo((exemplo + prev.exemplos.length - 1) % prev.exemplos.length)} aria-label="Cliente anterior">
                ‹
              </button>
              <span>
                {(exemplo % prev.exemplos.length) + 1} de {prev.exemplos.length}
              </span>
              <button onClick={() => setExemplo((exemplo + 1) % prev.exemplos.length)} aria-label="Próxima cliente">
                ›
              </button>
            </div>
          )}
        </div>

        {prev?.modoSombra && <div className="cp-sombra">Modo sombra: vai ficar só simulada.</div>}
        {erro && <div className="login-error">{erro}</div>}
        <button className="crm-btn grande" disabled={!podeCriar} onClick={criar}>
          {criando ? "Criando…" : prev?.recebem ? `Criar campanha para ${n(prev.recebem)}` : "Criar campanha"}
        </button>
        {faltando.length > 0 && <div className="fin-sub cp-falta">Falta: {faltando.join(", ")}.</div>}
      </aside>
    </div>
  );
}
