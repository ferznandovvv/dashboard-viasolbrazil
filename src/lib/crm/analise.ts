/**
 * Números que definem as regras do programa, calculados da própria base:
 * recompra, tempo até a segunda compra, faixas RFM, cobertura de telefone por
 * loja e por vendedora, e o que as campanhas estão rendendo.
 */

import { diasEntre, hojeSp, somarDias } from "./base";
import { resumoAtendimento } from "./atendimento";
import { contaComoCompra, valorLiquido, type BaseCrm, type Venda } from "./tipos";
import { faixaDe } from "./perfil";

const arred = (v: number, c = 1) => Math.round(v * 10 ** c) / 10 ** c;
const mediana = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export interface Analise {
  periodo: { de?: string; ate?: string; meses: number };
  base: { clientes: number; comTelefone: number; comAniversario: number; vendasIdentificadas: number; vendasTotal: number };
  /** Últimos 12 meses: clientes que compraram, receita identificada e gasto médio por cliente */
  ano: { ativas: number; receita: number; gastoMedio: number; ticket: number; compradoras2x: number };
  recompra: {
    /** Clientes cuja primeira compra tem pelo menos 180 dias */
    elegiveis: number;
    /** Dessas, quantas compraram de novo */
    voltaram: number;
    taxa: number | null;
    medianaDias: number | null;
    /** Em quanto tempo quem voltou, voltou */
    faixas: { faixa: string; n: number }[];
    /** Quantas voltam dentro do prazo de validade do cashback configurado */
    dentroDaValidade: number | null;
  };
  rfm: { faixa: string; descricao: string; clientes: number; pctClientes: number; receita: number; pctReceita: number; ticket: number }[];
  porLoja: { loja: string; vendas: number; receita: number; ticket: number; identificadas: number; pctIdentificadas: number; clientes: number; comTelefone: number; pctTelefone: number }[];
  atendimento: { loja: string; conversas: number; medianaMin: number | null; rapidas: number | null; lentas: number }[];
  porVendedora: { vendedora: string; loja: string; vendas: number; identificadas: number; pctIdentificadas: number; comTelefone: number; pctTelefone: number }[];
  campanhas: { campanha: string; enviadas: number; respondidas: number; sair: number; codigosUsados: number; compraram14d: number; receita14d: number }[];
  cashback: { creditado: number; resgatado: number; expirado: number; emAberto: number; taxaResgate: number | null };
}

export function analisar(base: BaseCrm): Analise {
  const hoje = hojeSp();
  // Pelo valor que ficou: troca é uma compra só, devolvida inteira não conta
  const vendas = base.vendas.filter((v) => v.valor > 0 && contaComoCompra(v)).map((v) => ({ ...v, valor: valorLiquido(v) }));
  const datas = vendas.map((v) => v.data.slice(0, 10)).sort();
  const de = datas[0];
  const ate = datas[datas.length - 1];
  const meses = de && ate ? Math.max(1, Math.round(diasEntre(de, ate) / 30)) : 0;

  // Vendas por cliente, ordenadas
  const porCliente = new Map<string, Venda[]>();
  for (const v of vendas) if (v.clienteId) (porCliente.get(v.clienteId) ?? porCliente.set(v.clienteId, []).get(v.clienteId)!).push(v);
  for (const l of porCliente.values()) l.sort((a, b) => a.data.localeCompare(b.data));

  // Recompra: só quem teve a primeira compra há tempo suficiente pra ter voltado
  let elegiveis = 0;
  let voltaram = 0;
  const intervalos: number[] = [];
  for (const l of porCliente.values()) {
    const primeira = l[0].data.slice(0, 10);
    if (diasEntre(primeira, hoje) < 180) continue;
    elegiveis++;
    if (l.length > 1) {
      voltaram++;
      intervalos.push(diasEntre(primeira, l[1].data.slice(0, 10)));
    }
  }
  const faixasDef: [string, number, number][] = [
    ["até 30 dias", 0, 30],
    ["31 a 60", 31, 60],
    ["61 a 90", 61, 90],
    ["91 a 180", 91, 180],
    ["181 a 365", 181, 365],
    ["mais de um ano", 366, 99999],
  ];
  const validade = base.config.cashbackValidadeDias;
  const recompra: Analise["recompra"] = {
    elegiveis,
    voltaram,
    taxa: elegiveis ? arred((voltaram / elegiveis) * 100) : null,
    medianaDias: mediana(intervalos),
    faixas: faixasDef.map(([faixa, a, b]) => ({ faixa, n: intervalos.filter((d) => d >= a && d <= b).length })),
    dentroDaValidade: intervalos.length ? arred((intervalos.filter((d) => d <= validade).length / intervalos.length) * 100) : null,
  };

  // RFM simplificado em quatro faixas que a gerente entende
  const receitaTotal = vendas.reduce((s, v) => s + v.valor, 0);
  const faixas = { ouro: [] as number[], prata: [] as number[], bronze: [] as number[], uma: [] as number[], paradas: [] as number[] };
  const chave = { Ouro: "ouro", Prata: "prata", Bronze: "bronze", Nova: "uma", Parada: "paradas" } as const;
  for (const l of porCliente.values()) {
    const total = l.reduce((s, v) => s + v.valor, 0);
    const f = faixaDe(l.length, total, diasEntre(l[l.length - 1].data.slice(0, 10), hoje));
    if (f !== "Sem compra") faixas[chave[f]].push(total);
  }
  const linhaRfm = (faixa: string, descricao: string, v: number[]) => {
    const receita = v.reduce((s, x) => s + x, 0);
    return { faixa, descricao, clientes: v.length, pctClientes: porCliente.size ? arred((v.length / porCliente.size) * 100) : 0, receita: arred(receita, 2), pctReceita: receitaTotal ? arred((receita / receitaTotal) * 100) : 0, ticket: v.length ? arred(receita / v.length, 2) : 0 };
  };
  const rfm = [
    linhaRfm("Ouro", "3+ compras ou R$ 1.500+, ativa no último ano", faixas.ouro),
    linhaRfm("Prata", "2 compras ou R$ 600+, ativa no último ano", faixas.prata),
    linhaRfm("Bronze", "1 compra entre 6 meses e 1 ano atrás", faixas.bronze),
    linhaRfm("Nova", "1 compra nos últimos 6 meses", faixas.uma),
    linhaRfm("Parada", "Sem comprar há mais de um ano", faixas.paradas),
  ];

  // Cobertura por loja e por vendedora: a venda tem cliente? o cliente tem telefone?
  const telefoneDe = new Map(base.clientes.map((c) => [c.id, Boolean(c.telefone)]));
  const lojaAgg = new Map<string, { vendas: number; receita: number; identificadas: number; clientes: Set<string>; comTelefone: Set<string> }>();
  const vendAgg = new Map<string, { loja: string; vendas: number; identificadas: number; comTelefone: number }>();
  for (const v of vendas) {
    const l = lojaAgg.get(v.loja) ?? lojaAgg.set(v.loja, { vendas: 0, receita: 0, identificadas: 0, clientes: new Set(), comTelefone: new Set() }).get(v.loja)!;
    l.vendas++;
    l.receita += v.valor;
    if (v.clienteId) {
      l.identificadas++;
      l.clientes.add(v.clienteId);
      if (telefoneDe.get(v.clienteId)) l.comTelefone.add(v.clienteId);
    }
    if (v.vendedoraCpf && v.loja !== "Site") {
      const nome = base.vendedoras?.[v.vendedoraCpf] ?? `CPF •••${v.vendedoraCpf.slice(3, 9)}`;
      const chave = `${nome}|${v.loja}`;
      const a = vendAgg.get(chave) ?? vendAgg.set(chave, { loja: v.loja, vendas: 0, identificadas: 0, comTelefone: 0 }).get(chave)!;
      a.vendas++;
      if (v.clienteId) {
        a.identificadas++;
        if (telefoneDe.get(v.clienteId)) a.comTelefone++;
      }
    }
  }
  const porLoja = Array.from(lojaAgg, ([loja, l]) => ({
    loja,
    vendas: l.vendas,
    receita: arred(l.receita, 2),
    ticket: l.vendas ? arred(l.receita / l.vendas, 2) : 0,
    identificadas: l.identificadas,
    pctIdentificadas: l.vendas ? arred((l.identificadas / l.vendas) * 100) : 0,
    clientes: l.clientes.size,
    comTelefone: l.comTelefone.size,
    pctTelefone: l.clientes.size ? arred((l.comTelefone.size / l.clientes.size) * 100) : 0,
  })).sort((a, b) => b.vendas - a.vendas);
  const porVendedora = Array.from(vendAgg, ([chave, a]) => ({
    vendedora: chave.split("|")[0],
    loja: a.loja,
    vendas: a.vendas,
    identificadas: a.identificadas,
    pctIdentificadas: a.vendas ? arred((a.identificadas / a.vendas) * 100) : 0,
    comTelefone: a.comTelefone,
    pctTelefone: a.identificadas ? arred((a.comTelefone / a.identificadas) * 100) : 0,
  }))
    .filter((x) => x.vendas >= 10)
    .sort((a, b) => a.pctTelefone - b.pctTelefone);

  // Campanhas: o que saiu, quem respondeu, quem pediu pra sair, código usado, compra em 14 dias
  const campAgg = new Map<string, { enviadas: number; respondidas: number; sair: number; codigosUsados: number; compraram14d: number; receita14d: number }>();
  for (const m of base.mensagens) {
    const enviadoEm = m.enviadoEm;
    if (!enviadoEm) continue;
    const a = campAgg.get(m.campanha) ?? campAgg.set(m.campanha, { enviadas: 0, respondidas: 0, sair: 0, codigosUsados: 0, compraram14d: 0, receita14d: 0 }).get(m.campanha)!;
    a.enviadas++;
    if (m.status === "respondida") a.respondidas++;
    const c = base.clientes.find((x) => x.id === m.clienteId);
    if (c?.optOutEm && c.optOutEm >= enviadoEm && c.optOutEm <= new Date(new Date(enviadoEm).getTime() + 7 * 86400000).toISOString()) a.sair++;
    if (base.codigos.some((k) => k.mensagemId === m.id && k.usadoEm)) a.codigosUsados++;
    const limite = new Date(new Date(enviadoEm).getTime() + 14 * 86400000).toISOString();
    const compras = (porCliente.get(m.clienteId) ?? []).filter((v) => v.data > enviadoEm && v.data <= limite);
    if (compras.length) {
      a.compraram14d++;
      a.receita14d += compras.reduce((s, v) => s + v.valor, 0);
    }
  }
  const campanhas = Array.from(campAgg, ([campanha, a]) => ({ campanha, ...a, receita14d: arred(a.receita14d, 2) })).sort((x, y) => y.enviadas - x.enviadas);

  // Cashback
  let creditado = 0;
  let resgatado = 0;
  let expirado = 0;
  for (const m of base.cashback) {
    if (m.tipo === "credito") creditado += m.valor;
    else if (m.tipo === "resgate") resgatado += -m.valor;
    else if (m.tipo === "expiracao") expirado += -m.valor;
  }
  const encerrado = resgatado + expirado;
  const cashback = {
    creditado: arred(creditado, 2),
    resgatado: arred(resgatado, 2),
    expirado: arred(expirado, 2),
    emAberto: arred(creditado - encerrado, 2),
    taxaResgate: encerrado ? arred((resgatado / encerrado) * 100) : null,
  };

  // Últimos 12 meses
  const anoAtras = somarDias(hoje, -365);
  let ativas = 0;
  let receitaAno = 0;
  let vendasAno = 0;
  let duas = 0;
  for (const l of porCliente.values()) {
    const doAno = l.filter((v) => v.data.slice(0, 10) > anoAtras);
    if (!doAno.length) continue;
    ativas++;
    vendasAno += doAno.length;
    receitaAno += doAno.reduce((s, v) => s + v.valor, 0);
    if (doAno.length >= 2) duas++;
  }
  const ano = { ativas, receita: arred(receitaAno, 2), gastoMedio: ativas ? arred(receitaAno / ativas, 2) : 0, ticket: vendasAno ? arred(receitaAno / vendasAno, 2) : 0, compradoras2x: duas };

  const at = resumoAtendimento(base, 30);
  const atendimento = at.lojas
    .filter((l) => l.mensagensClientes > 0)
    .map((l) => ({ loja: l.loja, conversas: l.conversas, medianaMin: l.medianaMin, rapidas: l.respondidas ? arred((l.rapidas / l.respondidas) * 100, 0) : null, lentas: l.lentas }))
    .sort((a, b) => (a.medianaMin ?? 9999) - (b.medianaMin ?? 9999));

  return {
    periodo: { de, ate, meses },
    ano,
    atendimento,
    base: {
      clientes: base.clientes.length,
      comTelefone: base.clientes.filter((c) => c.telefone).length,
      comAniversario: base.clientes.filter((c) => c.nascimento).length,
      vendasIdentificadas: vendas.filter((v) => v.clienteId).length,
      vendasTotal: vendas.length,
    },
    recompra,
    rfm,
    porLoja,
    porVendedora,
    campanhas,
    cashback,
  };
}
