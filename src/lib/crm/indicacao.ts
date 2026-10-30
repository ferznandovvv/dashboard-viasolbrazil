/**
 * Indique uma amiga: cada cliente tem um código pessoal. A amiga ganha um
 * desconto na primeira compra (na loja ou no site) e quem indicou ganha
 * cashback depois da carência, se a compra não voltou. Vale nas lojas
 * escolhidas em Configurar (e no site, com o cupom na Shopify).
 */

import { hojeSp, novoId, somarDias } from "./base";
import { enfileirar } from "./mensagens";
import { normalizarTelefone } from "./telefone";
import { contaComoCompra, indicacaoDe, type BaseCrm, type Cliente, type Indicacao } from "./tipos";

const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Código da cliente (cria na primeira vez): o primeiro nome e 3 letras, ex.: ANA7K2. */
export function codigoDeIndicacao(b: BaseCrm, c: Cliente): string {
  if (c.codigoIndicacao) return c.codigoIndicacao;
  const nome = semAcento(c.nome.trim().split(/\s+/)[0] ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 5) || "VS";
  const usados = new Set([...b.codigos.map((k) => k.codigo), ...b.clientes.map((x) => x.codigoIndicacao).filter(Boolean)]);
  for (;;) {
    let cod = nome;
    for (let i = 0; i < 3; i++) cod += LETRAS[Math.floor(Math.random() * LETRAS.length)];
    if (!usados.has(cod)) {
      c.codigoIndicacao = cod;
      return cod;
    }
  }
}

export const indicadoraDoCodigo = (b: BaseCrm, codigo: string): Cliente | undefined => {
  const k = codigo.trim().toUpperCase();
  return k ? b.clientes.find((c) => c.codigoIndicacao === k) : undefined;
};

/** A indicação vale nesta loja (ou no site)? */
export function valeNaLoja(b: BaseCrm, loja: string): boolean {
  const cfg = indicacaoDe(b.config);
  return cfg.ativo && cfg.lojas.includes(loja);
}

interface Amiga {
  telefone?: string;
  cpf?: string;
  email?: string;
  nome?: string;
  clienteShopify?: string;
}

/** Clientes que batem com a amiga (celular, CPF, e-mail ou cadastro do site). */
function clientesDaAmiga(b: BaseCrm, a: Amiga): Cliente[] {
  const tel = normalizarTelefone(a.telefone);
  const cpf = a.cpf?.replace(/\D/g, "");
  const email = a.email?.trim().toLowerCase();
  return b.clientes.filter(
    (c) => (tel && c.telefone === tel) || (cpf && cpf.length === 11 && c.cpf === cpf) || (email && c.email?.toLowerCase() === email) || (a.clienteShopify && c.codigoShopify === a.clienteShopify)
  );
}

/** Por que a indicação não vale (ou undefined se vale). `antesDe`: compra da amiga (ISO). */
export function motivoRecusa(b: BaseCrm, indicadora: Cliente, a: Amiga, antesDe: string, ignorarVenda?: string): string | undefined {
  const cfg = indicacaoDe(b.config);
  const daAmiga = clientesDaAmiga(b, a);
  if (daAmiga.some((c) => c.id === indicadora.id)) return "o código é da própria cliente";
  const ids = new Set(daAmiga.map((c) => c.id));
  if (b.vendas.some((v) => v.clienteId && ids.has(v.clienteId) && v.id !== ignorarVenda && v.data < antesDe && contaComoCompra(v))) return "a amiga já era cliente (o código é só pra primeira compra)";
  const mes = antesDe.slice(0, 7);
  const noMes = (b.indicacoes ?? []).filter((i) => i.indicadoraId === indicadora.id && i.em.slice(0, 7) === mes && i.status !== "recusada").length;
  if (noMes >= cfg.maxMes) return `${indicadora.nome.split(" ")[0]} já indicou ${cfg.maxMes} amigas este mês (o limite)`;
  if ((b.indicacoes ?? []).some((i) => i.status !== "recusada" && ((a.telefone && i.amigaTelefone === normalizarTelefone(a.telefone)) || (a.cpf && i.amigaCpf === a.cpf.replace(/\D/g, ""))))) return "essa amiga já foi indicada antes";
  return undefined;
}

/** Caixa da loja: a vendedora registra a amiga que usou o código. */
export function registrarNaLoja(b: BaseCrm, p: { codigo: string; loja: string; telefone: string; nome?: string; cpf?: string; valorCompra?: number; por?: string }): Indicacao {
  const cfg = indicacaoDe(b.config);
  if (!valeNaLoja(b, p.loja)) throw new Error("O indique uma amiga ainda não está ligado nesta loja.");
  const indicadora = indicadoraDoCodigo(b, p.codigo);
  if (!indicadora) throw new Error("Código de indicação não encontrado.");
  const telefone = normalizarTelefone(p.telefone);
  if (!telefone) throw new Error("Coloque o celular da amiga (com DDD).");
  const agora = new Date().toISOString();
  const motivo = motivoRecusa(b, indicadora, { telefone, cpf: p.cpf, nome: p.nome }, agora);
  if (motivo) throw new Error(`Não vale: ${motivo}.`);
  const ind: Indicacao = {
    id: novoId(),
    codigo: indicadora.codigoIndicacao!,
    indicadoraId: indicadora.id,
    amigaNome: p.nome?.trim() || undefined,
    amigaTelefone: telefone,
    amigaCpf: p.cpf?.replace(/\D/g, "") || undefined,
    canal: "loja",
    loja: p.loja,
    valorCompra: p.valorCompra,
    em: agora,
    liberaEm: somarDias(hojeSp(), cfg.carenciaDias),
    status: "pendente",
    registradaPor: p.por,
  };
  (b.indicacoes ??= []).push(ind);
  return ind;
}

export interface PedidoComIndicacao {
  vendaId: string;
  pedido: string;
  criadoEm: string;
  valor: number;
  codigos: string[];
  telefone?: string;
  email?: string;
  nome?: string;
  clienteShopify?: string;
}

/** Site: pedido pago com o código de uma cliente vira indicação (pendente ou recusada). */
export function conferirIndicacoesSite(b: BaseCrm, pedidos: PedidoComIndicacao[]): number {
  if (!valeNaLoja(b, "Site")) return 0;
  const cfg = indicacaoDe(b.config);
  let n = 0;
  for (const p of pedidos) {
    for (const k of p.codigos) {
      const indicadora = indicadoraDoCodigo(b, k);
      if (!indicadora || (b.indicacoes ?? []).some((i) => i.vendaId === p.vendaId)) continue;
      const amiga = { telefone: p.telefone, email: p.email, nome: p.nome, clienteShopify: p.clienteShopify };
      const motivo = motivoRecusa(b, indicadora, amiga, p.criadoEm, p.vendaId);
      (b.indicacoes ??= []).push({
        id: novoId(),
        codigo: indicadora.codigoIndicacao!,
        indicadoraId: indicadora.id,
        amigaId: clientesDaAmiga(b, amiga)[0]?.id,
        amigaNome: p.nome,
        amigaTelefone: normalizarTelefone(p.telefone),
        amigaEmail: p.email?.toLowerCase(),
        canal: "site",
        loja: "Site",
        vendaId: p.vendaId,
        pedido: p.pedido,
        valorCompra: p.valor,
        em: p.criadoEm,
        liberaEm: somarDias(p.criadoEm.slice(0, 10), cfg.carenciaDias),
        status: motivo ? "recusada" : "pendente",
        motivo,
      });
      n++;
    }
  }
  return n;
}

/** Credita o cashback de quem indicou e avisa. */
export function creditarIndicacao(b: BaseCrm, ind: Indicacao, hoje = hojeSp()): void {
  const cfg = indicacaoDe(b.config);
  const indicadora = b.clientes.find((c) => c.id === ind.indicadoraId);
  if (!indicadora) {
    ind.status = "recusada";
    ind.motivo = "cliente que indicou não existe mais";
    return;
  }
  const validade = somarDias(hoje, b.config.cashbackValidadeDias);
  const id = novoId();
  b.cashback.push({
    id,
    clienteId: indicadora.id,
    tipo: "credito",
    valor: cfg.valorIndicadora,
    validade,
    loja: ind.loja === "Site" ? (indicadora.lojaOrigem ?? "Site") : ind.loja,
    obs: `Indicação: ${ind.amigaNome ?? "amiga"} comprou com o código ${ind.codigo}`,
    criadoEm: new Date().toISOString(),
    por: "indicacao",
  });
  ind.status = "creditada";
  ind.creditoId = id;
  const loja = indicadora.lojaOrigem && indicadora.lojaOrigem !== "Site" ? indicadora.lojaOrigem : ind.loja;
  enfileirar(b, {
    cliente: indicadora,
    campanha: "indicacao_premio",
    loja,
    chave: `indic-premio-${ind.id}`,
    variaveis: { valor: cfg.valorIndicadora, validade, amiga: ind.amigaNome?.trim().split(/\s+/)[0] },
  });
}

/**
 * Passada a carência: confere que a compra da amiga existe e não voltou, e
 * credita. Na loja, procura a venda dela (celular/CPF) perto do dia; sem
 * achar, fica "sem venda" pro dono olhar.
 */
export function liberarIndicacoes(b: BaseCrm, hoje = hojeSp()): number {
  let n = 0;
  for (const ind of b.indicacoes ?? []) {
    if (ind.status !== "pendente" || ind.liberaEm > hoje) continue;
    if (ind.canal === "site") {
      const v = b.vendas.find((x) => x.id === ind.vendaId);
      if (v && contaComoCompra(v)) {
        creditarIndicacao(b, ind, hoje);
        n++;
      } else if (!v && hoje > somarDias(ind.liberaEm, 5)) {
        ind.status = "recusada";
        ind.motivo = "pedido cancelado ou devolvido";
      } else if (v) {
        ind.status = "recusada";
        ind.motivo = "a compra foi devolvida";
      }
      continue;
    }
    const ids = new Set(clientesDaAmiga(b, { telefone: ind.amigaTelefone, cpf: ind.amigaCpf }).map((c) => c.id));
    const de = somarDias(ind.em.slice(0, 10), -1);
    const ate = somarDias(ind.em.slice(0, 10), 3);
    const v = b.vendas.find((x) => x.clienteId && ids.has(x.clienteId) && x.loja === ind.loja && x.data.slice(0, 10) >= de && x.data.slice(0, 10) <= ate);
    if (v) {
      ind.vendaId = v.id;
      ind.amigaId = v.clienteId;
      if (contaComoCompra(v)) {
        creditarIndicacao(b, ind, hoje);
        n++;
      } else {
        ind.status = "recusada";
        ind.motivo = "a compra foi devolvida";
      }
    } else if (hoje >= somarDias(ind.liberaEm, 3)) {
      ind.status = "sem_venda";
      ind.motivo = "a venda da amiga não apareceu na TOTVS com esse celular";
    }
  }
  return n;
}

/** Convite: uns dias depois de uma compra boa, nas lojas onde vale, uma vez a cada 90 dias. */
export function convitesIndicacao(b: BaseCrm, hoje: string, lojaDa: (c: Cliente, loja: string) => string | undefined, tentar: (r: { mensagem?: unknown; motivo?: string }) => void): void {
  const cfg = indicacaoDe(b.config);
  if (!cfg.ativo || !cfg.lojas.length) return;
  const dia = somarDias(hoje, -cfg.conviteDias);
  const desde = new Date(`${somarDias(hoje, -90)}T00:00:00-03:00`).toISOString();
  const jaConvidadas = new Set(b.mensagens.filter((m) => m.campanha === "indicacao_convite" && m.criadoEm >= desde && m.status !== "cancelada").map((m) => m.clienteId));
  const porId = new Map(b.clientes.map((c) => [c.id, c]));
  for (const v of b.vendas) {
    if (!v.clienteId || v.data.slice(0, 10) !== dia || v.valor < cfg.conviteMinimo || !cfg.lojas.includes(v.loja) || !contaComoCompra(v)) continue;
    const c = porId.get(v.clienteId);
    if (!c || jaConvidadas.has(c.id)) continue;
    const loja = lojaDa(c, v.loja);
    if (!loja) continue;
    const codigo = codigoDeIndicacao(b, c);
    const r = enfileirar(b, {
      cliente: c,
      campanha: "indicacao_convite",
      loja,
      chave: `indic-convite-${c.id}-${dia}`,
      variaveis: { codigo, oferta: `${cfg.pctAmiga}% de desconto`, valor: cfg.valorIndicadora },
    });
    if (r.mensagem) {
      c.indicacaoDivulgadaEm ??= new Date().toISOString();
      jaConvidadas.add(c.id);
    }
    tentar(r);
  }
}

export interface ResumoIndicacoes {
  ativo: boolean;
  lojas: string[];
  mes: string;
  registradas: number;
  compraram: number;
  vendas: number;
  cashback: number;
  pendentes: number;
  recusadas: number;
  conferir: (Indicacao & { indicadora?: string })[];
  ultimas: (Indicacao & { indicadora?: string })[];
}

export function resumoIndicacoes(b: BaseCrm, hoje = hojeSp()): ResumoIndicacoes {
  const cfg = indicacaoDe(b.config);
  const mes = hoje.slice(0, 7);
  const doMes = (b.indicacoes ?? []).filter((i) => new Date(new Date(i.em).getTime() - 3 * 3600000).toISOString().slice(0, 7) === mes);
  const nome = (id: string) => b.clientes.find((c) => c.id === id)?.nome;
  const valendo = doMes.filter((i) => i.status === "pendente" || i.status === "creditada");
  return {
    ativo: cfg.ativo,
    lojas: cfg.lojas,
    mes: `${mes}-01`,
    registradas: doMes.length,
    compraram: valendo.length,
    vendas: Math.round(valendo.reduce((s, i) => s + (i.valorCompra ?? 0), 0)),
    cashback: doMes.filter((i) => i.status === "creditada").length * cfg.valorIndicadora,
    pendentes: doMes.filter((i) => i.status === "pendente").length,
    recusadas: doMes.filter((i) => i.status === "recusada").length,
    conferir: (b.indicacoes ?? []).filter((i) => i.status === "sem_venda").map((i) => ({ ...i, indicadora: nome(i.indicadoraId) })),
    ultimas: [...(b.indicacoes ?? [])]
      .sort((a, c) => c.em.localeCompare(a.em))
      .slice(0, 15)
      .map((i) => ({ ...i, indicadora: nome(i.indicadoraId) })),
  };
}
