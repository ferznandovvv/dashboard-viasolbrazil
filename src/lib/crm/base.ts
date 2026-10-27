/**
 * Onde o CRM mora: um arquivo JSON na máquina (dados/crm/base.json), com
 * cópia de segurança numa pasta à escolha, igual ao financeiro.
 *
 * Toda escrita passa por uma fila única do processo. Só roda no servidor Node.
 */

import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { type BaseCrm, CONFIG_PADRAO, MODELOS_PADRAO, oficialDe } from "./tipos";
import { normalizarTelefone } from "./telefone";

const PASTA = join(process.env.DADOS_DIR ?? join(process.cwd(), "dados"), "crm");
const ARQUIVO = join(PASTA, "base.json");
const MANTER_COPIAS = 60;
const INTERVALO_BACKUP_MS = 30 * 60000;

export const novoId = () => randomUUID().slice(0, 10);

function inicial(): BaseCrm {
  return {
    versao: 1,
    clientes: [],
    vendas: [],
    cashback: [],
    codigos: [],
    mensagens: [],
    recebidas: [],
    atendimento: [],
    vendedoras: {},
    modelos: structuredClone(MODELOS_PADRAO),
    campanhas: [],
    config: { ...CONFIG_PADRAO, webhookSegredo: randomBytes(12).toString("hex") },
  };
}

const global = globalThis as unknown as { __filaCrm?: Promise<unknown>; __backupCrm?: number };

async function ler(): Promise<BaseCrm> {
  try {
    return JSON.parse(await readFile(ARQUIVO, "utf8")) as BaseCrm;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // corrompido: não sobrescreve
    const base = inicial();
    await gravar(base);
    return base;
  }
}

/** Grava num arquivo temporário e troca: queda de energia não corrompe a base. */
async function gravar(base: BaseCrm): Promise<void> {
  await mkdir(PASTA, { recursive: true });
  const tmp = `${ARQUIVO}.tmp`;
  await writeFile(tmp, JSON.stringify(base), "utf8");
  await rename(tmp, ARQUIVO);
}

/** Ajustes que entram com versões novas e precisam valer para a base que já existe. */
const MIGRACOES: { id: string; aplicar: (b: BaseCrm) => void }[] = [
  { id: "atendimento", aplicar: (b) => void (b.atendimento ??= []) },
  {
    // Regras combinadas em 16/10: 15% com compra de 3x, 90 dias (33 desde 21/10), dois lembretes,
    // site gera cashback, textos novos, boas-vindas desligada
    id: "regras-v2",
    aplicar: (b) => {
      Object.assign(b.config, {
        cashbackPct: 15,
        cashbackValidadeDias: 90,
        cashbackResgateMinimo: 0,
        cashbackMaxPctDaCompra: 0,
        cashbackMultiploCompra: 3,
        cashbackSite: true,
        avisoVencimentoDias: 10,
        avisoVencimentoUrgenteDias: 2,
        aniversarioOferta: "10% de desconto",
        reativacaoFaixas: CONFIG_PADRAO.reativacaoFaixas,
        reativacaoTicketMinimo: 500,
      });
      b.modelos = structuredClone(MODELOS_PADRAO);
    },
  },
  {
    // Mensagens assinadas pela vendedora, aniversário no mês inteiro
    id: "vendedora-v3",
    aplicar: (b) => {
      b.vendedoras ??= {};
      b.config.aniversarioQuando ??= "inicio_mes";
      b.modelos = structuredClone(MODELOS_PADRAO);
    },
  },
  {
    // Começa em modo sombra e com limite de 2 mensagens por cliente por mês
    id: "sombra-limite",
    aplicar: (b) => {
      b.config.modoSombra ??= true;
      b.config.maxMensagensMes ??= 2;
      b.modelos = structuredClone(MODELOS_PADRAO);
    },
  },
  {
    // Todo mundo que compra aceita contato: quem entrou antes dessa regra ganha o aceite.
    // Telefone que não é telefone sai. Funcionária identificada pelo nome não recebe mensagem.
    id: "aceite-geral",
    aplicar: (b) => {
      const funcionaria = /FUNCION[AÁ]RI|COLABORADOR|VENDEDOR[A]?\b|GERENTE|USO INTERNO/i;
      for (const c of b.clientes) {
        if (!c.optOut) c.optIn = true;
        if (c.telefone && !normalizarTelefone(c.telefone)) c.telefone = undefined;
        if (funcionaria.test(c.nome) && !c.optOut) {
          c.optOut = true;
          c.optOutEm = new Date().toISOString();
          c.obs = [c.obs, "Funcionária (pelo nome no cadastro)"].filter(Boolean).join(" · ");
        }
      }
    },
  },
  {
    // Aba Campanhas; números antigos aguentam mais que 20 por dia; o que foi
    // gerado em modo sombra vira "simulada" para não sair quando o modo for desligado
    id: "campanhas-v1",
    aplicar: (b) => {
      b.campanhas ??= [];
      if (b.config.tetoDiaPorNumero === 20) b.config.tetoDiaPorNumero = 50;
      if (b.config.modoSombra) for (const m of b.mensagens) if (m.status === "fila") m.status = "simulada";
    },
  },
  {
    // Cashback do site: só pra quem mora numa cidade com loja, lembrando o endereço
    id: "site-perto-v2",
    aplicar: (b) => {
      for (const id of ["cashback_site_perto", "cashback_site_longe"] as const) {
        const novo = MODELOS_PADRAO.find((m) => m.campanha === id)!;
        const i = b.modelos.findIndex((m) => m.campanha === id);
        if (i >= 0) b.modelos[i] = structuredClone(novo);
        else b.modelos.push(structuredClone(novo));
      }
      // O que já estava simulado pra quem mora longe some da fila
      b.mensagens = b.mensagens.filter((m) => !(m.campanha === "cashback_site_longe" && m.status === "simulada"));
    },
  },
  {
    // Aviso de como sair na primeira mensagem de cada cliente
    id: "aviso-sair",
    aplicar: (b) => {
      b.config.avisoSair ??= CONFIG_PADRAO.avisoSair;
      b.config.textoSair ??= CONFIG_PADRAO.textoSair;
    },
  },
  {
    // Lançamento do cashback nas lojas: o texto leva a data certa da compra
    // (não "ontem" fixo) e, na primeira fase, só saem os avisos de cashback
    // (aniversário fica para depois)
    id: "lancamento-cashback-v1",
    aplicar: (b) => {
      for (const m of b.modelos) {
        if (m.campanha === "cashback_creditado")
          m.variacoes = m.variacoes.map((t) => t.replace("Sua compra de ontem", "Sua compra {daCompra}").replace("obrigada pela visita ontem!", "obrigada pela visita {quando}!"));
        if (m.campanha === "aniversario") m.ativo = false;
      }
    },
  },
  {
    // Lançamento: as vendas das lojas desde 16/10 entraram pela carga (sem
    // cashback). O Fernando decidiu creditar todas elas, com a regra de hoje;
    // o aviso sai na automação seguinte, com a data de cada compra.
    id: "cashback-retroativo-2026-10-16",
    aplicar: (b) => {
      const pct = b.config.cashbackPct;
      if (!(pct > 0)) return;
      const creditadas = new Set(b.cashback.filter((m) => m.tipo === "credito").map((m) => m.vendaId));
      const agora = new Date().toISOString();
      for (const v of b.vendas) {
        if (v.loja === "Site" || !v.clienteId || v.valor <= 0 || v.valor < b.config.cashbackCompraMinima) continue;
        if (v.data.slice(0, 10) < "2026-10-16" || creditadas.has(v.id)) continue;
        const valor = Math.round(v.valor * pct) / 100;
        if (valor < 0.01) continue;
        b.cashback.push({ id: novoId(), clienteId: v.clienteId, tipo: "credito", valor, vendaId: v.id, validade: somarDias(v.data.slice(0, 10), b.config.cashbackValidadeDias), loja: v.loja, criadoEm: agora, por: "sistema" });
        creditadas.add(v.id);
      }
    },
  },
  {
    // Devoluções conferidas antes de a compra ficar marcada (troca = uma compra só):
    // desfaz e deixa a diária ler de novo, já do jeito novo
    id: "devolucoes-marcam-compra",
    aplicar: (b) => {
      const velhas = new Set((b.devolucoes ?? []).filter((d) => d.tipo === "devolucao" && !d.partes).map((d) => d.id));
      if (!velhas.size) return;
      b.devolucoes = (b.devolucoes ?? []).filter((d) => !velhas.has(d.id));
      b.cashback = b.cashback.filter((m) => !(m.devolucaoId && velhas.has(m.devolucaoId)));
    },
  },
  {
    // E-commerce: carrinho abandonado e Pix não pago, pelo número oficial (em sombra)
    id: "modelos-site-v1",
    aplicar: (b) => {
      for (const m of MODELOS_PADRAO) if (!b.modelos.some((x) => x.campanha === m.campanha)) b.modelos.push(structuredClone(m));
    },
  },
  {
    // Cashback do site vira cupom na Shopify (vale no site e na loja): textos
    // com o código e aviso também pra quem mora longe de loja. Aviso 3 dias
    // depois da compra (dá tempo de trocar).
    id: "cupom-site-v1",
    aplicar: (b) => {
      for (const campanha of ["cashback_site_perto", "cashback_site_longe"] as const) {
        const padrao = MODELOS_PADRAO.find((m) => m.campanha === campanha)!;
        const m = b.modelos.find((x) => x.campanha === campanha);
        if (!m) b.modelos.push(structuredClone(padrao));
        else if (!m.variacoes.some((v) => v.includes("{codigo}"))) {
          m.variacoes = [...padrao.variacoes];
          m.ativo = true;
        }
      }
      b.config.cashbackAvisoDias ??= 3;
    },
  },
  {
    // Carrinho e Pix também pela WA-AKG (número do site): texto com o link no corpo, sem "botão"
    id: "textos-site-waakg",
    aplicar: (b) => {
      for (const campanha of ["carrinho_abandonado", "pix_pendente"] as const) {
        const m = b.modelos.find((x) => x.campanha === campanha);
        const padrao = MODELOS_PADRAO.find((x) => x.campanha === campanha)!;
        if (m && m.variacoes.some((v) => /botão/.test(v))) m.variacoes = [...padrao.variacoes];
      }
    },
  },
  {
    // Site: 6 pedidos de 16/10 entraram na base antes de o cashback do site
    // ligar. Mesma regra das lojas: tudo desde 16/10 tem cashback.
    id: "cashback-site-retroativo-2026-10-16",
    aplicar: (b) => {
      const pct = b.config.cashbackPct;
      if (!(pct > 0) || !b.config.cashbackSite) return;
      const creditadas = new Set(b.cashback.filter((m) => m.tipo === "credito").map((m) => m.vendaId));
      const agora = new Date().toISOString();
      for (const v of b.vendas) {
        if (v.loja !== "Site" || !v.clienteId || v.valor <= 0 || v.valor < b.config.cashbackCompraMinima) continue;
        if (v.data.slice(0, 10) < "2026-10-16" || creditadas.has(v.id)) continue;
        const valor = Math.round(v.valor * pct) / 100;
        if (valor < 0.01) continue;
        b.cashback.push({ id: novoId(), clienteId: v.clienteId, tipo: "credito", valor, vendaId: v.id, validade: somarDias(v.data.slice(0, 10), b.config.cashbackValidadeDias), loja: "Site", criadoEm: agora, por: "sistema" });
        creditadas.add(v.id);
      }
    },
  },
  {
    // Site: o Fernando decidiu dar cashback de todas as compras do site de
    // outubro (antes começava em 16/10). Pelo valor que ficou (reembolso
    // parcial descontado); o aviso sai na automação seguinte, com o cupom.
    id: "cashback-site-retroativo-2026-10-01",
    aplicar: (b) => {
      const pct = b.config.cashbackPct;
      if (!(pct > 0) || !b.config.cashbackSite) return;
      const creditadas = new Set(b.cashback.filter((m) => m.tipo === "credito").map((m) => m.vendaId));
      const agora = new Date().toISOString();
      for (const v of b.vendas) {
        if (v.loja !== "Site" || !v.clienteId || v.data.slice(0, 10) < "2026-10-01" || creditadas.has(v.id)) continue;
        const liquido = v.valor - (v.devolvido ?? 0);
        if (liquido <= 0 || liquido < b.config.cashbackCompraMinima) continue;
        const valor = Math.round(liquido * pct) / 100;
        if (valor < 0.01) continue;
        b.cashback.push({ id: novoId(), clienteId: v.clienteId, tipo: "credito", valor, vendaId: v.id, validade: somarDias(v.data.slice(0, 10), b.config.cashbackValidadeDias), loja: "Site", criadoEm: agora, por: "sistema" });
        creditadas.add(v.id);
      }
    },
  },
  {
    // Lojas: o Fernando estendeu o retroativo para outubro inteiro (antes era
    // desde 16/10). Pelo valor que ficou (devolução descontada).
    id: "cashback-lojas-retroativo-2026-10-01",
    aplicar: (b) => {
      const pct = b.config.cashbackPct;
      if (!(pct > 0)) return;
      const creditadas = new Set(b.cashback.filter((m) => m.tipo === "credito").map((m) => m.vendaId));
      const agora = new Date().toISOString();
      for (const v of b.vendas) {
        if (v.loja === "Site" || !v.clienteId || v.data.slice(0, 10) < "2026-10-01" || creditadas.has(v.id)) continue;
        const liquido = v.valor - (v.devolvido ?? 0);
        if (liquido <= 0 || liquido < b.config.cashbackCompraMinima) continue;
        const valor = Math.round(liquido * pct) / 100;
        if (valor < 0.01) continue;
        b.cashback.push({ id: novoId(), clienteId: v.clienteId, tipo: "credito", valor, vendaId: v.id, validade: somarDias(v.data.slice(0, 10), b.config.cashbackValidadeDias), loja: v.loja, criadoEm: agora, por: "sistema" });
        creditadas.add(v.id);
      }
    },
  },
  {
    // Lançamento com o acumulado de outubro: no máximo 30 por número por dia,
    // pra não ter pico (o Fernando prefere demorar e não arriscar o número)
    id: "teto-lancamento-30",
    aplicar: (b) => {
      b.config.tetoTemporario ??= { valor: 30, ate: "2026-11-15" };
    },
  },
  {
    // O botão de rodar automações clicado duas vezes criou cupom em dobro na
    // Shopify. Fica o que foi na mensagem; o outro vira "usado" e a leitura do
    // site (10 min) desativa na Shopify.
    id: "cupons-duplicados-2026-10-21",
    aplicar: (b) => {
      const porCredito = new Map<string, typeof b.codigos>();
      for (const k of b.codigos) if (k.shopifyId && k.movimentoId) (porCredito.get(k.movimentoId) ?? porCredito.set(k.movimentoId, []).get(k.movimentoId)!).push(k);
      const agora = new Date().toISOString();
      for (const lista of porCredito.values()) {
        if (lista.length < 2) continue;
        const fica = lista.find((k) => k.mensagemId) ?? lista[0];
        for (const k of lista) if (k !== fica && !k.usadoEm) (k.usadoEm = agora), (k.usadoNaLoja = "duplicado");
      }
    },
  },
  {
    // Quem comprou mais de uma vez em outubro ficou com 2 ou 3 avisos de cashback
    // seguidos na fila. Fica o da compra mais recente; os outros saem da fila,
    // marcados como avisados junto (não voltam amanhã).
    id: "cashback-um-aviso-por-cliente",
    aplicar: (b) => {
      const vendaDe = new Map(b.vendas.map((v) => [v.id, v.data]));
      const credito = new Map(b.cashback.map((m) => [m.id, m]));
      const dia = (chave?: string) => {
        const m = chave ? credito.get(chave.replace("cb-credito-", "")) : undefined;
        return (m?.vendaId ? vendaDe.get(m.vendaId) : undefined) ?? m?.criadoEm ?? "";
      };
      const porCliente = new Map<string, typeof b.mensagens>();
      for (const m of b.mensagens) if (m.campanha === "cashback_creditado" && m.status === "fila") (porCliente.get(m.clienteId) ?? porCliente.set(m.clienteId, []).get(m.clienteId)!).push(m);
      for (const lista of porCliente.values()) {
        if (lista.length < 2) continue;
        lista.sort((p, q) => dia(q.chave).localeCompare(dia(p.chave)));
        for (const m of lista.slice(1)) (m.status = "cancelada"), (m.erro = "Junto com outro aviso de cashback");
      }
    },
  },
  {
    // Cashback do site pra quem tem loja perto: assina a vendedora da loja (mais intimidade)
    id: "site-perto-vendedora",
    aplicar: (b) => {
      const m = b.modelos.find((x) => x.campanha === "cashback_site_perto");
      const padrao = MODELOS_PADRAO.find((x) => x.campanha === "cashback_site_perto")!;
      if (m && !m.variacoes.some((v) => v.includes("{vendedora}"))) m.variacoes = [...padrao.variacoes];
    },
  },
  {
    // Pix da PagBrasil vence em 30 min: o lembrete sai com 10 e leva o código
    // copia e cola; o que venceu sem lembrete vira "Pix vencido" com o carrinho
    // montado de novo.
    id: "pix-copia-e-cola-v1",
    aplicar: (b) => {
      const pix = b.modelos.find((x) => x.campanha === "pix_pendente");
      const padrao = MODELOS_PADRAO.find((x) => x.campanha === "pix_pendente")!;
      if (pix && !pix.variacoes.some((v) => v.includes("{expira}"))) pix.variacoes = [...padrao.variacoes];
      if (!b.modelos.some((x) => x.campanha === "pix_expirado")) b.modelos.push(structuredClone(MODELOS_PADRAO.find((x) => x.campanha === "pix_expirado")!));
      const of = b.config.oficial;
      if (of) {
        if (of.pixMinutos === undefined || of.pixMinutos >= 30) of.pixMinutos = 10;
        if (of.campanhas?.includes("pix_pendente") && !of.campanhas.includes("pix_expirado")) of.campanhas.push("pix_expirado");
      }
    },
  },
  {
    // Loja de Fábrica não tem número: as clientes dela recebem pelo do Centro
    // (as duas em Franca). Fica em Configurar › Números.
    id: "loja-fabrica-pelo-centro",
    aplicar: (b) => {
      const n = b.config.numeros.find((x) => x.loja === "Loja de Fábrica");
      if (n && !n.mandarPor && !(n.ativo && n.sessao)) n.mandarPor = "Centro";
    },
  },
  {
    // 21/10: cashback passa a valer 33 dias da compra (30 depois do aviso), pra
    // dar urgência de voltar. O que já foi avisado à cliente mantém a data
    // prometida. O que ainda não foi avisado (e a loja tem número) passa a valer
    // 33 dias a partir de hoje, e o texto na fila ganha a data nova.
    id: "validade-33-dias-2026-10-21",
    aplicar: (b) => {
      b.config.cashbackValidadeDias = 33;
      encurtarValidades(b);
    },
  },
  {
    // A Loja de Fábrica ficou de fora do de cima (não tinha número); agora manda pelo Centro
    id: "validade-33-dias-fabrica",
    aplicar: (b) => encurtarValidades(b, "Loja de Fábrica"),
  },
  {
    // Maria Valeska (Fiusa) gosta de ser chamada de Valeska: assina assim, e os
    // avisos dela que ainda estão na fila trocam o nome
    id: "apelido-valeska",
    aplicar: (b) => {
      const cpf = Object.keys(b.vendedoras ?? {}).find((k) => /^MARIA VALES[KC]A\b/i.test(b.vendedoras[k].trim()));
      if (!cpf) return;
      (b.config.apelidos ??= {})[cpf] = "Valeska";
      const vendas = new Set(b.vendas.filter((v) => v.vendedoraCpf === cpf).map((v) => v.id));
      const creditos = new Set(b.cashback.filter((m) => m.vendaId && vendas.has(m.vendaId)).map((m) => m.id));
      for (const m of b.mensagens) {
        if (m.status !== "fila" || !m.chave?.startsWith("cb-credito-") || !creditos.has(m.chave.slice(11))) continue;
        m.texto = m.texto.replace(/([Aa]qui é a )Maria\b/g, "$1Valeska").replace(/(^|[\s!.])Maria aqui\b/g, "$1Valeska aqui");
      }
    },
  },
  {
    // Gerentes: "vale em qualquer loja" na mensagem da vendedora gera disputa
    // entre lojas. A regra continua (vale em todas), só não é anunciada no aviso
    // da loja. No do site continua, lá não tem vendedora disputando.
    id: "sem-qualquer-loja-no-aviso",
    aplicar: (b) => {
      const tirar = (t: string) => t.replace(/ pra usar em qualquer loja nossa/g, "").replace(/ em qualquer loja nossa/g, "");
      const site = ["cashback_site_perto", "cashback_site_longe"];
      for (const m of b.modelos) if (!site.includes(m.campanha)) m.variacoes = m.variacoes.map(tirar);
      for (const m of b.mensagens) if (m.status === "fila" && !site.includes(m.campanha)) m.texto = tirar(m.texto);
    },
  },
  {
    // Gerente: "quando quiser" dá a opção de não vir. Fecho com um convite
    // concreto (dia, foto de peça nova) nos modelos e no que está na fila.
    id: "fechamento-com-convite",
    aplicar: (b) => {
      const trocas: [string, string][] = [
        ["Quando quiser vir, me avisa que eu te recebo.", "Me fala qual dia você vem que eu já separo umas peças pra você!"],
        ["Quando chegar peça nova eu te mando foto, pode ser?", "Não deixa vencer, hein! Chegou peça nova, quer que eu te mande foto?"],
        ["Se quiser provar as peças, passa aqui que eu te atendo!", "Passa aqui pra provar as novidades, que eu te atendo!"],
        ["Me avisa quando puder vir.", "Me fala qual dia fica bom pra você vir."],
      ];
      const trocar = (t: string) => trocas.reduce((x, [de, para]) => x.split(de).join(para), t);
      for (const m of b.modelos) m.variacoes = m.variacoes.map(trocar);
      for (const m of b.mensagens) if (m.status === "fila") m.texto = trocar(m.texto);
    },
  },
  {
    // Texto que a gerente da Fiusa escreveu vira a 1ª variação do aviso de
    // cashback (com quebra de linha). As da fila com essa variação também.
    id: "texto-gerente-fiusa",
    aplicar: (b) => {
      const novo = MODELOS_PADRAO.find((x) => x.campanha === "cashback_creditado")!.variacoes[0];
      const m = b.modelos.find((x) => x.campanha === "cashback_creditado");
      if (m) {
        const i = m.variacoes.findIndex((v) => v.startsWith("Oi {primeiro}, tudo bem? Aqui é a {vendedora}, da Via Sol {loja} ☀️ Sua compra {daCompra}"));
        if (i >= 0) m.variacoes[i] = novo;
      }
      const re = /^Oi (.+?), tudo bem\? (Aqui é a .+?, da|Aqui é da) Via Sol (.+?) ☀️ Sua compra (.+?) rendeu (.+?) de cashback, que fica guardado no seu nome até (\S+?)\. Pra usar, a compra precisa ser pelo menos (R\$\s[\d.,]+)\. (?:Me fala qual dia você vem que eu já separo umas peças pra você!|Quando quiser vir, me avisa que eu te recebo\.)/;
      for (const x of b.mensagens) {
        if (x.status !== "fila" || x.campanha !== "cashback_creditado") continue;
        x.texto = x.texto.replace(re, (_t, nome, quem, loja, quando, valor, ate, minimo) =>
          `Oi ${nome}, tudo bem?\n${quem} Via Sol ${loja} ☀️\nSua compra ${quando} rendeu ${valor} de cashback, que fica guardado no seu nome até ${ate}. O valor mínimo da compra para usar é de ${minimo}. Quando vier, me avisa, vou adorar te receber 🧡`);
      }
    },
  },
  {
    // "Chegou peça nova" promete o que pode não ter chegado: volta a ser condicional
    id: "foto-quando-chegar",
    aplicar: (b) => {
      const de = "Não deixa vencer, hein! Chegou peça nova, quer que eu te mande foto?";
      const para = "Não deixa vencer, hein! Quando chegar novidade, posso te mandar foto?";
      for (const m of b.modelos) m.variacoes = m.variacoes.map((v) => v.split(de).join(para));
      for (const m of b.mensagens) if (m.status === "fila") m.texto = m.texto.split(de).join(para);
    },
  },
  {
    // 22/10: Centro, Praia Grande e Site desconectaram. As mensagens que
    // gastaram as 5 tentativas com o número fora voltam pra fila.
    id: "volta-fila-numero-caido-2026-10-22",
    aplicar: (b) => {
      const desde = new Date(Date.now() - 3 * 86400000).toISOString();
      for (const m of b.mensagens) {
        if (m.criadoEm < desde || !/disconnected|not found/i.test(m.erro ?? "")) continue;
        if (m.status === "erro" || m.status === "fila") {
          m.status = "fila";
          m.tentativas = 0;
        }
      }
    },
  },
  {
    // 22/10: WhatsApp restringiu Centro (e provavelmente Praia Grande e Site) por
    // mensagem em massa. Esses três param de mandar automático; o teto do
    // lançamento cai pra 15 por dia nos outros.
    id: "restricao-2026-10-22",
    aplicar: (b) => {
      for (const n of b.config.numeros) if (["Centro", "Praia Grande", "Site"].includes(n.loja)) n.ativo = false;
      b.config.tetoTemporario = { valor: 15, ate: b.config.tetoTemporario?.ate && b.config.tetoTemporario.ate > "2026-11-30" ? b.config.tetoTemporario.ate : "2026-11-30" };
    },
  },
  {
    // 22/10: por segurança, só Ribeirão e Fiusa (boa taxa de resposta) seguem no
    // automático até a API oficial ficar pronta
    id: "pausa-baixa-resposta-2026-10-22",
    aplicar: (b) => {
      for (const n of b.config.numeros) if (["SP — Itaim", "Belo Horizonte", "Rio de Janeiro"].includes(n.loja)) n.ativo = false;
    },
  },
  {
    // 26/10: números com pouca resposta voltam com 5 por dia. Rio e BH já;
    // os que foram restringidos (Centro, Praia Grande, Site) e SP (3%) descansam até quarta.
    id: "volta-5-por-dia-2026-10-26",
    aplicar: (b) => {
      for (const n of b.config.numeros) {
        if (!["Rio de Janeiro", "Belo Horizonte", "Centro", "Praia Grande", "Site", "SP — Itaim"].includes(n.loja)) continue;
        n.tetoDia = 5;
        n.ativo = true;
        if (["Centro", "Praia Grande", "Site", "SP — Itaim"].includes(n.loja)) n.ligarEm = "2026-10-28";
      }
    },
  },
  {
    // 26/10: avisos de cashback prontos pra API oficial (número 16 99129-6855):
    // modelo da Meta em cada campanha, resposta automática com o WhatsApp da loja.
    // Só passam a sair por lá quando forem marcados em "Campanhas que saem pelo
    // número oficial" e a Meta estiver configurada.
    id: "cashback-pela-oficial-v1",
    aplicar: (b) => {
      for (const padrao of MODELOS_PADRAO) {
        if (!padrao.template) continue;
        const m = b.modelos.find((x) => x.campanha === padrao.campanha);
        if (m && !m.template) m.template = structuredClone(padrao.template);
        if (m && padrao.campanha === "cashback_vencendo")
          m.variacoes = m.variacoes.map((v) => v.split("Chegaram peças novas essa semana, quer que eu te mande umas fotos pra você escolher com calma?").join("Quer que eu te mande umas fotos das novidades pra você escolher com calma?"));
      }
      const of = (b.config.oficial ??= oficialDe(b.config));
      of.autoResposta ??= true;
      of.whatsAtendimento ??= "5516991687616";
    },
  },
  {
    // Número oficial: 16 99129-6855 (conta Via Sol Brazil 1244398827175184).
    // O token é colado à mão no painel; aqui só os IDs, que não são segredo.
    id: "oficial-ids-99129-6855",
    aplicar: (b) => {
      const of = (b.config.oficial ??= oficialDe(b.config));
      of.phoneNumberId ||= "681535561713461";
      of.wabaId ||= "1244398827175184";
    },
  },
  {
    id: "telefone-teste-fernando",
    aplicar: (b) => {
      b.config.telefoneTeste ??= "5516992174018";
    },
  },
  {
    // 26/10: avisos das lojas pelo oficial (16 3702-3633), menos Ribeirão e Fiusa, que
    // seguem pelo número delas. Só o último lembrete de vencimento sai pelo oficial.
    // Começa em modo sombra. O que estava na fila pelos números das outras lojas é
    // cancelado e volta pelo oficial na próxima rodada das automações.
    id: "lojas-pelo-oficial-2026-10-26",
    aplicar: (b) => {
      const of = (b.config.oficial ??= oficialDe(b.config));
      of.campanhas = ["carrinho_abandonado", "pix_pendente", "pix_expirado", "cashback_creditado", "cashback_site_perto", "cashback_site_longe", "cashback_vencendo", "cashback_vencendo_urgente"];
      of.lojasPeloNumero = ["Ribeirão Preto", "Fiusa"];
      of.naoMandar = ["cashback_vencendo"];
      of.sombra = true;
      const avisos = ["cashback_creditado", "cashback_site_perto", "cashback_site_longe", "cashback_vencendo", "cashback_vencendo_urgente"];
      const refazer = new Set<string>();
      for (const m of b.mensagens) {
        if (m.status !== "fila" || m.provedor === "oficial" || !avisos.includes(m.campanha)) continue;
        if (of.lojasPeloNumero.includes(m.loja)) continue;
        m.status = "cancelada";
        m.erro = "Vai pelo número oficial";
        refazer.add(m.clienteId);
      }
      // Carrinho e Pix que estavam na fila do número do site (WA-AKG) agora saem pelo oficial
      for (const m of b.mensagens) {
        if (m.status !== "fila" || m.provedor === "oficial" || !["carrinho_abandonado", "pix_pendente", "pix_expirado"].includes(m.campanha)) continue;
        m.status = "cancelada";
        m.erro = "Vai pelo número oficial";
      }
      // Créditos que iam "junto" desses avisos voltam a ser avisados (e se juntam de novo)
      for (const m of b.mensagens) if (m.status === "cancelada" && m.erro === "Junto com outro aviso de cashback" && refazer.has(m.clienteId)) m.erro = "Vai pelo número oficial";
    },
  },
  {
    // 26/10: a Meta aprovou o aviso de cashback das lojas em versão "atualização de conta"
    // como utilidade. Os do site e o lembrete de vencimento ficaram marketing: seguem os
    // textos mais calorosos (custo igual).
    id: "cashback-loja-utilidade",
    aplicar: (b) => {
      const m = b.modelos.find((x) => x.campanha === "cashback_creditado");
      if (m) m.template = { nome: "via_sol_saldo_cashback", idioma: "pt_BR", parametros: ["primeiro", "loja", "vendedora", "valor", "validade", "compraMinima"], botaoLink: true, botaoVar: "whatsLoja" };
    },
  },
  {
    // Meta aprovou o lembrete de vencimento como utilidade (R$ 0,04 em vez de R$ 0,35)
    id: "vencimento-utilidade-2026-10-27",
    aplicar: (b) => {
      for (const m of b.modelos) {
        if (m.campanha === "cashback_vencendo" || m.campanha === "cashback_vencendo_urgente") {
          m.template = { nome: "via_sol_saldo_vencimento", idioma: "pt_BR", parametros: ["primeiro", "valor", "validade"], botaoLink: true, botaoVar: "whatsLoja" };
        }
      }
    },
  },
  {
    // Pix vencido não tinha modelo na Meta: ia travar ao sair do modo sombra.
    // Usa o do carrinho (o carrinho já vem montado no botão) até o próprio ser aprovado.
    id: "pix-vencido-com-modelo",
    aplicar: (b) => {
      const m = b.modelos.find((x) => x.campanha === "pix_expirado");
      if (m && !m.template?.nome) m.template = { nome: "via_sol_carrinho", idioma: "pt_BR", parametros: ["primeiro", "itens"], botaoLink: true };
    },
  },
  {
    // 2º aviso do carrinho (com cupom) sai pelo oficial, como o 1º
    id: "carrinho-cupom-v1",
    aplicar: (b) => {
      const of = b.config.oficial;
      if (of?.campanhas && !of.campanhas.includes("carrinho_cupom")) of.campanhas.push("carrinho_cupom");
      const m = MODELOS_PADRAO.find((x) => x.campanha === "carrinho_cupom");
      if (m && !b.modelos.some((x) => x.campanha === "carrinho_cupom")) b.modelos.push(structuredClone(m));
    },
  },
  {
    // Modelo próprio do Pix vencido aprovado (fala do pedido e do Pix, não de carrinho largado)
    id: "pix-vencido-modelo-proprio",
    aplicar: (b) => {
      const m = b.modelos.find((x) => x.campanha === "pix_expirado");
      if (m) m.template = { nome: "via_sol_pix_vencido", idioma: "pt_BR", parametros: ["primeiro", "pedido"], botaoLink: true };
    },
  },
  {
    // 2º aviso do carrinho ligado: em sombra simula; de verdade, espera o modelo aprovado
    id: "carrinho-cupom-liga",
    aplicar: (b) => {
      const m = b.modelos.find((x) => x.campanha === "carrinho_cupom");
      if (m) m.ativo = true;
    },
  },
  {
    // Campos de configuração que não existiam ganham o valor padrão
    id: "config-padrao",
    aplicar: (b) => {
      b.config = { ...CONFIG_PADRAO, ...b.config };
      b.recebidas ??= [];
      b.codigos ??= [];
      b.atendimento ??= [];
      b.campanhas ??= [];
      for (const m of MODELOS_PADRAO) {
        if (!b.modelos.some((x) => x.campanha === m.campanha)) b.modelos.push(structuredClone(m));
      }
    },
  },
];

/**
 * Crédito ainda não avisado passa a valer `cashbackValidadeDias` a partir de
 * hoje (se vencia depois disso); o texto na fila ganha a data nova. O que já
 * foi avisado mantém a data prometida. Só lojas com número (próprio ou
 * emprestado): as outras nem sabem que têm o crédito.
 */
function encurtarValidades(b: BaseCrm, soDaLoja?: string) {
  const nova = somarDias(hojeSp(), b.config.cashbackValidadeDias);
  const saiu = new Set(["enviada", "entregue", "lida", "respondida", "enviando"]);
  const doAviso = ["cashback_creditado", "cashback_site_perto", "cashback_site_longe"];
  const avisados = new Set<string>();
  const clienteAvisado = new Set<string>();
  for (const m of b.mensagens) {
    if (!doAviso.includes(m.campanha) || !saiu.has(m.status)) continue;
    clienteAvisado.add(m.clienteId);
    if (m.chave?.startsWith("cb-credito-")) avisados.add(m.chave.slice(11));
  }
  // Créditos que foram "junto" de um aviso que já saiu também foram avisados
  for (const m of b.mensagens) if (m.status === "cancelada" && m.erro === "Junto com outro aviso de cashback" && m.chave?.startsWith("cb-credito-") && clienteAvisado.has(m.clienteId)) avisados.add(m.chave.slice(11));
  const ligada = (loja: string) => b.config.numeros.some((n) => n.loja === loja && n.ativo && n.sessao);
  const temNumero = (loja: string) => loja === "Site" || ligada(loja) || ligada(b.config.numeros.find((n) => n.loja === loja)?.mandarPor ?? "");
  for (const mov of b.cashback) {
    if (mov.tipo !== "credito" || avisados.has(mov.id) || !mov.validade || mov.validade <= nova) continue;
    if (soDaLoja ? mov.loja !== soDaLoja : !temNumero(mov.loja ?? "")) continue;
    if (!temNumero(mov.loja ?? "")) continue;
    const antiga = mov.validade;
    mov.validade = nova;
    for (const k of b.codigos ?? []) if (k.movimentoId === mov.id) k.validade = nova;
    for (const m of b.mensagens) if (m.status === "fila" && m.chave === `cb-credito-${mov.id}`) m.texto = m.texto.split(dataBr(antiga)).join(dataBr(nova));
  }
}

const precisaMigrar = (b: BaseCrm) => MIGRACOES.some((m) => !b.config.migracoes?.includes(m.id));

function migrar(b: BaseCrm) {
  for (const m of MIGRACOES) {
    if (b.config.migracoes?.includes(m.id)) continue;
    m.aplicar(b);
    b.config.migracoes = [...(b.config.migracoes ?? []), m.id];
  }
}

/** Leitura simples, para consultas. */
export async function lerBase(): Promise<BaseCrm> {
  await (global.__filaCrm ?? Promise.resolve()).catch(() => {});
  const base = await ler();
  if (!precisaMigrar(base)) return base;
  await alterarBase(() => {});
  return ler();
}

/** Altera a base: lê, aplica `fn` e grava, um de cada vez. Devolve o que `fn` devolver. */
export function alterarBase<T>(fn: (base: BaseCrm) => T | Promise<T>): Promise<T> {
  const tarefa = (global.__filaCrm ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const base = await ler();
      migrar(base);
      const r = await fn(base);
      await gravar(base);
      void copiaDeSeguranca(base);
      return r;
    });
  global.__filaCrm = tarefa;
  return tarefa;
}

/** Uma cópia por dia na pasta de backup. Falha aqui nunca derruba a operação. */
export async function copiaDeSeguranca(base: BaseCrm, forcar = false): Promise<string> {
  const dir = base.config.backupDir?.trim();
  if (!dir) return "sem pasta de backup configurada";
  if (!forcar && Date.now() - (global.__backupCrm ?? 0) < INTERVALO_BACKUP_MS) return "aguardando";
  try {
    await mkdir(dir, { recursive: true });
    const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    await copyFile(ARQUIVO, join(dir, `crm-${dia}.json`));
    global.__backupCrm = Date.now();
    const copias = (await readdir(dir)).filter((n) => /^crm-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const velha of copias.slice(0, Math.max(0, copias.length - MANTER_COPIAS))) {
      await rm(join(dir, velha), { force: true });
    }
    return `ok — crm-${dia}.json`;
  } catch (e) {
    return `falhou: ${e instanceof Error ? e.message : e}`;
  }
}

/** Data de hoje em SP, YYYY-MM-DD. */
export const hojeSp = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Soma dias a uma data YYYY-MM-DD. */
export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Diferença em dias entre duas datas YYYY-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000);
}

export const dataBr = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const primeiroNome = (nome: string) => {
  const p = nome.trim().split(/\s+/)[0] ?? "";
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : "";
};
