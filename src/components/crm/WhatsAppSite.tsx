"use client";

import { useState } from "react";
import type { ConfigOficial, Modelo, TemplateMeta, TipoCampanha } from "@/lib/crm/tipos";
import { type DadosConfig, api } from "./comum";
import { Campo, Copiavel } from "./Configurar";

interface ModeloMeta {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  rejected_reason?: string;
}

const SITUACAO: Record<string, string> = { APPROVED: "aprovado", PENDING: "em análise", REJECTED: "recusado", PAUSED: "pausado", DISABLED: "desativado" };
const CHAVES = ["primeiro", "nome", "vendedora", "loja", "lojaProxima", "valor", "validade", "compraMinima", "codigo", "itens", "pedido", "link"];
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * Número oficial do site (Cloud API da Meta): credenciais, modo sombra
 * próprio, regras do carrinho e do Pix, campanhas que saem por ele e o
 * modelo aprovado de cada uma.
 */
export function WhatsAppSite({ d, aoMudar }: { d: DadosConfig; aoMudar: () => Promise<void> }) {
  const [of, setOf] = useState<ConfigOficial>(() => d.config.oficial!);
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState("");
  const [modelosMeta, setModelosMeta] = useState<ModeloMeta[] | null>(null);
  const salvo = d.config.oficial!;
  const mudou = JSON.stringify(of) !== JSON.stringify(salvo);

  const chamar = async <T,>(nome: string, corpo: unknown): Promise<T | null> => {
    setErro("");
    setMsg("");
    setIndo(nome);
    try {
      return await api<T>("/api/crm/config", { method: "POST", body: JSON.stringify(corpo) });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
      return null;
    } finally {
      setIndo("");
    }
  };
  const salvar = async () => {
    if (await chamar("salvar", { tipo: "oficial", oficial: of })) {
      await aoMudar();
      setMsg("Salvo.");
    }
  };
  const testar = async () => {
    const r = await chamar<{ conectado: boolean; detalhe?: string }>("testar", { tipo: "testar-oficial" });
    if (r) setMsg(r.conectado ? `Conectado: ${r.detalhe ?? ""}` : `Não conectou: ${r.detalhe ?? ""}`);
  };
  const listar = async () => {
    const r = await chamar<{ modelos: ModeloMeta[] }>("listar", { tipo: "modelos-meta" });
    if (r) setModelosMeta(r.modelos);
  };
  const criar = async () => {
    const r = await chamar<{ feitos: { nome: string; ok: boolean; detalhe: string }[] }>("criar", { tipo: "criar-modelos-meta" });
    if (r) {
      setMsg(r.feitos.map((f) => `${f.nome}: ${f.detalhe}`).join(" · "));
      await listar();
    }
  };

  const num = (k: keyof ConfigOficial) => (e: React.ChangeEvent<HTMLInputElement>) => setOf({ ...of, [k]: e.target.value === "" ? "" : Number(e.target.value.replace(",", ".")) });
  const txt = (k: keyof ConfigOficial) => (e: React.ChangeEvent<HTMLInputElement>) => setOf({ ...of, [k]: e.target.value });
  const chk = (k: keyof ConfigOficial) => (e: React.ChangeEvent<HTMLInputElement>) => setOf({ ...of, [k]: e.target.checked });
  const pelaOficial = (c: TipoCampanha) => of.campanhas.includes(c);
  const [telTeste, setTelTeste] = useState("");

  return (
    <>
      <section className={`card cfg-card ${of.sombra ? "cfg-sombra" : ""}`}>
        <h2>WhatsApp oficial do site</h2>
        <p className="muted pg-nota">
          Número da API oficial da Meta. Sai por aqui o que estiver marcado em &quot;Campanhas que saem pelo número oficial&quot;, como modelo aprovado. Aviso de cashback das lojas pelo oficial continua assinado pela vendedora, com botão pro WhatsApp da loja. Fila, limite por cliente e SAIR valem pros dois.
        </p>
        <label className="cfg-check">
          <input type="checkbox" checked={of.sombra} onChange={chk("sombra")} />
          <span>
            <b>Modo sombra do site</b>
            <small>Gera as mensagens e anota quem comprou depois, mas nada sai. Separado do modo sombra das lojas: dá pra ligar um sem o outro. Mostra quantas mensagens por dia sairiam e quantas pessoas comprariam de qualquer jeito.</small>
          </span>
        </label>
        <div className="cfg-grid">
          <Campo rotulo={`Token permanente${d.temTokenOficial ? " (salvo)" : ""}`} valor={of.token ?? ""} onChange={txt("token")} texto placeholder="cole pra trocar" dica="Usuário do sistema no Gerenciador de Negócios, com whatsapp_business_messaging e whatsapp_business_management" />
          <Campo rotulo="ID do número (phone number ID)" valor={of.phoneNumberId ?? ""} onChange={txt("phoneNumberId")} texto placeholder="ex.: 123456789012345" />
          <Campo rotulo="ID da conta do WhatsApp Business (WABA)" valor={of.wabaId ?? ""} onChange={txt("wabaId")} texto placeholder="ex.: 109876543210987" dica="Pra listar e criar os modelos" />
          <Campo rotulo={`Segredo do app (opcional)${d.temAppSecret ? " (salvo)" : ""}`} valor={of.appSecret ?? ""} onChange={txt("appSecret")} texto placeholder="confere a assinatura do webhook" />
        </div>
        <label className="cfg-check">
          <input type="checkbox" checked={of.autoResposta !== false} onChange={chk("autoResposta")} />
          <span>
            <b>Resposta automática com o WhatsApp da loja</b>
            <small>Quem responde no número oficial recebe na hora o link do WhatsApp da loja dela (uma vez a cada 12 h). Não é cobrada: é resposta a quem escreveu.</small>
          </span>
        </label>
        <div className="cfg-grid">
          <Campo rotulo="WhatsApp de atendimento (quando não dá pra saber a loja)" valor={of.whatsAtendimento ?? ""} onChange={txt("whatsAtendimento")} texto placeholder="ex.: 16 99168-7616" dica="O de cada loja fica em Números" />
        </div>
        {d.webhookOficial && (
          <div className="cfg-campo">
            <span>Na Meta (app › WhatsApp › Configuração › Webhook): cole estes dois e assine &quot;messages&quot; (e &quot;smb_message_echoes&quot;, se usar o app no celular)</span>
            <Copiavel rotulo="URL de retorno" valor={d.webhookOficial.url} />
            <Copiavel rotulo="Token de verificação" valor={d.webhookOficial.verifyToken} />
          </div>
        )}
        <div className="config-acoes">
          <button className="mini" onClick={salvar} disabled={!mudou || indo !== ""}>{indo === "salvar" ? "Salvando…" : "Salvar"}</button>
          <button className="mini ghost" onClick={testar} disabled={indo !== "" || mudou}>{indo === "testar" ? "Testando…" : "Testar conexão"}</button>
        </div>
        <div className="config-acoes">
          <input className="crm-input" value={telTeste} onChange={(e) => setTelTeste(e.target.value)} placeholder="seu celular, ex.: (16) 99999-8888" inputMode="tel" style={{ maxWidth: 240 }} />
          <button
            className="mini ghost"
            disabled={!telTeste || indo !== "" || mudou}
            onClick={async () => {
              const r = await chamar<{ ok?: boolean; detalhe?: string }>("teste", { tipo: "teste-oficial", telefone: telTeste });
              if (r?.detalhe) setMsg(r.detalhe);
            }}
          >
            {indo === "teste" ? "Mandando…" : "Mandar mensagem de teste"}
          </button>
        </div>
      </section>

      <section className="card cfg-card">
        <h2>Carrinho e Pix</h2>
        <div className="cfg-grid">
          <Campo rotulo="Carrinho: mensagem depois de parado há" valor={of.carrinhoMinutos} onChange={num("carrinhoMinutos")} sufixo="min" dica="O que mais converte é entre 30 min e 2 h" />
          <Campo rotulo="Carrinho: valor mínimo" valor={of.carrinhoMinimo} onChange={num("carrinhoMinimo")} prefixo="R$" />
          <Campo rotulo="Carrinho: no máximo um a cada" valor={of.carrinhoIntervaloDias} onChange={num("carrinhoIntervaloDias")} sufixo="dias" dica="Quem abandona carrinho toda semana não recebe toda vez" />
          <Campo rotulo="Pix: lembrete depois de" valor={of.pixMinutos} onChange={num("pixMinutos")} sufixo="min" dica="Confira em quanto tempo o Pix do seu checkout expira" />
          <Campo rotulo="Teto de mensagens por dia" valor={of.tetoDia} onChange={num("tetoDia")} dica="A Meta começa com limite de 250 pessoas/dia e sobe sozinho com o uso" />
          <Campo rotulo="Link do botão começa com" valor={of.urlBase} onChange={txt("urlBase")} texto />
        </div>
        <label className="cfg-check">
          <input type="checkbox" checked={of.carrinhoSoComAceite} onChange={chk("carrinhoSoComAceite")} />
          <span>
            <b>Carrinho só pra quem marcou aceite no checkout</b>
            <small>A Meta pede aceite pra mensagem que a empresa inicia. Sem isso marcado, vai pra todo mundo que deixou o telefone; com isso, só pra quem marcou &quot;receber novidades por SMS/WhatsApp&quot; no checkout (bem menos gente, menos risco pro número).</small>
          </span>
        </label>
        <label className="cfg-check">
          <input type="checkbox" checked={of.pagamentoTodos} onChange={chk("pagamentoTodos")} />
          <span>
            <b>Lembrar também boleto e outros pagamentos pendentes</b>
            <small>Desligado: só Pix</small>
          </span>
        </label>
        <div className="cfg-grid">
          <Campo rotulo="Carrinho e Pix: manda das" valor={of.inicio} onChange={num("inicio")} sufixo="h" dica="Vale pro número oficial e pro número do site na WA-AKG. Os outros avisos seguem o horário das lojas" />
          <Campo rotulo="até as" valor={of.fim} onChange={num("fim")} sufixo="h" />
        </div>
        <div className="cfg-dias">
          {DIAS.map((nome, i) => (
            <label key={i} className="cfg-check-inline">
              <input type="checkbox" checked={of.dias.includes(i)} onChange={(e) => setOf({ ...of, dias: e.target.checked ? [...of.dias, i].sort() : of.dias.filter((x) => x !== i) })} /> {nome}
            </label>
          ))}
        </div>
        <h3 className="crm-h3">Campanhas que saem pelo número oficial</h3>
        <p className="muted pg-nota">Enquanto a Meta não estiver configurada (token e ID do número), carrinho e Pix marcados aqui saem pelo número do site na WA-AKG, se ele estiver ligado em Números › Site; os avisos das lojas seguem pelo número de cada loja. Carrinho e Pix nunca saem pelo número de uma loja.</p>
        <div className="cfg-dias">
          {d.campanhas
            .filter((c) => c.id !== "avulsa")
            .map((c) => (
              <label key={c.id} className="cfg-check-inline">
                <input type="checkbox" checked={pelaOficial(c.id)} onChange={(e) => setOf({ ...of, campanhas: e.target.checked ? [...of.campanhas, c.id] : of.campanhas.filter((x) => x !== c.id) })} /> {c.nome}
              </label>
            ))}
        </div>
        <div className="config-acoes">
          <button className="mini" onClick={salvar} disabled={!mudou || indo !== ""}>{indo === "salvar" ? "Salvando…" : "Salvar"}</button>
        </div>
      </section>

      <section className="card cfg-card">
        <h2>Modelos aprovados na Meta</h2>
        <p className="muted pg-nota">
          Fora das 24h depois de a cliente escrever, a Meta só deixa mandar modelo aprovado. O painel pode mandar os dois modelos sugeridos (carrinho e Pix) pra aprovação; costuma levar de minutos a algumas horas. O texto aparece em Textos, só como espelho: o que vale é o aprovado.
        </p>
        <div className="config-acoes">
          <button className="mini" onClick={criar} disabled={indo !== "" || !salvo.wabaId}>{indo === "criar" ? "Mandando…" : "Mandar modelos sugeridos pra aprovação"}</button>
          <button className="mini ghost" onClick={listar} disabled={indo !== "" || !salvo.wabaId}>{indo === "listar" ? "Buscando…" : "Ver modelos da conta"}</button>
        </div>
        {modelosMeta && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Tipo</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {modelosMeta.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name} <small className="muted">{m.language}</small>
                    </td>
                    <td>{m.category === "MARKETING" ? "marketing" : m.category === "UTILITY" ? "utilidade" : m.category.toLowerCase()}</td>
                    <td>
                      {SITUACAO[m.status] ?? m.status}
                      {m.rejected_reason && m.rejected_reason !== "NONE" ? ` (${m.rejected_reason})` : ""}
                    </td>
                  </tr>
                ))}
                {!modelosMeta.length && (
                  <tr>
                    <td colSpan={3} className="muted">Nenhum modelo na conta ainda.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="crm-h3">Qual modelo cada campanha usa</h3>
        {d.campanhas
          .filter((c) => pelaOficial(c.id))
          .map((c) => (
            <ModeloDaCampanha key={c.id} nome={c.nome} modelo={d.modelos.find((m) => m.campanha === c.id) ?? { campanha: c.id, ativo: false, variacoes: [] }} aoMudar={aoMudar} />
          ))}
      </section>
      {(msg || erro) && <div className={erro ? "login-error" : "muted"}>{erro || msg}</div>}
    </>
  );
}

function ModeloDaCampanha({ nome, modelo, aoMudar }: { nome: string; modelo: Modelo; aoMudar: () => Promise<void> }) {
  const [t, setT] = useState<TemplateMeta>(() => modelo.template ?? { nome: "", idioma: "pt_BR", parametros: [], botaoLink: false, botaoVar: "link" });
  const [msg, setMsg] = useState("");
  const salvar = async () => {
    try {
      await api("/api/crm/config", { method: "POST", body: JSON.stringify({ tipo: "modelo", modelo: { ...modelo, template: t.nome.trim() ? t : null } }) });
      await aoMudar();
      setMsg("Salvo.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro");
    }
  };
  return (
    <div className="cfg-modelo">
      <b>{nome}</b>
      <div className="cfg-grid">
        <label className="cfg-campo">
          <span>Nome do modelo na Meta</span>
          <div className="cfg-input">
            <input value={t.nome} onChange={(e) => setT({ ...t, nome: e.target.value })} placeholder="via_sol_carrinho" />
          </div>
        </label>
        <label className="cfg-campo">
          <span>Variáveis, na ordem ({"{{1}}"}, {"{{2}}"}...)</span>
          <div className="cfg-input">
            <input value={t.parametros.join(", ")} onChange={(e) => setT({ ...t, parametros: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="primeiro, itens" />
          </div>
          <small>Pode usar: {CHAVES.join(", ")}</small>
        </label>
      </div>
      <label className="cfg-check">
        <input type="checkbox" checked={Boolean(t.botaoLink)} onChange={(e) => setT({ ...t, botaoLink: e.target.checked })} />
        <span>
          <b>Tem botão com o link</b>
          <small>O botão do modelo termina com {"{{1}}"}: vai o que estiver escolhido abaixo</small>
        </span>
      </label>
      {t.botaoLink && (
        <label className="cfg-campo">
          <span>Final do link do botão</span>
          <select className="crm-input" value={t.botaoVar ?? "link"} onChange={(e) => setT({ ...t, botaoVar: e.target.value })} style={{ maxWidth: 360 }}>
            <option value="link">Link do carrinho ou do pedido</option>
            <option value="whatsLoja">WhatsApp da loja (viasolbrazil.com.br/w/loja)</option>
            <option value="codigo">Código do cupom (site/discount/…)</option>
          </select>
        </label>
      )}
      <div className="config-acoes">
        <button className="mini ghost" onClick={salvar}>Salvar modelo</button>
        {msg && <small className="muted">{msg}</small>}
      </div>
    </div>
  );
}
