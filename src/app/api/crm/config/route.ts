import { execFile } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { lerFaixa } from "@/lib/crm/atendimento";
import { configurarWebhooks, urlDoWebhook, webhookQueVale } from "@/lib/crm/webhookAuto";
import { LOJAS } from "@/lib/connectors/totvs";
import { alterarBase, copiaDeSeguranca, lerBase } from "@/lib/crm/base";
import { CAMPANHAS, ENDERECO_PUBLICO_PADRAO, WAAKG_LINK_PADRAO, oficialDe, type ConfigCrm, type ConfigOficial, type Modelo, type TemplateMeta } from "@/lib/crm/tipos";
import { adaptadorDe } from "@/lib/crm/envio/adaptador";
import { CloudApi } from "@/lib/crm/envio/cloudApi";
import { normalizarTelefone } from "@/lib/crm/telefone";
import { MODELOS_SUGERIDOS, payloadDoModelo } from "@/lib/crm/modelosMeta";
import { escoposShopify } from "@/lib/crm/cupomShopify";

export const dynamic = "force-dynamic";

const mascarar = (s?: string) => (s ? `${s.slice(0, 4)}…${s.slice(-3)}` : "");

/** Configuração e modelos de mensagem. Chaves vêm mascaradas. */
export async function GET(req: NextRequest) {
  const base = await lerBase();
  const origem = `${req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")}://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
  return NextResponse.json({
    config: {
      ...base.config,
      waakgApiKey: mascarar(base.config.waakgApiKey),
      cloudApiToken: mascarar(base.config.cloudApiToken),
      oficial: { ...oficialDe(base.config), token: mascarar(base.config.oficial?.token), appSecret: mascarar(base.config.oficial?.appSecret) },
    },
    temTokenOficial: Boolean(base.config.oficial?.token),
    temAppSecret: Boolean(base.config.oficial?.appSecret),
    // Na Meta: URL de retorno do webhook e o token de verificação (o mesmo segredo)
    webhookOficial: { url: `${base.config.enderecoPublico ?? ENDERECO_PUBLICO_PADRAO}/api/crm/webhook?t=${base.config.webhookSegredo}`, verifyToken: base.config.webhookSegredo },
    temWaakgApiKey: Boolean(base.config.waakgApiKey),
    temCloudApiToken: Boolean(base.config.cloudApiToken),
    modelos: base.modelos,
    campanhas: CAMPANHAS,
    lojas: Object.values(LOJAS),
    webhookUrl: `${origem}/api/crm/webhook?t=${base.config.webhookSegredo}`,
    webhookUsado: urlDoWebhook(base.config),
    enderecoPublicoPadrao: ENDERECO_PUBLICO_PADRAO,
    waakgLinkPadrao: WAAKG_LINK_PADRAO,
  });
}

type Pedido =
  | { tipo: "config"; config: Partial<ConfigCrm> }
  | { tipo: "modelo"; modelo: Modelo }
  | { tipo: "testar-numero"; loja: string }
  | { tipo: "backup" }
  | { tipo: "limpar-atendimento"; loja: string }
  | { tipo: "reiniciar-waakg" }
  | { tipo: "oficial"; oficial: Partial<ConfigOficial> }
  | { tipo: "testar-oficial" }
  | { tipo: "modelos-meta" }
  | { tipo: "criar-modelos-meta" }
  | { tipo: "teste-oficial"; telefone: string }
  | { tipo: "registrar-oficial"; pin: string }
  | { tipo: "testar-cupom" };

const num = (v: unknown, padrao: number, min = 0, max = 1_000_000) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

/** Horário de atendimento da loja: cada campo "10:00-22:00" ou vazio (fechado). Tudo vazio = usa o padrão. */
function horarioLimpo(h: unknown): { semana?: string; sabado?: string; domingo?: string } | undefined {
  if (!h || typeof h !== "object") return undefined;
  const o = h as Record<string, unknown>;
  const campo = (k: string) => {
    const t = String(o[k] ?? "").trim();
    if (!t) return "";
    if (!lerFaixa(t)) throw new Error(`Horário inválido: "${t}". Use o formato 10:00-22:00.`);
    return t;
  };
  const r = { semana: campo("semana"), sabado: campo("sabado"), domingo: campo("domingo") };
  return r.semana || r.sabado || r.domingo ? r : undefined;
}

export async function POST(req: NextRequest) {
  const p = (await req.json().catch(() => ({}))) as Pedido;
  try {
    if (p.tipo === "testar-numero") {
      const base = await lerBase();
      const adaptador = adaptadorDe(base.config);
      if (!adaptador) return NextResponse.json({ erro: "Configure o provedor primeiro." }, { status: 400 });
      const n = base.config.numeros.find((x) => x.loja === p.loja);
      if (!n?.sessao) return NextResponse.json({ erro: "Essa loja não tem sessão configurada." }, { status: 400 });
      const sit = await adaptador.situacao(n.sessao);
      // Aproveita pra garantir que o painel recebe as conversas desse número
      const vale = await webhookQueVale(base.config);
      const wh = adaptador.garantirWebhook ? await adaptador.garantirWebhook(n.sessao, vale.url) : null;
      return NextResponse.json({ ...sit, detalhe: [sit.detalhe, wh?.detalhe, vale.aviso].filter(Boolean).join(" · ") });
    }
    if (p.tipo === "reiniciar-waakg") return NextResponse.json(await reiniciarWaakg());
    if (p.tipo === "testar-cupom") {
      try {
        const escopos = await escoposShopify();
        const ok = escopos.includes("write_discounts");
        return NextResponse.json({ ok, detalhe: ok ? "Ok: o painel pode criar e desativar cupom na Shopify." : `Falta a permissão write_discounts no app da Shopify do painel (tem: ${escopos.join(", ") || "nenhuma"}).` });
      } catch (e) {
        return NextResponse.json({ ok: false, detalhe: `Não consegui falar com a Shopify: ${e instanceof Error ? e.message : e}` });
      }
    }
    if (p.tipo === "registrar-oficial") {
      // O PIN é escolhido e digitado pelo dono; não fica salvo no painel
      const of = oficialDe((await lerBase()).config);
      if (!of.token || !of.phoneNumberId) return NextResponse.json({ erro: "Falta o token ou o ID do número." }, { status: 400 });
      const pin = String(p.pin ?? "").replace(/\D/g, "");
      if (pin.length !== 6) return NextResponse.json({ erro: "O PIN tem 6 números." }, { status: 400 });
      const r = await new CloudApi(of.token).registrar(of.phoneNumberId, pin);
      return NextResponse.json(r.ok ? { ok: true, detalhe: "Número registrado na API. Guarde o PIN: a Meta pede ele se um dia precisar registrar de novo." } : { erro: r.erro }, { status: r.ok ? 200 : 400 });
    }
    if (p.tipo === "teste-oficial") {
      // Manda o modelo de carrinho (aprovado) pro celular de quem testa: confere envio, botão e,
      // se a pessoa responder, o webhook e a resposta automática
      const of = oficialDe((await lerBase()).config);
      if (!of.token || !of.phoneNumberId) return NextResponse.json({ erro: "Falta o token ou o ID do número." }, { status: 400 });
      const tel = normalizarTelefone(String(p.telefone ?? ""));
      if (!tel) return NextResponse.json({ erro: "Celular inválido." }, { status: 400 });
      const r = await new CloudApi(of.token).enviarTemplate(of.phoneNumberId, tel, { nome: "via_sol_carrinho", idioma: "pt_BR", parametros: ["Fernando", "um biquíni de teste"], botao: "collections/all" });
      return NextResponse.json(r.ok ? { ok: true, detalhe: "Mandado. Responde a mensagem no celular pra testar a resposta automática." } : { erro: r.erro }, { status: r.ok ? 200 : 400 });
    }
    if (p.tipo === "testar-oficial" || p.tipo === "modelos-meta" || p.tipo === "criar-modelos-meta") {
      const of = oficialDe((await lerBase()).config);
      if (!of.token) return NextResponse.json({ erro: "Falta o token da Meta." }, { status: 400 });
      const api = new CloudApi(of.token);
      if (p.tipo === "testar-oficial") {
        if (!of.phoneNumberId) return NextResponse.json({ erro: "Falta o ID do número (phone number ID)." }, { status: 400 });
        const sit = await api.situacao(of.phoneNumberId);
        // Garante que este app recebe as respostas das clientes (webhook da conta)
        const webhook = of.wabaId ? await api.assinarWebhooks(of.wabaId) : { ok: false, erro: "falta o WABA ID" };
        return NextResponse.json({ ...sit, detalhe: [sit.detalhe, webhook.ok ? "webhook da conta ok" : `webhook da conta: ${webhook.erro}`].filter(Boolean).join(" · ") });
      }
      if (!of.wabaId) return NextResponse.json({ erro: "Falta o ID da conta do WhatsApp Business (WABA)." }, { status: 400 });
      if (p.tipo === "modelos-meta") return NextResponse.json({ modelos: await api.modelos(of.wabaId) });
      const existentes = new Set((await api.modelos(of.wabaId)).map((m) => m.name));
      const feitos = [];
      for (const m of MODELOS_SUGERIDOS) {
        if (existentes.has(m.nome)) feitos.push({ nome: m.nome, ok: true, detalhe: "já existe" });
        else feitos.push({ nome: m.nome, ...(await api.criarModelo(of.wabaId, payloadDoModelo(m, of))) });
      }
      return NextResponse.json({ feitos });
    }
    if (p.tipo === "limpar-atendimento") {
      // Apaga as conversas registradas de uma loja (ex.: o número de teste)
      const n = await alterarBase((b) => {
        const antes = b.atendimento.length + b.recebidas.length;
        b.atendimento = b.atendimento.filter((a) => a.loja !== p.loja);
        b.recebidas = b.recebidas.filter((r) => r.loja !== p.loja);
        return antes - b.atendimento.length - b.recebidas.length;
      });
      return NextResponse.json({ apagados: n });
    }
    if (p.tipo === "backup") {
      const base = await lerBase();
      return NextResponse.json({ backup: await copiaDeSeguranca(base, true) });
    }
    await alterarBase((b) => {
      if (p.tipo === "config") {
        const c = p.config;
        const atual = b.config;
        const nova: ConfigCrm = {
          ...atual,
          cashbackPct: num(c.cashbackPct, atual.cashbackPct, 0, 100),
          cashbackValidadeDias: num(c.cashbackValidadeDias, atual.cashbackValidadeDias, 1, 3650),
          cashbackCompraMinima: num(c.cashbackCompraMinima, atual.cashbackCompraMinima),
          cashbackResgateMinimo: num(c.cashbackResgateMinimo, atual.cashbackResgateMinimo),
          cashbackSite: c.cashbackSite !== undefined ? Boolean(c.cashbackSite) : atual.cashbackSite,
          siteNasAutomacoes: c.siteNasAutomacoes !== undefined ? Boolean(c.siteNasAutomacoes) : atual.siteNasAutomacoes,
          cashbackMaxPctDaCompra: num(c.cashbackMaxPctDaCompra, atual.cashbackMaxPctDaCompra, 0, 100),
          cashbackMultiploCompra: num(c.cashbackMultiploCompra, atual.cashbackMultiploCompra, 0, 20),
          avisoVencimentoDias: num(c.avisoVencimentoDias, atual.avisoVencimentoDias, 1, 60),
          avisoVencimentoUrgenteDias: num(c.avisoVencimentoUrgenteDias, atual.avisoVencimentoUrgenteDias, 0, 30),
          aniversarioOferta: typeof c.aniversarioOferta === "string" ? c.aniversarioOferta.trim() : atual.aniversarioOferta,
          aniversarioQuando: c.aniversarioQuando === "dia" || c.aniversarioQuando === "inicio_mes" ? c.aniversarioQuando : atual.aniversarioQuando,
          reativacaoFaixas: Array.isArray(c.reativacaoFaixas)
            ? c.reativacaoFaixas
                .map((f) => ({ minimo: num(f?.minimo, 0), oferta: String(f?.oferta ?? "").trim() }))
                .filter((f) => f.oferta && f.minimo >= 0)
            : atual.reativacaoFaixas,
          posVendaDias: num(c.posVendaDias, atual.posVendaDias, 1, 60),
          cashbackAvisoDias: num(c.cashbackAvisoDias, atual.cashbackAvisoDias ?? 3, 1, 30),
          reativacaoDias: num(c.reativacaoDias, atual.reativacaoDias, 7, 3650),
          reativacaoTicketMinimo: num(c.reativacaoTicketMinimo, atual.reativacaoTicketMinimo),
          reativacaoIntervaloDias: num(c.reativacaoIntervaloDias, atual.reativacaoIntervaloDias, 7, 3650),
          provedor: c.provedor && ["waakg", "cloudapi", "nenhum"].includes(c.provedor) ? c.provedor : atual.provedor,
          // https://… ou vazio (vazio = localhost, só até a WA-AKG 1.6)
          enderecoPublico:
            c.enderecoPublico !== undefined
              ? /^https:\/\/[^\s/]+/.test(c.enderecoPublico.trim()) || !c.enderecoPublico.trim()
                ? c.enderecoPublico.trim().replace(/\/+$/, "")
                : atual.enderecoPublico
              : atual.enderecoPublico,
          waakgLink:
            c.waakgLink !== undefined
              ? /^https?:\/\/[^\s/]+/.test(c.waakgLink.trim()) || !c.waakgLink.trim()
                ? c.waakgLink.trim().replace(/\/+$/, "")
                : atual.waakgLink
              : atual.waakgLink,
          waakgUrl: c.waakgUrl !== undefined ? c.waakgUrl.trim().replace(/\/+$/, "") || undefined : atual.waakgUrl,
          // Chave só muda se vier uma nova (a tela mostra mascarada)
          waakgApiKey: c.waakgApiKey && !c.waakgApiKey.includes("…") ? c.waakgApiKey.trim() : atual.waakgApiKey,
          cloudApiToken: c.cloudApiToken && !c.cloudApiToken.includes("…") ? c.cloudApiToken.trim() : atual.cloudApiToken,
          numeros: Array.isArray(c.numeros)
            ? c.numeros
                .filter((n) => n && typeof n.loja === "string")
                .map((n) => ({ loja: n.loja, sessao: String(n.sessao ?? "").trim(), ativo: Boolean(n.ativo), tetoDia: n.tetoDia ? num(n.tetoDia, 20, 1, 500) : undefined, vendedora: String(n.vendedora ?? "").trim() || undefined, endereco: String(n.endereco ?? "").trim().slice(0, 120) || undefined, horario: horarioLimpo(n.horario), mandarPor: String(n.mandarPor ?? "").trim() || undefined, ligarEm: /^\d{4}-\d{2}-\d{2}$/.test(String(n.ligarEm ?? "")) ? String(n.ligarEm) : undefined, telefone: String(n.telefone ?? "").replace(/\D/g, "").replace(/^(?!55)(\d{10,11})$/, "55$1") || undefined }))
            : atual.numeros,
          envioInicio: num(c.envioInicio, atual.envioInicio, 0, 23),
          envioFim: num(c.envioFim, atual.envioFim, 1, 24),
          envioDias: Array.isArray(c.envioDias) ? c.envioDias.map(Number).filter((d) => d >= 0 && d <= 6) : atual.envioDias,
          tetoDiaPorNumero: num(c.tetoDiaPorNumero, atual.tetoDiaPorNumero, 1, 500),
          tetoTemporario:
            c.tetoTemporario === undefined
              ? atual.tetoTemporario
              : c.tetoTemporario && /^\d{4}-\d{2}-\d{2}$/.test(String(c.tetoTemporario.ate))
                ? { valor: num(c.tetoTemporario.valor, 30, 1, 500), ate: String(c.tetoTemporario.ate) }
                : undefined,
          intervaloMinSeg: num(c.intervaloMinSeg, atual.intervaloMinSeg, 10, 3600),
          intervaloMaxSeg: num(c.intervaloMaxSeg, atual.intervaloMaxSeg, 10, 7200),
          maxSemResposta: num(c.maxSemResposta, atual.maxSemResposta, 1, 20),
          horaAutomacoes: typeof c.horaAutomacoes === "string" && /^\d{2}:\d{2}$/.test(c.horaAutomacoes) ? c.horaAutomacoes : atual.horaAutomacoes,
          pausado: c.pausado !== undefined ? Boolean(c.pausado) : atual.pausado,
          modoSombra: c.modoSombra !== undefined ? Boolean(c.modoSombra) : atual.modoSombra,
          maxMensagensMes: num(c.maxMensagensMes, atual.maxMensagensMes, 1, 30),
          avisoSair: c.avisoSair !== undefined ? Boolean(c.avisoSair) : atual.avisoSair,
          textoSair: typeof c.textoSair === "string" && /\bSAIR\b/i.test(c.textoSair) ? c.textoSair.trim().slice(0, 200) : atual.textoSair,
          backupDir: c.backupDir !== undefined ? c.backupDir.trim() || undefined : atual.backupDir,
        };
        if (nova.intervaloMaxSeg < nova.intervaloMinSeg) nova.intervaloMaxSeg = nova.intervaloMinSeg;
        if (nova.envioFim <= nova.envioInicio) throw new Error("O fim do horário de envio precisa ser depois do início.");
        b.config = nova;
      } else if (p.tipo === "oficial") {
        const o = p.oficial;
        const atual = oficialDe(b.config);
        // Chave mascarada (ou vazia) volta como veio: não troca o que já estava salvo
        const segredo = (novo: string | undefined, velho: string | undefined) => (novo === undefined || novo.includes("…") ? velho : novo.trim() || undefined);
        const nova: ConfigOficial = {
          ...atual,
          token: segredo(o.token, b.config.oficial?.token),
          appSecret: segredo(o.appSecret, b.config.oficial?.appSecret),
          phoneNumberId: o.phoneNumberId !== undefined ? o.phoneNumberId.replace(/\D/g, "") || undefined : atual.phoneNumberId,
          wabaId: o.wabaId !== undefined ? o.wabaId.replace(/\D/g, "") || undefined : atual.wabaId,
          sombra: o.sombra !== undefined ? Boolean(o.sombra) : atual.sombra,
          campanhas: Array.isArray(o.campanhas) ? o.campanhas.filter((c) => CAMPANHAS.some((x) => x.id === c)) : atual.campanhas,
          inicio: num(o.inicio, atual.inicio, 0, 23),
          fim: num(o.fim, atual.fim, 1, 24),
          dias: Array.isArray(o.dias) ? o.dias.map(Number).filter((d) => d >= 0 && d <= 6) : atual.dias,
          tetoDia: num(o.tetoDia, atual.tetoDia, 1, 100000),
          carrinhoMinutos: num(o.carrinhoMinutos, atual.carrinhoMinutos, 15, 1380),
          carrinhoMinimo: num(o.carrinhoMinimo, atual.carrinhoMinimo),
          carrinhoSoComAceite: o.carrinhoSoComAceite !== undefined ? Boolean(o.carrinhoSoComAceite) : atual.carrinhoSoComAceite,
          carrinhoIntervaloDias: num(o.carrinhoIntervaloDias, atual.carrinhoIntervaloDias, 0, 90),
          pixMinutos: num(o.pixMinutos, atual.pixMinutos, 10, 1380),
          pagamentoTodos: o.pagamentoTodos !== undefined ? Boolean(o.pagamentoTodos) : atual.pagamentoTodos,
          urlBase: typeof o.urlBase === "string" && /^https:\/\/[^\s]+$/.test(o.urlBase.trim()) ? o.urlBase.trim() : atual.urlBase,
          autoResposta: o.autoResposta !== undefined ? Boolean(o.autoResposta) : atual.autoResposta,
          whatsAtendimento: o.whatsAtendimento !== undefined ? String(o.whatsAtendimento).replace(/\D/g, "").replace(/^(?!55)(\d{10,11})$/, "55$1") || undefined : atual.whatsAtendimento,
        };
        if (nova.fim <= nova.inicio) throw new Error("O fim do horário do site precisa ser depois do início.");
        b.config.oficial = nova;
      } else if (p.tipo === "modelo") {
        if (!CAMPANHAS.some((c) => c.id === p.modelo.campanha)) throw new Error("Campanha desconhecida.");
        const variacoes = (p.modelo.variacoes ?? []).map((v) => String(v).trim()).filter(Boolean).slice(0, 10);
        const existente = b.modelos.find((m) => m.campanha === p.modelo.campanha);
        // Modelo da Meta (pela API oficial): nome, idioma e o que vai em cada variável
        const t = p.modelo.template;
        const template: TemplateMeta | undefined =
          t === undefined
            ? existente?.template
            : t && String(t.nome ?? "").trim()
              ? {
                  nome: String(t.nome).trim(),
                  idioma: String(t.idioma ?? "pt_BR").trim() || "pt_BR",
                  parametros: (t.parametros ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10),
                  botaoLink: Boolean(t.botaoLink),
                  botaoVar: ["link", "whatsLoja", "codigo"].includes(String(t.botaoVar)) ? String(t.botaoVar) : existente?.template?.botaoVar,
                }
              : undefined;
        if (existente) {
          existente.ativo = Boolean(p.modelo.ativo);
          existente.variacoes = variacoes;
          existente.template = template;
        } else b.modelos.push({ campanha: p.modelo.campanha, ativo: Boolean(p.modelo.ativo), variacoes, template });
      } else throw new Error("Pedido desconhecido.");
    });
    // Número salvo: garante o webhook de cada um em segundo plano
    if (p.tipo === "config" && p.config.numeros) void configurarWebhooks().catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}

/**
 * Reinicia a WA-AKG de longe (ex.: depois de mudar o .env dela). Só derruba se
 * ela foi ligada pelo painel, que a religa sozinho em uns 10 segundos; aberta
 * por fora, ninguém religaria, então não mexe.
 */
function reiniciarWaakg(): Promise<{ ok: boolean; detalhe: string }> {
  if (process.platform !== "win32") return Promise.resolve({ ok: false, detalhe: "Só funciona no computador com Windows onde a WA-AKG roda." });
  const script = `
$ps = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server.index\\.ts' })
if ($ps.Count -eq 0) { 'nao-rodando'; exit }
$doPainel = $false
foreach ($p in $ps) {
  $pai = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
  if ($pai -and $pai.CommandLine -match 'painel\\.mjs') { $doPainel = $true }
}
if (-not $doPainel) { 'por-fora'; exit }
$ps | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
'ok'`;
  return new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-Command", script], { timeout: 30000 }, (erro, saida) => {
      const r = String(saida ?? "").trim().split(/\s+/).pop();
      if (r === "ok") resolve({ ok: true, detalhe: "WhatsApp reiniciando. Volta em uns 30 segundos." });
      else if (r === "nao-rodando") resolve({ ok: false, detalhe: "A WA-AKG não está rodando. O painel deve ligá-la em até 1 minuto." });
      else if (r === "por-fora") resolve({ ok: false, detalhe: "A WA-AKG foi aberta fora do painel (iniciar-whatsapp.cmd); feche aquela janela e reinicie o painel." });
      else resolve({ ok: false, detalhe: `Não consegui reiniciar${erro ? `: ${erro.message}` : ""}` });
    });
  });
}
