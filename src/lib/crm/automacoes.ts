/**
 * Automações do dia: rodam uma vez por dia (agendador ou botão da tela) e
 * só põem mensagens na fila. Quem manda, e em que ritmo, é a fila.
 */

import { alterarBase, diasEntre, hojeSp, lerBase, novoId, somarDias } from "./base";
import { creditosAbertos, expirarCreditos, vencendoAte } from "./cashback";
import { JUNTO, campanhaDoCredito, creditosParaAviso, prepararCuponsSite, sombraDaCampanha } from "./cupomShopify";
import { resumir } from "./clientes";
import { assinatura, conta as contaNoLimite, ehMarketing, enfileirar } from "./mensagens";
import { LOJA_CIDADE, type BaseCrm, type Cliente } from "./tipos";

const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Loja na cidade da cliente, se houver (pela cidade do endereço de entrega do site). */
export function lojaNaCidade(c: Cliente): string | undefined {
  if (!c.cidade) return undefined;
  const cid = semAcento(c.cidade);
  // Em Franca tem três lojas: a cliente é mandada pra Centro
  for (const [loja, cidade] of Object.entries(LOJA_CIDADE)) if (semAcento(cidade) === cid) return loja;
  return undefined;
}

/** Oferta da reativação pelo total gasto: vale a maior faixa atingida. */
export function ofertaReativacao(b: BaseCrm, totalGasto: number): string | undefined {
  const faixas = [...(b.config.reativacaoFaixas ?? [])].sort((x, y) => y.minimo - x.minimo);
  return faixas.find((f) => totalGasto >= f.minimo)?.oferta;
}

/** Reativações por loja por dia: evita encher a fila de uma vez. */
const REATIVACOES_POR_LOJA_DIA = 10;

export interface ResultadoAutomacoes {
  dia: string;
  expirados: number;
  semResposta: number;
  enfileiradas: Record<string, number>;
  puladas: Record<string, number>;
}

export function rodarAutomacoesEm(b: BaseCrm, hoje = hojeSp()): ResultadoAutomacoes {
  const r: ResultadoAutomacoes = { dia: hoje, expirados: 0, semResposta: 0, enfileiradas: {}, puladas: {} };
  const conta = (mapa: Record<string, number>, k: string) => (mapa[k] = (mapa[k] ?? 0) + 1);
  const tentar = (campanha: string, res: { mensagem?: unknown; motivo?: string }) =>
    res.mensagem ? conta(r.enfileiradas, campanha) : conta(r.puladas, `${campanha}: ${res.motivo}`);

  r.expirados = expirarCreditos(b, hoje);

  // Marketing mandado há mais de 7 dias sem resposta conta contra a cliente
  const limite = new Date(Date.now() - 7 * 86400000).toISOString();
  for (const m of b.mensagens) {
    if (m.avaliada || !m.enviadoEm || m.enviadoEm > limite || !ehMarketing(m.campanha)) continue;
    if (!["enviada", "entregue", "lida"].includes(m.status)) continue;
    m.avaliada = true;
    const c = b.clientes.find((x) => x.id === m.clienteId);
    if (c) {
      c.semResposta += 1;
      r.semResposta++;
    }
  }

  const porId = new Map(b.clientes.map((c) => [c.id, c]));

  // Cliente que só comprou no site é cuidada pelo CRM do e-commerce, a não
  // ser que a configuração diga o contrário. Avisos de cashback do site
  // passam só quando o cashback do site está ligado.
  const lojasDe = new Map<string, Set<string>>();
  for (const v of b.vendas) if (v.clienteId) (lojasDe.get(v.clienteId) ?? lojasDe.set(v.clienteId, new Set()).get(v.clienteId)!).add(v.loja);
  const soSite = (id: string) => {
    const lojas = lojasDe.get(id);
    const c = porId.get(id);
    return Boolean(lojas && lojas.size === 1 && lojas.has("Site") && !c?.codigoTotvs && c?.lojaOrigem === "Site");
  };
  const participa = (id: string) => b.config.siteNasAutomacoes || !soSite(id);

  // Cashback creditado: o aviso sai `cashbackAvisoDias` depois da compra (padrão 3),
  // quando já deu tempo de trocar ou devolver; pega também os créditos que ainda
  // não foram avisados (até 30 dias). Vai o que sobrou do crédito.
  // Loja: uma mensagem só por cliente (quem comprou 3 vezes no mês não recebe 3 avisos
  // seguidos). Vai a da compra mais recente; as outras ficam marcadas como avisadas junto.
  // Site não junta: cada crédito tem o seu cupom.
  const comAviso = new Set(b.mensagens.filter((m) => m.campanha === "cashback_creditado" && (m.status === "fila" || m.status === "enviando")).map((m) => m.clienteId));
  const paraAvisar = creditosParaAviso(b, hoje).sort((p, q) => q.diaDaCompra.localeCompare(p.diaDaCompra));
  for (const x of paraAvisar) {
    const { mov, cliente: c, venda, diaDaCompra, valor } = x;
    if (mov.loja !== "Site" && comAviso.has(c.id)) {
      b.mensagens.push({ id: novoId(), clienteId: c.id, telefone: c.telefone ?? "", campanha: "cashback_creditado", loja: mov.loja ?? "", texto: "", status: "cancelada", erro: JUNTO, naoAntesDe: new Date().toISOString(), criadoEm: new Date().toISOString(), tentativas: 0, chave: `cb-credito-${mov.id}` });
      continue;
    }
    if (mov.loja === "Site") {
      // Compra no site: cupom na Shopify com o mesmo código da loja; lembra a loja da cidade, se tiver
      const perto = lojaNaCidade(c);
      const campanha = campanhaDoCredito(mov, c, lojaNaCidade);
      const cupom = b.codigos.find((k) => k.movimentoId === mov.id && k.shopifyId && !k.usadoEm && !k.shopifyDesativado);
      const sombra = sombraDaCampanha(b, campanha);
      if (!cupom && !sombra) {
        tentar(campanha, { motivo: "cupom da Shopify ainda não criado" });
        continue;
      }
      const res = enfileirar(b, {
        cliente: c,
        campanha,
        loja: perto,
        variaveis: { valor, validade: mov.validade, dataCompra: diaDaCompra, codigo: cupom?.codigo ?? "XXXXXX", lojaProxima: perto, cidade: perto ? LOJA_CIDADE[perto] : undefined, endereco: b.config.numeros.find((n) => n.loja === perto)?.endereco },
        chave: `cb-credito-${mov.id}`,
      });
      if (res.mensagem && cupom) cupom.mensagemId = res.mensagem.id;
      tentar(campanha, res);
      continue;
    }
    const res = enfileirar(b, {
      cliente: c,
      campanha: "cashback_creditado",
      loja: mov.loja,
      variaveis: { valor, validade: mov.validade, dataCompra: diaDaCompra, vendedora: assinatura(b, mov.loja, venda?.vendedoraCpf) },
      chave: `cb-credito-${mov.id}`,
    });
    if (res.mensagem && res.mensagem.status !== "simulada") comAviso.add(c.id);
    tentar("cashback_creditado", res);
  }

  // Cashback vencendo: um aviso com folga e um último, com urgência
  const avisos: { campanha: "cashback_vencendo" | "cashback_vencendo_urgente"; dias: number }[] = [
    { campanha: "cashback_vencendo", dias: b.config.avisoVencimentoDias },
    { campanha: "cashback_vencendo_urgente", dias: b.config.avisoVencimentoUrgenteDias },
  ];
  for (const c of b.clientes) {
    for (const av of avisos) {
      const v = vencendoAte(b, c.id, somarDias(hoje, av.dias), hoje);
      if (v.valor <= 0 || !v.em) continue;
      // Já na janela de urgência, só o último aviso sai
      if (av.campanha === "cashback_vencendo" && v.em <= somarDias(hoje, b.config.avisoVencimentoUrgenteDias)) continue;
      const credito = creditosAbertos(b, c.id, hoje).find((x) => x.validade === v.em);
      const lojaDela = c.lojaOrigem === "Site" ? lojaNaCidade(c) : c.lojaOrigem;
      tentar(
        av.campanha,
        enfileirar(b, { cliente: c, campanha: av.campanha, loja: lojaDela, variaveis: { valor: v.valor, validade: v.em }, chave: `${av.campanha}-${c.id}-${credito?.movimentoId ?? v.em}` })
      );
    }
  }

  // Aniversário: no começo do mês (ela tem o mês todo pra usar) ou no dia
  const mmdd = hoje.slice(5);
  const mes = hoje.slice(5, 7);
  const inicioDoMes = b.config.aniversarioQuando === "inicio_mes";
  for (const c of b.clientes) {
    if (!c.nascimento || !participa(c.id)) continue;
    if (inicioDoMes) {
      // A partir do dia 1 (a chave por ano garante uma vez só); quem já fez aniversário quando a campanha ligou fica de fora
      if (c.nascimento.slice(5, 7) !== mes || c.nascimento.slice(8, 10) < hoje.slice(8, 10)) continue;
    } else if (c.nascimento.slice(5) !== mmdd) continue;
    tentar("aniversario", enfileirar(b, { cliente: c, campanha: "aniversario", loja: c.lojaOrigem === "Site" ? lojaNaCidade(c) : c.lojaOrigem, variaveis: { oferta: b.config.aniversarioOferta }, oferta: b.config.aniversarioOferta, chave: `aniv-${c.id}-${hoje.slice(0, 4)}` }));
  }

  // Pós-venda
  const diaPos = somarDias(hoje, -b.config.posVendaDias);
  for (const v of b.vendas) {
    if (!v.clienteId || v.data.slice(0, 10) !== diaPos || !participa(v.clienteId)) continue;
    const c = porId.get(v.clienteId);
    if (c) tentar("pos_venda", enfileirar(b, { cliente: c, campanha: "pos_venda", loja: v.loja, chave: `pos-${v.id}` }));
  }

  // Reativação: boas clientes paradas, poucas por loja por dia, respeitando o intervalo
  const porLoja = new Map<string, number>();
  const candidatas = b.clientes
    .map((c) => resumir(b, c, hoje))
    .filter((x) => participa(x.id))
    .filter((x) => x.podeMarketing && x.totalGasto >= b.config.reativacaoTicketMinimo && x.ultimaCompra && diasEntre(x.ultimaCompra, hoje) >= b.config.reativacaoDias)
    .filter((x) => {
      const ultima = b.mensagens
        .filter((m) => m.clienteId === x.id && m.campanha === "reativacao" && contaNoLimite(b, m))
        .sort((p, q) => q.criadoEm.localeCompare(p.criadoEm))[0];
      return !ultima || diasEntre(ultima.criadoEm.slice(0, 10), hoje) >= b.config.reativacaoIntervaloDias;
    })
    .sort((p, q) => q.totalGasto - p.totalGasto);
  for (const x of candidatas) {
    const loja = x.ultimaLoja ?? x.lojaOrigem ?? "";
    if ((porLoja.get(loja) ?? 0) >= REATIVACOES_POR_LOJA_DIA) continue;
    const oferta = ofertaReativacao(b, x.totalGasto);
    if (!oferta) continue; // sem faixa, sem gancho: não manda
    const res = enfileirar(b, { cliente: x, campanha: "reativacao", loja, variaveis: { oferta }, oferta, chave: `reat-${x.id}-${hoje}` });
    tentar("reativacao", res);
    if (res.mensagem) porLoja.set(loja, (porLoja.get(loja) ?? 0) + 1);
  }

  b.config.ultimaAutomacao = hoje;
  return r;
}

/** Roda as automações do dia, uma vez só por dia (a não ser que `forcar`). */
export async function rodarAutomacoes(forcar = false): Promise<ResultadoAutomacoes | null> {
  const hoje = hojeSp();
  // Cupons do site na Shopify antes: o aviso leva o código
  if (forcar || (await lerBase()).config.ultimaAutomacao !== hoje) await prepararCuponsSite(lojaNaCidade).catch((e) => console.error("[crm] cupons do site:", e instanceof Error ? e.message : e));
  return alterarBase((b) => {
    if (!forcar && b.config.ultimaAutomacao === hoje) return null;
    return rodarAutomacoesEm(b, hoje);
  });
}
