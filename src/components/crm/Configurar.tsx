"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConfigCrm, Modelo, NumeroWhatsapp } from "@/lib/crm/tipos";
import { type DadosConfig, type Resumo, api, brl } from "./comum";
import { Fontes } from "./Fontes";
import { Importar } from "./Importar";
import { WhatsAppSite } from "./WhatsAppSite";

type Secao = "cashback" | "campanhas" | "envio" | "numeros" | "site" | "modelos" | "dados" | "backup";

const SECOES: [Secao, string, string][] = [
  ["cashback", "Cashback", "Percentual, validade e a regra de uso"],
  ["campanhas", "Automações", "Lembretes, aniversário, reativação"],
  ["envio", "Envio", "Provedor, modo sombra, horário e ritmo"],
  ["numeros", "Números", "Um WhatsApp por loja"],
  ["site", "WhatsApp do site", "Número oficial, carrinho e Pix"],
  ["modelos", "Textos", "O que as mensagens dizem"],
  ["dados", "Dados", "TOTVS, Shopify e planilhas"],
  ["backup", "Backup", "Cópia da base"],
];

/** Regras do cashback, campanhas, provedor e números, ritmo de envio e textos. */
export function Configurar({ r, recarregar }: { r: Resumo; recarregar: () => Promise<void> }) {
  const [d, setD] = useState<DadosConfig | null>(null);
  const [secao, setSecao] = useState<Secao>("cashback");
  const [cfg, setCfg] = useState<ConfigCrm | null>(null);
  const [salvo, setSalvo] = useState<ConfigCrm | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const x = await api<DadosConfig>("/api/crm/config");
    setD(x);
    setCfg(x.config);
    setSalvo(x.config);
  }, []);
  useEffect(() => {
    carregar().catch((e) => setErro(e.message));
  }, [carregar]);

  const mudou = Boolean(cfg && salvo && JSON.stringify(cfg) !== JSON.stringify(salvo));

  const salvar = async (parte?: Partial<ConfigCrm>, msg = "Salvo.") => {
    if (!cfg) return;
    setErro("");
    setAviso("");
    setSalvando(true);
    try {
      await api("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "config", config: parte ?? cfg }) });
      await carregar();
      await recarregar();
      setAviso(msg);
      setTimeout(() => setAviso(""), 3000);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    } finally {
      setSalvando(false);
    }
  };

  if (!d || !cfg) return <div className="empty">{erro || "Carregando…"}</div>;
  const n = (k: keyof ConfigCrm) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [k]: e.target.value === "" ? "" : Number(e.target.value.replace(",", ".")) });
  const t = (k: keyof ConfigCrm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setCfg({ ...cfg, [k]: e.target.value });
  const b = (k: keyof ConfigCrm) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [k]: e.target.checked });

  // Exemplo vivo da regra, pra ver o efeito do que digitou
  const exCompra = 300;
  const exCashback = Math.round(exCompra * (Number(cfg.cashbackPct) || 0)) / 100;
  const mult = Number(cfg.cashbackMultiploCompra) || 0;
  const exMinima = mult > 0 ? Math.ceil(exCashback * mult) : null;
  const exDesconto = mult > 0 ? Math.round(100 / mult) : null;
  const comSalvar = secao === "cashback" || secao === "campanhas" || secao === "envio" || secao === "backup";

  return (
    <div className="cfg">
      <nav className="cfg-menu" aria-label="Seções">
        {SECOES.map(([s, nome, dica]) => (
          <button key={s} className={secao === s ? "on" : ""} onClick={() => setSecao(s)}>
            <b>{nome}</b>
            <small>{dica}</small>
          </button>
        ))}
      </nav>

      <div className="cfg-corpo">
        {secao === "cashback" && (
          <>
            <section className="card cfg-card">
              <h2>Quanto ela ganha</h2>
              <div className="cfg-grid">
                <Campo rotulo="Percentual da compra" sufixo="%" valor={cfg.cashbackPct} onChange={n("cashbackPct")} />
                <Campo rotulo="Vale por" sufixo="dias" valor={cfg.cashbackValidadeDias} onChange={n("cashbackValidadeDias")} dica="Quem viajou demora a voltar; 90 dá folga" />
                <Campo rotulo="Compra mínima pra gerar" prefixo="R$" valor={cfg.cashbackCompraMinima} onChange={n("cashbackCompraMinima")} dica="0 = qualquer compra gera" />
              </div>
            </section>

            <section className="card cfg-card">
              <h2>Como ela usa</h2>
              <div className="cfg-grid">
                <Campo rotulo="A compra precisa ser N vezes o cashback usado" valor={cfg.cashbackMultiploCompra} onChange={n("cashbackMultiploCompra")} dica="É o que faz ela comprar mais do que o cupom. 0 desliga" />
                <Campo rotulo="Saldo mínimo pra resgatar" prefixo="R$" valor={cfg.cashbackResgateMinimo} onChange={n("cashbackResgateMinimo")} dica="0 = sem mínimo" />
              </div>
              <div className="cfg-exemplo">
                <b>Na prática:</b> uma compra de {brl.format(exCompra)} gera <b>{brl.format(exCashback)}</b> de cashback.
                {exMinima !== null ? (
                  <>
                    {" "}Pra usar os {brl.format(exCashback)} inteiros, a próxima compra precisa ser de pelo menos <b>{brl.format(exMinima)}</b>: até <b>{exDesconto}% de desconto</b> nessa compra.
                  </>
                ) : (
                  <> Sem regra de múltiplo, ela pode usar o saldo todo em qualquer compra.</>
                )}
              </div>
            </section>

            <section className="card cfg-card">
              <h2>Site</h2>
              <label className="cfg-check">
                <input type="checkbox" checked={cfg.cashbackSite} onChange={b("cashbackSite")} />
                <span>
                  <b>Compra no site também gera cashback</b>
                  <small>Vira um cupom na Shopify com o mesmo código que vale no caixa da loja (mesma regra de compra mínima, só pra ela, uma vez). A mensagem leva o código e avisa qual loja fica na cidade dela.</small>
                </span>
              </label>
              <TesteCupom />
              <label className="cfg-check">
                <input type="checkbox" checked={cfg.siteNasAutomacoes} onChange={b("siteNasAutomacoes")} />
                <span>
                  <b>Quem só comprou no site entra nas campanhas automáticas</b>
                  <small>Deixe desligado enquanto o site estiver no Edrone. Mensagem avulsa pra um segmento sempre funciona</small>
                </span>
              </label>
            </section>
          </>
        )}

        {secao === "campanhas" && (
          <>
            <section className="card cfg-card">
              <h2>Lembretes de vencimento</h2>
              <div className="cfg-grid">
                <Campo rotulo="Primeiro aviso" sufixo="dias antes" valor={cfg.avisoVencimentoDias} onChange={n("avisoVencimentoDias")} dica="Leve, oferecendo mandar fotos" />
                <Campo rotulo="Último aviso" sufixo="dias antes" valor={cfg.avisoVencimentoUrgenteDias} onChange={n("avisoVencimentoUrgenteDias")} dica="Com urgência" />
              </div>
            </section>

            <section className="card cfg-card">
              <h2>Aniversário</h2>
              <div className="cfg-grid">
                <Campo rotulo="O que ela ganha" valor={cfg.aniversarioOferta} onChange={t("aniversarioOferta")} texto dica="Entra no texto como {oferta}; vira um código único no caixa" />
                <label className="cfg-campo">
                  <span>Quando mandar</span>
                  <select value={cfg.aniversarioQuando} onChange={t("aniversarioQuando")}>
                    <option value="inicio_mes">No começo do mês (ela tem o mês todo)</option>
                    <option value="dia">No dia do aniversário</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="card cfg-card">
              <h2>Reativação</h2>
              <div className="muted" style={{ marginBottom: 10 }}>Boa cliente que sumiu. Só manda pra quem atinge alguma faixa. A campanha fica desligada em Textos até você combinar com as gerentes.</div>
              <div className="cfg-grid">
                <Campo rotulo="Sem comprar há" sufixo="dias" valor={cfg.reativacaoDias} onChange={n("reativacaoDias")} />
                <Campo rotulo="Total gasto mínimo" prefixo="R$" valor={cfg.reativacaoTicketMinimo} onChange={n("reativacaoTicketMinimo")} />
                <Campo rotulo="Esperar entre tentativas" sufixo="dias" valor={cfg.reativacaoIntervaloDias} onChange={n("reativacaoIntervaloDias")} />
              </div>
              <div className="cfg-campo">
                <span>Oferta por faixa de total gasto (vale a maior faixa atingida)</span>
                {(cfg.reativacaoFaixas ?? []).map((f, i) => (
                  <div key={i} className="cfg-faixa">
                    <span className="muted">a partir de R$</span>
                    <input value={f.minimo} onChange={(e) => setCfg({ ...cfg, reativacaoFaixas: cfg.reativacaoFaixas.map((x, j) => (j === i ? { ...x, minimo: Number(e.target.value) || 0 } : x)) })} />
                    <span className="muted">ganha</span>
                    <input className="larga" value={f.oferta} onChange={(e) => setCfg({ ...cfg, reativacaoFaixas: cfg.reativacaoFaixas.map((x, j) => (j === i ? { ...x, oferta: e.target.value } : x)) })} />
                    <button className="link fin-excluir" onClick={() => setCfg({ ...cfg, reativacaoFaixas: cfg.reativacaoFaixas.filter((_, j) => j !== i) })}>remover</button>
                  </div>
                ))}
                <button className="link" onClick={() => setCfg({ ...cfg, reativacaoFaixas: [...(cfg.reativacaoFaixas ?? []), { minimo: 0, oferta: "" }] })}>+ faixa</button>
              </div>
            </section>

            <section className="card cfg-card">
              <h2>Outras</h2>
              <div className="cfg-grid">
                <Campo rotulo="Aviso de cashback" sufixo="dias depois da compra" valor={cfg.cashbackAvisoDias ?? 3} onChange={n("cashbackAvisoDias")} dica="Dá tempo de trocar ou devolver antes do aviso" />
                <Campo rotulo="Pós-venda" sufixo="dias depois da compra" valor={cfg.posVendaDias} onChange={n("posVendaDias")} dica="Campanha desligada por padrão" />
                <label className="cfg-campo">
                  <span>Hora em que as campanhas do dia são geradas</span>
                  <input type="time" value={cfg.horaAutomacoes} onChange={t("horaAutomacoes")} />
                  <small>Depois da sincronização com o TOTVS (8h30) e a Shopify (8h45)</small>
                </label>
              </div>
            </section>
          </>
        )}

        {secao === "envio" && (
          <>
            <section className={`card cfg-card ${cfg.modoSombra ? "cfg-sombra" : ""}`}>
              <h2>Modo de operação</h2>
              <label className="cfg-check">
                <input type="checkbox" checked={cfg.modoSombra} onChange={b("modoSombra")} />
                <span>
                  <b>Modo sombra</b>
                  <small>As automações geram as mensagens, mas nada é enviado. Leia em Mensagens o que teria saído e desligue quando estiver confortável. Nem a confirmação de SAIR sai.</small>
                </span>
              </label>
              <label className="cfg-check">
                <input type="checkbox" checked={cfg.pausado} onChange={b("pausado")} />
                <span>
                  <b>Pausar todos os envios</b>
                  <small>Pra uma emergência: a fila continua acumulando, nada sai</small>
                </span>
              </label>
            </section>

            <section className="card cfg-card">
              <h2>Provedor</h2>
              <div className="cfg-grid">
                <label className="cfg-campo">
                  <span>Quem manda as mensagens</span>
                  <select value={cfg.provedor} onChange={t("provedor")}>
                    <option value="nenhum">Nenhum (só acumula na fila)</option>
                    <option value="waakg">WA-AKG (não oficial, na máquina da empresa)</option>
                    <option value="cloudapi">WhatsApp Cloud API (oficial da Meta)</option>
                  </select>
                </label>
                {cfg.provedor === "waakg" && (
                  <>
                    <Campo rotulo="Endereço da WA-AKG (o painel conversa com ela por aqui)" valor={cfg.waakgUrl ?? ""} onChange={t("waakgUrl")} texto placeholder="http://localhost:3200" />
                    <Campo
                      rotulo="Link da WA-AKG para abrir de fora"
                      valor={cfg.waakgLink ?? d.waakgLinkPadrao ?? ""}
                      onChange={t("waakgLink")}
                      texto
                      placeholder="https://whats.viasolbrazil.com.br"
                      dica="É o que os botões de abrir conversas usam. Vazio = abre pelo endereço de cima (só funciona neste computador)."
                    />
                    <Campo rotulo={`API Key${d.temWaakgApiKey ? " (salva)" : ""}`} valor={cfg.waakgApiKey ?? ""} onChange={t("waakgApiKey")} texto placeholder="cole pra trocar" />
                    <ReiniciarWhats />
                  </>
                )}
                {cfg.provedor === "cloudapi" && <Campo rotulo={`Token de acesso${d.temCloudApiToken ? " (salvo)" : ""}`} valor={cfg.cloudApiToken ?? ""} onChange={t("cloudApiToken")} texto placeholder="cole pra trocar" />}
              </div>
              <Campo
                rotulo="Endereço público do painel (para o webhook)"
                valor={cfg.enderecoPublico ?? d.enderecoPublicoPadrao ?? ""}
                onChange={t("enderecoPublico")}
                texto
                placeholder="https://painel.viasolbrazil.com.br"
                dica="A WA-AKG 1.7 só manda as conversas para endereço https público. Vazio = localhost (só funciona até a 1.6)."
              />
              <div className="cfg-campo">
                <span>Webhook: o painel cadastra e corrige sozinho em cada número (eventos message.received, message.sent e message.status)</span>
                <Copiavel rotulo="Endereço usado" valor={d.webhookUsado ?? d.webhookUrl} />
                <small>O código no fim (t=…) é o segredo que autentica; sem ele a rota recusa.</small>
              </div>
            </section>

            <section className="card cfg-card">
              <h2>Ritmo (é isso que protege os números)</h2>
              <div className="cfg-grid">
                <Campo rotulo="Teto por número por dia" sufixo="mensagens" valor={cfg.tetoDiaPorNumero} onChange={n("tetoDiaPorNumero")} dica="Comece em 20 e suba aos poucos" />
                <Campo rotulo="Máximo por cliente em 30 dias" sufixo="mensagens" valor={cfg.maxMensagensMes} onChange={n("maxMensagensMes")} dica="De qualquer campanha. O aviso de cashback da própria compra não conta" />
                <Campo rotulo="Intervalo mínimo entre mensagens" sufixo="seg" valor={cfg.intervaloMinSeg} onChange={n("intervaloMinSeg")} />
                <Campo rotulo="Intervalo máximo" sufixo="seg" valor={cfg.intervaloMaxSeg} onChange={n("intervaloMaxSeg")} />
                <Campo rotulo="Campanhas sem resposta até parar marketing" valor={cfg.maxSemResposta} onChange={n("maxSemResposta")} dica="Avisos de cashback continuam" />
                <div className="cfg-campo">
                  <span>Horário</span>
                  <div className="cfg-input">
                    <em>das</em>
                    <input value={cfg.envioInicio} onChange={n("envioInicio")} inputMode="numeric" />
                    <em>h às</em>
                    <input value={cfg.envioFim} onChange={n("envioFim")} inputMode="numeric" />
                    <em>h</em>
                  </div>
                </div>
              </div>
              <div className="cfg-campo">
                <span>Dias</span>
                <div>
                  {["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((nome, i) => (
                    <label key={i} className={`fin-chip ${cfg.envioDias.includes(i) ? "" : "inativa"}`}>
                      <input type="checkbox" style={{ display: "none" }} checked={cfg.envioDias.includes(i)} onChange={(e) => setCfg({ ...cfg, envioDias: e.target.checked ? [...cfg.envioDias, i].sort() : cfg.envioDias.filter((x) => x !== i) })} />
                      {nome}
                    </label>
                  ))}
                </div>
              </div>
              <label className="cfg-check">
                <input type="checkbox" checked={cfg.avisoSair} onChange={b("avisoSair")} />
                <span>
                  <b>Avisar como sair, na primeira mensagem de cada cliente</b>
                  <small>Uma linha no fim da primeira mensagem que ela recebe. Quem tem a saída fácil responde SAIR em vez de denunciar o número.</small>
                </span>
              </label>
              {cfg.avisoSair && (
                <label className="cfg-campo">
                  <span>Texto do aviso</span>
                  <input value={cfg.textoSair} onChange={t("textoSair")} />
                </label>
              )}
            </section>
          </>
        )}

        {secao === "site" && <WhatsAppSite d={d} aoMudar={async () => { await carregar(); await recarregar(); }} />}
        {secao === "numeros" && <Numeros lojas={d.lojas} numeros={cfg.numeros} provedor={cfg.provedor} salvar={(numeros) => salvar({ numeros }, "Números salvos.")} />}

        {secao === "modelos" && <Modelos d={d} aoMudar={carregar} />}

        {secao === "dados" && (
          <>
            <Fontes r={r} recarregar={recarregar} />
            <Importar r={r} recarregar={recarregar} />
          </>
        )}

        {secao === "backup" && (
          <section className="card cfg-card">
            <h2>Cópia de segurança</h2>
            <div className="muted" style={{ marginBottom: 10 }}>A base do CRM fica em dados/crm/base.json. Informe uma pasta (Google Drive, OneDrive) pra receber uma cópia por dia, como no financeiro.</div>
            <Campo rotulo="Pasta de backup" valor={cfg.backupDir ?? ""} onChange={t("backupDir")} texto placeholder="C:\Users\...\Google Drive\Backups" />
            <button className="mini ghost" onClick={async () => { const r = await api<{ backup: string }>("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "backup" }) }); setAviso(`Cópia: ${r.backup}`); }}>Copiar agora</button>
          </section>
        )}

        {erro && <div className="login-error">{erro}</div>}
        {aviso && <div className="crm-aviso">{aviso}</div>}

        {comSalvar && (
          <div className={`cfg-salvar ${mudou ? "on" : ""}`}>
            <span className="muted">{mudou ? "Alterações não salvas" : "Tudo salvo"}</span>
            {mudou && <button className="link" onClick={() => setCfg(salvo)}>descartar</button>}
            <button className="mini" disabled={!mudou || salvando} onClick={() => salvar()}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Copiavel({ rotulo, valor }: { rotulo: string; valor: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="cfg-copiavel">
      <small>{rotulo}</small>
      <div className="cfg-input">
        <input readOnly value={valor} onFocus={(e) => e.target.select()} />
        <button
          className="mini ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(valor);
              setOk(true);
              setTimeout(() => setOk(false), 1500);
            } catch {
              /* sem clipboard: a pessoa seleciona e copia */
            }
          }}
        >
          {ok ? "copiado" : "copiar"}
        </button>
      </div>
    </div>
  );
}

export function Campo({ rotulo, valor, onChange, prefixo, sufixo, dica, texto, placeholder }: { rotulo: string; valor: string | number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; prefixo?: string; sufixo?: string; dica?: string; texto?: boolean; placeholder?: string }) {
  return (
    <label className="cfg-campo">
      <span>{rotulo}</span>
      <div className="cfg-input">
        {prefixo && <em>{prefixo}</em>}
        <input value={valor} onChange={onChange} inputMode={texto ? undefined : "decimal"} placeholder={placeholder} />
        {sufixo && <em>{sufixo}</em>}
      </div>
      {dica && <small>{dica}</small>}
    </label>
  );
}

function Numeros({ lojas, numeros, provedor, salvar }: { lojas: string[]; numeros: NumeroWhatsapp[]; provedor: string; salvar: (n: NumeroWhatsapp[]) => Promise<void> }) {
  // As lojas e, no fim, o número do site na WA-AKG (carrinho e Pix enquanto a API oficial não está pronta)
  const [lista, setLista] = useState<NumeroWhatsapp[]>(() => [...lojas.filter((l) => l !== "Site"), "Site"].map((l) => numeros.find((n) => n.loja === l) ?? { loja: l, sessao: "", ativo: false }));
  const [teste, setTeste] = useState<Record<string, string>>({});
  const [telTeste, setTelTeste] = useState("");
  const muda = (i: number, p: Partial<NumeroWhatsapp>) => setLista(lista.map((n, j) => (j === i ? { ...n, ...p } : n)));

  const testar = async (loja: string) => {
    setTeste({ ...teste, [loja]: "testando…" });
    try {
      const r = await api<{ conectado: boolean; detalhe?: string }>("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "testar-numero", loja }) });
      setTeste({ ...teste, [loja]: r.conectado ? `conectado (${r.detalhe})` : `fora (${r.detalhe ?? "sem detalhe"})` });
    } catch (e) {
      setTeste({ ...teste, [loja]: e instanceof Error ? e.message : "erro" });
    }
  };
  const mandarTeste = async (loja: string) => {
    setTeste({ ...teste, [loja]: "enviando…" });
    try {
      const r = await api<{ ok: boolean; erro?: string }>("/api/crm/mensagens", { method: "POST", body: JSON.stringify({ acao: "teste", loja, telefone: telTeste, texto: `Teste do CRM Via Sol pelo número da loja ${loja}.` }) });
      setTeste({ ...teste, [loja]: r.ok ? "mensagem de teste enviada" : r.erro ?? "falhou" });
    } catch (e) {
      setTeste({ ...teste, [loja]: e instanceof Error ? e.message : "erro" });
    }
  };

  return (
    <section className="card cfg-card">
      <h2>Um número por loja</h2>
      <div className="muted" style={{ marginBottom: 12 }}>
        {provedor === "waakg"
          ? "Na WA-AKG, crie uma sessão por loja (escaneando o QR no celular da loja) e cole aqui o nome da sessão. Cada loja manda só pras próprias clientes, pelo próprio número."
          : provedor === "cloudapi"
            ? "Cole o phone_number_id de cada número cadastrado na Meta."
            : "Escolha o provedor na seção Envio antes."}{" "}
        A vendedora é quem assina as mensagens quando a venda não tem vendedora identificada (aniversário, lembretes).
      </div>
      <label className="cfg-campo">
        <span>Seu celular, para os testes (sai na hora, fora da fila, mesmo em modo sombra)</span>
        <input value={telTeste} onChange={(e) => setTelTeste(e.target.value)} placeholder="(16) 99999-8888" inputMode="tel" style={{ maxWidth: 220 }} />
      </label>
      {/* Cada loja em duas linhas (campos, depois os botões): cabe sem rolar para o lado */}
      <div className="tbl-wrap">
        <table className="prod-tbl fin-tbl cfg-tabela cfg-numeros">
          <thead>
            <tr>
              <th>Loja</th>
              <th>Sessão / id</th>
              <th>Vendedora que assina</th>
              <th>Endereço (pra cliente do site)</th>
              <th>Teto/dia</th>
              <th>Ligado</th>
            </tr>
          </thead>
          {lista.map((n, i) => (
            <tbody key={n.loja}>
              <tr>
                <td className="fin-desc">{n.loja === "Site" ? "Site (e-commerce)" : n.loja}</td>
                <td data-rotulo="Sessão / id"><input className="crm-input" aria-label={`Sessão da ${n.loja}`} value={n.sessao} onChange={(e) => muda(i, { sessao: e.target.value })} placeholder="ex.: centro" /></td>
                <td data-rotulo="Vendedora que assina"><input className="crm-input" aria-label={`Vendedora que assina pela ${n.loja}`} value={n.vendedora ?? ""} onChange={(e) => muda(i, { vendedora: e.target.value })} placeholder="ex.: Carol" /></td>
                <td data-rotulo="Endereço" className="cfg-numeros-end"><input className="crm-input" aria-label={`Endereço da ${n.loja}`} value={n.endereco ?? ""} onChange={(e) => muda(i, { endereco: e.target.value })} placeholder="ex.: Rua do Comércio, 1200" /></td>
                <td data-rotulo="Teto/dia" className="cfg-numeros-teto"><input className="crm-input" aria-label={`Teto por dia da ${n.loja}`} inputMode="numeric" value={n.tetoDia ?? ""} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); muda(i, { tetoDia: v ? Number(v) : undefined }); }} placeholder="geral" /></td>
                <td data-rotulo="Ligado"><input type="checkbox" aria-label={`Número da ${n.loja} ligado`} checked={n.ativo} onChange={(e) => muda(i, { ativo: e.target.checked })} /></td>
              </tr>
              <tr className="cfg-numeros-acoes">
                <td />
                <td colSpan={5}>
                  <div className="cfg-numeros-botoes">
                    <button className="link" disabled={!n.sessao} onClick={() => testar(n.loja)}>situação</button>
                    <button className="link" disabled={!n.sessao || !telTeste} title={telTeste ? undefined : "Preencha seu celular acima"} onClick={() => mandarTeste(n.loja)}>mandar teste</button>
                    <button
                      className="link"
                      title="Apaga o histórico de conversas desta loja no painel (tempo de resposta, quem está esperando). Não mexe no WhatsApp."
                      onClick={async () => {
                        if (!confirm(`Apagar as conversas registradas da ${n.loja} no painel? Serve pra limpar teste. O WhatsApp não é afetado.`)) return;
                        const r = await api<{ apagados: number }>("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "limpar-atendimento", loja: n.loja }) });
                        setTeste({ ...teste, [n.loja]: `${r.apagados} registros apagados` });
                      }}
                    >
                      apagar conversas
                    </button>
                    {teste[n.loja] && <span className="fin-sub" role="status">{teste[n.loja]}</span>}
                  </div>
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>

      <h3 className="crm-h3">Horário de atendimento</h3>
      <div className="muted" style={{ marginBottom: 8, fontSize: 12.5 }}>
        O tempo de resposta só conta dentro desse horário. Use 10:00-22:00; deixe vazio no dia em que a loja não abre. Loja sem nada preenchido usa o horário de envio, de segunda a sábado.
      </div>
      <div className="tbl-wrap">
        <table className="prod-tbl fin-tbl cfg-tabela">
          <thead>
            <tr>
              <th>Loja</th>
              <th>Segunda a sexta</th>
              <th>Sábado</th>
              <th>Domingo e feriado</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((n, i) => (
              <tr key={n.loja}>
                <td className="fin-desc">{n.loja}</td>
                {(["semana", "sabado", "domingo"] as const).map((k) => (
                  <td key={k}>
                    <input
                      className="crm-input"
                      style={{ width: 120 }}
                      aria-label={`${n.loja}, ${k === "semana" ? "segunda a sexta" : k === "sabado" ? "sábado" : "domingo e feriado"}`}
                      value={n.horario?.[k] ?? ""}
                      onChange={(e) => muda(i, { horario: { ...n.horario, [k]: e.target.value } })}
                      placeholder={k === "domingo" ? "fechado" : "10:00-22:00"}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cfg-salvar on" style={{ marginTop: 12 }}>
        <span className="muted">Números e horários só valem depois de salvar.</span>
        <button className="mini" onClick={() => salvar(lista)}>Salvar números</button>
      </div>
    </section>
  );
}

function Modelos({ d, aoMudar }: { d: DadosConfig; aoMudar: () => Promise<void> }) {
  const [edit, setEdit] = useState<Modelo | null>(null);
  const [erro, setErro] = useState("");
  const salvar = async (m: Modelo) => {
    setErro("");
    try {
      await api("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "modelo", modelo: m }) });
      await aoMudar();
      setEdit(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  };
  return (
    <section className="card cfg-card">
      <h2>Textos das campanhas</h2>
      <div className="muted" style={{ marginBottom: 12 }}>
        Cada campanha tem variações; o sistema sorteia uma por mensagem, pro mesmo número não mandar sempre igual. Variáveis: {"{primeiro}"} (primeiro nome), {"{nome}"}, {"{vendedora}"} (quem assina), {"{loja}"}, {"{valor}"}, {"{validade}"}, {"{compraMinima}"} (compra mínima pra usar o valor), {"{quando}"} e {"{daCompra}"} (dia da compra: &quot;ontem&quot; / &quot;no dia 16/10&quot; e &quot;de ontem&quot; / &quot;do dia 16/10&quot;), {"{oferta}"} e {"{codigo}"} (aniversário e reativação; o código é único por mensagem e mede qual campanha trouxe a cliente), {"{lojaProxima}"} e {"{cidade}"} (compra no site com loja na cidade dela).
      </div>
      {d.campanhas
        .filter((c) => c.id !== "avulsa")
        .map((c) => {
          const m = d.modelos.find((x) => x.campanha === c.id) ?? { campanha: c.id, ativo: false, variacoes: [] };
          const editando = edit?.campanha === c.id;
          return (
            <div key={c.id} className={`cfg-modelo ${m.ativo ? "" : "off"}`}>
              <div className="cfg-modelo-cab">
                <label className="cfg-switch" title={m.ativo ? "Desligar" : "Ligar"}>
                  <input type="checkbox" checked={m.ativo} onChange={(e) => salvar({ ...m, ativo: e.target.checked })} />
                  <i />
                </label>
                <div style={{ flex: 1 }}>
                  <b>{c.nome}</b>
                  <div className="fin-sub">{c.dica} · {c.marketing ? "marketing (conta pro limite de sem resposta)" : "aviso"}</div>
                </div>
                <button className="link" onClick={() => setEdit(editando ? null : structuredClone(m))}>{editando ? "fechar" : "editar textos"}</button>
              </div>
              {!editando ? (
                m.variacoes.map((v, i) => <div key={i} className="crm-variacao">{v}</div>)
              ) : (
                <div style={{ marginTop: 8 }}>
                  {edit!.variacoes.map((v, i) => (
                    <div key={i} className="crm-inline" style={{ alignItems: "flex-start", marginBottom: 8 }}>
                      <textarea className="crm-textarea" rows={3} value={v} onChange={(e) => setEdit({ ...edit!, variacoes: edit!.variacoes.map((x, j) => (j === i ? e.target.value : x)) })} />
                      <button className="link fin-excluir" onClick={() => setEdit({ ...edit!, variacoes: edit!.variacoes.filter((_, j) => j !== i) })}>remover</button>
                    </div>
                  ))}
                  <div className="config-acoes">
                    <button className="mini ghost" onClick={() => setEdit({ ...edit!, variacoes: [...edit!.variacoes, ""] })}>+ variação</button>
                    <button className="mini" onClick={() => salvar(edit!)}>Salvar textos</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      {erro && <div className="login-error">{erro}</div>}
    </section>
  );
}

/** Confere se o painel tem permissão de criar cupom na Shopify. */
function TesteCupom() {
  const [msg, setMsg] = useState("");
  const testar = async () => {
    setMsg("Conferindo…");
    try {
      const r = await api<{ ok: boolean; detalhe: string }>("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "testar-cupom" }) });
      setMsg(r.detalhe);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro");
    }
  };
  return (
    <div className="config-acoes">
      <button className="mini ghost" onClick={testar}>Conferir permissão de cupom na Shopify</button>
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}

/** Reinicia a WA-AKG no computador do painel (serve de longe, pelo link). */
function ReiniciarWhats() {
  const [msg, setMsg] = useState("");
  const [indo, setIndo] = useState(false);
  const reiniciar = async () => {
    if (!window.confirm("Reiniciar o WhatsApp de todas as lojas? Fica fora uns 30 segundos.")) return;
    setIndo(true);
    setMsg("");
    try {
      const r = await api<{ ok: boolean; detalhe: string }>("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "reiniciar-waakg" }) });
      setMsg(r.detalhe);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "erro");
    } finally {
      setIndo(false);
    }
  };
  return (
    <div className="cfg-campo">
      <span>Reiniciar a WA-AKG</span>
      <div>
        <button className="mini ghost" onClick={reiniciar} disabled={indo}>
          {indo ? "Reiniciando…" : "Reiniciar WhatsApp"}
        </button>
      </div>
      <small>{msg || "Use depois de mudar a configuração dela ou se ela travar. As conversas perdidas nesse meio tempo o painel busca sozinho."}</small>
    </div>
  );
}
