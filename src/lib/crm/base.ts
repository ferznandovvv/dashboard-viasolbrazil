/**
 * Onde o CRM mora: um arquivo JSON na máquina (dados/crm/base.json), com
 * cópia de segurança numa pasta à escolha, igual ao financeiro.
 *
 * Toda escrita passa por uma fila única do processo. Só roda no servidor Node.
 */

import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { type BaseCrm, CONFIG_PADRAO, MODELOS_PADRAO } from "./tipos";
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
    // Regras combinadas em 16/10: 15% com compra de 3x, 90 dias, dois lembretes,
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
