/**
 * Sincronização do CRM com o TOTVS Moda: vendas (notas de saída do PDV) e
 * cadastro de pessoa física (telefone, aniversário, CPF).
 *
 * A nota traz código e nome do cliente, mas não telefone. O telefone vem do
 * cadastro, consultado em lote pelos códigos que apareceram nas notas.
 *
 * Os nomes de campo da API não estão todos documentados aqui, então a leitura
 * é tolerante (tenta mais de um nome) e a rota /api/crm/totvs/diag mostra a
 * resposta crua para acertar o mapeamento com dado real.
 */

import { LOJAS, getTotvsToken, totvsBaseUrl, totvsConfigured, totvsFetch } from "../connectors/totvs";
import { alterarBase, diasEntre, hojeSp, lerBase, somarDias } from "./base";
import { conciliarVendas, registrarVenda, salvarCliente } from "./clientes";
import { aplicarCancelamento, aplicarDevolucao, limparDevolucoes, type DevolucaoLida } from "./devolucoes";
import type { Venda } from "./tipos";
import { normalizarTelefone } from "./telefone";

const INVOICES = "/api/totvsmoda/fiscal/v2/invoices/search";
const PESSOAS = "/api/totvsmoda/person/v2/individuals/search";

type Obj = Record<string, unknown>;
const str = (o: Obj, ...nomes: string[]): string | undefined => {
  for (const n of nomes) {
    const v = o[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return undefined;
};
const num = (o: Obj, ...nomes: string[]): number | undefined => {
  for (const n of nomes) {
    const v = o[n];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return undefined;
};

/** Só conta venda de verdade (mesma regra do dashboard). */
function ehVenda(inv: Obj): boolean {
  if (inv.operationType !== "Output" || inv.invoiceStatus !== "Issued") return false;
  const op = String(inv.operatioName ?? inv.operationName ?? "");
  if (!/VENDA/i.test(op)) return false;
  return !/DEVOL|TRANSF|REMESSA|BONIFIC|BRINDE|COMODATO|AMOSTRA/i.test(op);
}

/** Progresso da sincronização em andamento (uma por processo). */
export const progresso: {
  rodando: boolean;
  etapa: string;
  inicio?: number;
  vendasNovas: number;
  clientesNovos: number;
  clientesAtualizados: number;
  erro?: string;
  fim?: number;
} = { rodando: false, etapa: "", vendasNovas: 0, clientesNovos: 0, clientesAtualizados: 0 };

interface PessoaLida {
  codigo?: string;
  nome?: string;
  cpf?: string;
  nascimento?: string;
  telefone?: string;
  email?: string;
  cidade?: string;
  uf?: string;
  /** Marcado como cliente no TOTVS (e não só fornecedor, funcionária, representante) */
  ehCliente: boolean;
}

/** Cadastro genérico do PDV ("CONSUMIDOR FINAL" e afins): não é uma pessoa, não entra. */
export const NOME_GENERICO = /CONSUMIDOR|N[AÃ]O IDENTIFICAD|CLIENTE (PADR|BALC|DIVERSOS|AVULSO)|VENDA (BALC|AVULSA)|^CLIENTE$|^TESTE/i;
/** Cadastro de funcionária com nome marcado: compra, mas não é cliente para mensagens. */
export const NOME_FUNCIONARIA = /FUNCION[AÁ]RI|COLABORADOR|VENDEDOR[A]?\b|GERENTE|USO INTERNO/i;

/**
 * Celulares escritos em texto livre. Nas lojas o campo de telefone do TOTVS
 * dá trabalho e as vendedoras anotam o celular no complemento do endereço
 * ("16 982165086"); aqui achamos qualquer número com DDD no meio do texto.
 */
export function telefonesNoTexto(t?: string): string[] {
  if (!t) return [];
  const achados = t.match(/(?:\+?55[\s.-]*)?\(?\d{2}\)?[\s.-]*9?[\s.-]*\d{4}[\s.-]*\d{4}/g) ?? [];
  return achados.map((x) => normalizarTelefone(x)).filter((n): n is string => Boolean(n));
}

/** Lê uma pessoa da API, tentando os nomes de campo prováveis. */
function lerPessoa(p: Obj): PessoaLida {
  // Telefones: lista de objetos, ou campos soltos
  const nums: string[] = [];
  const lista = (p.phones ?? p.telephones ?? p.phoneNumbers) as Obj[] | undefined;
  if (Array.isArray(lista)) {
    for (const t of lista) {
      const n = normalizarTelefone(str(t, "number", "phoneNumber", "phone", "telephone", "value"));
      if (n) nums.push(n);
    }
  }
  const solto = normalizarTelefone(str(p, "cellPhone", "cellphone", "mobilePhone", "mobile", "phoneNumber", "phone", "telephone"));
  if (solto) nums.push(solto);
  // Endereços: o celular costuma estar no complemento ou na referência; e dali vem a cidade
  let cidade: string | undefined;
  let uf: string | undefined;
  const enderecos = (p.addresses ?? p.address) as Obj[] | Obj | undefined;
  for (const e of Array.isArray(enderecos) ? enderecos : enderecos ? [enderecos] : []) {
    for (const v of Object.values(e)) if (typeof v === "string") nums.push(...telefonesNoTexto(v));
    cidade ??= str(e, "cityName", "city", "municipality", "municipalityName");
    uf ??= str(e, "stateAbbreviation", "uf", "state", "stateCode");
  }
  // Observações (texto solto ou lista de objetos)
  for (const k of ["observation", "observations", "comments", "notes"]) {
    const v = p[k];
    const itens = Array.isArray(v) ? v : [v];
    for (const it of itens) {
      if (typeof it === "string") nums.push(...telefonesNoTexto(it));
      else if (it && typeof it === "object") for (const x of Object.values(it as Obj)) if (typeof x === "string") nums.push(...telefonesNoTexto(x));
    }
  }
  // Prefere celular (DDD + 9)
  const telefone = nums.find((n) => n.length === 13 && n[4] === "9") ?? nums[0];
  let email = str(p, "email", "mainEmail");
  const emails = (p.emails ?? p.emailAddresses) as Obj[] | undefined;
  if (!email && Array.isArray(emails)) email = str(emails[0] ?? {}, "email", "address", "value");
  // Só é cliente quem o TOTVS marca como cliente. Fornecedor, funcionária,
  // representante ou transportadora que não compram ficam de fora.
  const ehCliente = p.isCustomer === true || (p.isCustomer == null && !p.isSupplier && !p.isEmployee && !p.isRepresentative && !p.isShippingCompany);
  return {
    codigo: str(p, "code", "personCode", "customerCode", "id"),
    nome: str(p, "name", "personName", "fullName"),
    cpf: str(p, "cpf", "document", "cpfCnpj"),
    nascimento: str(p, "birthDate", "birthday", "dateOfBirth")?.slice(0, 10),
    telefone,
    email,
    cidade: cidade && cidade.length > 1 ? cidade : undefined,
    uf: uf && uf.length === 2 ? uf.toUpperCase() : undefined,
    ehCliente,
  };
}

const pessoaValida = (p: PessoaLida) => Boolean(p.nome) && p.ehCliente && !NOME_GENERICO.test(p.nome!) && !NOME_FUNCIONARIA.test(p.nome!);

/** O que pedir junto do cadastro: telefones e e-mails vêm null sem isto. */
let expandPessoa: string | null | undefined; // undefined = ainda não sabemos o que a API aceita
const EXPANDS = ["phones,emails,addresses,observations", "phones,emails,addresses", "phones,addresses", "phones,emails", "phones", null];

/** Consulta pessoas, descobrindo na primeira chamada qual `expand` a API aceita. */
async function consultarPessoas(filter: Record<string, unknown>, pagina = 1): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const opcoes = expandPessoa === undefined ? EXPANDS : [expandPessoa];
  let ultimo = { status: 0, json: null as Record<string, unknown> | null, text: "" };
  for (const e of opcoes) {
    const r = await totvsFetch(PESSOAS, { filter, ...(e ? { expand: e } : {}), page: pagina, pageSize: 100 });
    ultimo = r;
    if (r.status === 200) {
      expandPessoa = e;
      return r;
    }
    if (r.status !== 400) break; // 401/500: não é o expand, não adianta insistir
  }
  return ultimo;
}

/** Busca pessoas por lista de códigos (lotes de 50). `personCodeList` confirmado no diagnóstico. */
async function buscarPessoasPorCodigo(codigos: string[]): Promise<PessoaLida[]> {
  const out: PessoaLida[] = [];
  for (let i = 0; i < codigos.length; i += 50) {
    const lote = codigos.slice(i, i + 50).map(Number).filter((n) => !Number.isNaN(n));
    if (!lote.length) continue;
    const r = await consultarPessoas({ personCodeList: lote });
    if (r.status === 200 && Array.isArray(r.json?.items)) for (const p of r.json!.items as Obj[]) out.push(lerPessoa(p));
  }
  return out;
}

/**
 * Pessoas alteradas num período. A API exige dizer o que conta como
 * alteração; se recusar o formato, devolve vazio em vez de derrubar a
 * sincronização (as clientes que importam já vêm pelas notas).
 */
async function buscarPessoasAlteradas(de: string, ate: string, limitePaginas = 50): Promise<PessoaLida[]> {
  const out: PessoaLida[] = [];
  const filtro = {
    change: { startDate: `${de}T00:00:00`, endDate: `${ate}T23:59:59`, inPerson: true, inAddress: true, inPhone: true, inEmail: true, inCustomer: true },
  };
  const primeira = await consultarPessoas(filtro, 1);
  if (primeira.status !== 200) {
    console.warn("[crm] cadastro alterado no período não disponível:", primeira.text.slice(0, 160));
    return out;
  }
  const colher = (itens: unknown) => {
    if (Array.isArray(itens)) for (const p of itens as Obj[]) out.push(lerPessoa(p));
  };
  colher(primeira.json?.items);
  const total = Number(primeira.json?.count ?? 0);
  const paginas = Math.min(Math.ceil(total / 100), limitePaginas);
  for (let p = 2; p <= paginas; p++) {
    const r = await consultarPessoas(filtro, p);
    if (r.status === 200) colher(r.json?.items);
  }
  return out;
}

interface VendaLida {
  venda: Venda;
  codigoCliente?: string;
}

/** Soma do desconto dos produtos da nota (só vem quando a nota é buscada com os itens). */
function descontoDaNota(inv: Obj): number {
  let t = 0;
  for (const it of (inv.items as Obj[] | undefined) ?? []) for (const pr of (it.products as Obj[] | undefined) ?? []) t += Number(pr.discountValue ?? 0) || 0;
  return Math.round(t * 100) / 100;
}

/** Item de frete (motoboy, entrega): não é produto, e marca venda feita à distância. */
export const ITEM_FRETE = /FRETE|MOTO ?BOY|ENTREGA|TAXA DE ENTREGA/i;

/** A nota tem frete de motoboy/entrega entre os itens? */
function temFrete(inv: Obj): boolean {
  return ((inv.items as Obj[] | undefined) ?? []).some((it) => ITEM_FRETE.test(String(it.name ?? it.productName ?? "")));
}

/** Referências das peças da nota (sem frete), para ligar devolução à compra. */
function referencias(inv: Obj): string[] {
  const out = new Set<string>();
  for (const it of (inv.items as Obj[] | undefined) ?? []) {
    if (ITEM_FRETE.test(String(it.name ?? it.productName ?? ""))) continue;
    const cod = str(it, "code", "referenceCode");
    if (cod) out.add(cod);
  }
  return [...out];
}

/** Nota de venda (mesmas operações de ehVenda) que está cancelada. */
function vendaCancelada(inv: Obj): boolean {
  return ehVenda({ ...inv, invoiceStatus: "Issued" }) && inv.invoiceStatus === "Canceled";
}

/** Primeiro dia com cashback nas lojas físicas: devolução antes disso não tem o que tirar. */
const INICIO_CASHBACK_LOJAS = "2026-10-16";

const DEVOLUCAO_DE_VENDA = /DEVOLU[CÇ][AÃ]O DE VENDA/i;

/** Notas de entrada de devolução de venda (lojas e site) entre `de` e `ate`, com as peças. */
async function buscarDevolucoes(de: string, ate: string): Promise<DevolucaoLida[]> {
  const out: DevolucaoLida[] = [];
  const hoje = hojeSp();
  const changeAte = somarDias(ate, 10) > hoje ? hoje : somarDias(ate, 10);
  for (let pagina = 1; pagina <= 50; pagina++) {
    const r = await totvsFetch(INVOICES, {
      filter: { branchCodeList: Object.keys(LOJAS).map(Number), operationType: "Input", change: { startDate: `${de}T00:00:00`, endDate: `${changeAte}T23:59:59` } },
      expand: "items",
      page: pagina,
      pageSize: 100,
    });
    if (r.status !== 200) throw new Error(`Devoluções: HTTP ${r.status} — ${r.text.slice(0, 200)}`);
    const lista = (r.json?.items as Obj[] | undefined) ?? [];
    for (const inv of lista) {
      const data = String(inv.invoiceDate ?? "").slice(0, 10);
      if (data < de || data > ate) continue;
      if (!DEVOLUCAO_DE_VENDA.test(String(inv.operatioName ?? inv.operationName ?? ""))) continue;
      if (inv.invoiceStatus === "Canceled") continue;
      const filial = Number(inv.branchCode);
      const nome = str(inv, "personName", "customerName");
      out.push({
        id: `${filial}-${inv.invoiceSequence}`,
        loja: LOJAS[filial] ?? `Filial ${filial}`,
        data,
        valor: Number(inv.totalValue ?? 0),
        codigoCliente: nome && !NOME_GENERICO.test(nome) ? str(inv, "personCode", "customerCode") : undefined,
        nomeNaNota: nome,
        itens: referencias(inv),
      });
    }
    if (lista.length < 100) break;
  }
  return out;
}

/**
 * Confere as devoluções do período e tira o cashback das compras devolvidas.
 * Só na sincronização com cashback (a diária), nunca na carga histórica.
 */
export async function conferirDevolucoes(de: string, ate: string): Promise<{ novas: number; estorno: number }> {
  const devs = await buscarDevolucoes(de, ate);
  let novas = 0;
  let estorno = 0;
  await alterarBase((b) => {
    for (const d of devs.sort((a, z) => a.data.localeCompare(z.data))) {
      const r = aplicarDevolucao(b, d);
      if (!r) continue;
      novas++;
      estorno += r.estorno;
    }
    limparDevolucoes(b, hojeSp());
    if (!b.config.devolucoesAte || ate > b.config.devolucoesAte) b.config.devolucoesAte = ate;
  });
  return { novas, estorno: Math.round(estorno * 100) / 100 };
}

/** Notas emitidas entre `de` e `ate` (datas YYYY-MM-DD), paginadas pela data de alteração. */
async function buscarVendas(de: string, ate: string, limitePaginas = 300, itens = false, canceladas: string[] = []): Promise<VendaLida[]> {
  const out: VendaLida[] = [];
  const hoje = hojeSp();
  const changeAte = somarDias(ate, 25) > hoje ? hoje : somarDias(ate, 25);
  const corpo = (pagina: number) => ({
    filter: {
      branchCodeList: Object.keys(LOJAS).map(Number),
      operationType: "Output",
      change: { startDate: `${de}T00:00:00`, endDate: `${changeAte}T23:59:59` },
    },
    // Com os itens vem o desconto de cada nota (pra conferir o cashback); pesa, então só na sincronização curta
    ...(itens ? { expand: "items" } : {}),
    page: pagina,
    pageSize: 100,
  });
  const colher = (itens: unknown) => {
    if (!Array.isArray(itens)) return;
    for (const inv of itens as Obj[]) {
      const data = String(inv.invoiceDate ?? "").slice(0, 10);
      if (data < de || data > ate) continue;
      // Venda que foi cancelada depois de emitida: o cashback dela sai
      if (vendaCancelada(inv)) canceladas.push(`${Number(inv.branchCode)}-${inv.invoiceSequence}`);
      if (!ehVenda(inv)) continue;
      const filial = Number(inv.branchCode);
      const loja = LOJAS[filial] ?? `Filial ${filial}`;
      const codigoCliente = str(inv, "personCode", "customerCode", "personId");
      const pessoa = inv.person as Obj | undefined;
      const nomeNota = str(inv, "personName", "customerName") ?? (pessoa ? str(pessoa, "name") : undefined);
      // Nota em nome do "consumidor final" não tem cliente: entra sem ligação, nunca gera cashback
      const generica = !nomeNota || NOME_GENERICO.test(nomeNota);
      out.push({
        codigoCliente: generica ? undefined : (codigoCliente ?? (pessoa ? str(pessoa, "code", "personCode") : undefined)),
        venda: {
          id: `${filial}-${inv.invoiceSequence}`,
          loja,
          data: `${data}T${inv.exitTime ?? "12:00:00"}-03:00`,
          valor: Number(inv.totalValue ?? 0),
          pecas: num(inv, "quantity"),
          vendedoraCpf: str(inv, "sellerCpf")?.replace(/\D/g, "").padStart(11, "0") || undefined,
          nomeNaNota: nomeNota,
          codigoClienteTotvs: generica ? undefined : codigoCliente,
          cpfNaNota: str(inv, "personCpfCnpj", "cpfCnpj", "personDocument", "customerCpf")?.replace(/\D/g, "") || undefined,
          desconto: itens ? descontoDaNota(inv) : undefined,
          entrega: itens ? temFrete(inv) : undefined,
          itens: itens ? referencias(inv) : undefined,
          origem: "totvs",
        },
      });
    }
  };
  const primeira = await totvsFetch(INVOICES, corpo(1));
  if (primeira.status !== 200) throw new Error(`Notas fiscais: HTTP ${primeira.status} — ${primeira.text.slice(0, 200)}`);
  colher(primeira.json?.items);
  const total = Number(primeira.json?.count ?? 0);
  const paginas = Math.min(Math.ceil(total / 100), limitePaginas);
  for (let inicio = 2; inicio <= paginas; inicio += 10) {
    const lote = [];
    for (let p = inicio; p < inicio + 10 && p <= paginas; p++) lote.push(totvsFetch(INVOICES, corpo(p)));
    for (const r of await Promise.all(lote)) if (r.status === 200) colher(r.json?.items);
  }
  return out;
}

/** Um trecho (até um mês): notas, cadastro das clientes que apareceram, ligação e cashback. */
async function sincronizarTrecho(de: string, ate: string, opcoes: { creditar?: boolean; pessoasAlteradas?: boolean; itens?: boolean }): Promise<void> {
  const canceladas: string[] = [];
  const vendas = await buscarVendas(de, ate, 300, opcoes.itens, canceladas);
  progresso.etapa = `${de} a ${ate}: lendo cadastro de ${vendas.length} notas`;

  // Um código que aparece em boa parte das notas não é uma pessoa: é o
  // "consumidor final" com nome próprio. Desliga a ligação para ele.
  if (vendas.length >= 30) {
    const freq = new Map<string, number>();
    for (const v of vendas) if (v.codigoCliente) freq.set(v.codigoCliente, (freq.get(v.codigoCliente) ?? 0) + 1);
    for (const [cod, n] of freq) {
      if (n / vendas.length > 0.15) {
        console.warn(`[crm] código ${cod} em ${n} de ${vendas.length} notas: tratado como consumidor final`);
        for (const v of vendas) if (v.codigoCliente === cod) (v.codigoCliente = undefined), (v.venda.codigoClienteTotvs = undefined);
      }
    }
  }

  const codigos = Array.from(new Set(vendas.map((v) => v.codigoCliente).filter((c): c is string => Boolean(c))));
  const base = await lerBase();
  const conhecidos = new Set(base.clientes.map((c) => c.codigoTotvs).filter(Boolean));
  const faltando = codigos.filter((c) => !conhecidos.has(c));
  // Também revisita, aos poucos, clientes já conhecidas que ficaram sem telefone:
  // a vendedora pode ter completado o cadastro no TOTVS depois
  const semTelefone = opcoes.pessoasAlteradas
    ? base.clientes
        .filter((c) => c.codigoTotvs && !c.telefone)
        .sort((a, b) => a.atualizadoEm.localeCompare(b.atualizadoEm))
        .slice(0, 200)
        .map((c) => c.codigoTotvs!)
    : [];
  const pessoas = faltando.length || semTelefone.length ? await buscarPessoasPorCodigo([...faltando, ...semTelefone]) : [];
  if (opcoes.pessoasAlteradas) {
    progresso.etapa = "cadastros alterados no período";
    pessoas.push(...(await buscarPessoasAlteradas(de, ate)));
  }

  // Nome das vendedoras das notas (para assinar as mensagens), só os CPFs ainda desconhecidos
  const cpfsVend = Array.from(new Set(vendas.map((v) => v.venda.vendedoraCpf).filter((c): c is string => Boolean(c)))).filter((c) => !base.vendedoras?.[c]);
  const nomesVend = new Map<string, string>();
  for (let i = 0; i < cpfsVend.length; i += 50) {
    const lote = cpfsVend.slice(i, i + 50);
    for (const extra of [{}, { personIsInactive: true }]) {
      const r = await consultarPessoas({ cpfList: lote, ...extra });
      for (const p of ((r.json?.items as Obj[] | undefined) ?? [])) {
        const cpf = str(p, "cpf")?.replace(/\D/g, "").padStart(11, "0");
        const nome = str(p, "name");
        if (cpf && nome && !nomesVend.has(cpf)) nomesVend.set(cpf, nome);
      }
      if (lote.every((c) => nomesVend.has(c))) break;
    }
  }

  progresso.etapa = `${de} a ${ate}: gravando`;
  await alterarBase((b) => {
    b.vendedoras ??= {};
    for (const [cpf, nome] of nomesVend) b.vendedoras[cpf] = nome;
    const pctAntes = b.config.cashbackPct;
    if (opcoes.creditar === false) b.config.cashbackPct = 0; // carga histórica sem cashback
    const foraDoPerfil = new Set(pessoas.filter((p) => p.codigo && !pessoaValida(p)).map((p) => p.codigo!));
    for (const p of pessoas) {
      if (!pessoaValida(p)) continue;
      const { nova } = salvarCliente(b, { nome: p.nome!, telefone: p.telefone, cpf: p.cpf, email: p.email, nascimento: p.nascimento, codigoTotvs: p.codigo, cidade: p.cidade, uf: p.uf }, "totvs");
      if (nova) progresso.clientesNovos++;
      else progresso.clientesAtualizados++;
    }
    for (const { venda, codigoCliente } of vendas) {
      // Fornecedor ou cadastro genérico que apareceu numa nota: a venda fica sem cliente
      if (codigoCliente && foraDoPerfil.has(codigoCliente)) venda.codigoClienteTotvs = undefined;
      const c =
        (codigoCliente && !foraDoPerfil.has(codigoCliente) && b.clientes.find((x) => x.codigoTotvs === codigoCliente)) ||
        (venda.cpfNaNota && b.clientes.find((x) => x.cpf === venda.cpfNaNota)) ||
        undefined;
      if (c) {
        venda.clienteId = c.id;
        c.lojaOrigem ??= venda.loja;
        // A vendedora da nota é a própria cliente: é funcionária comprando (ou
        // passando venda no nome dela). Fica fora das mensagens e marcada na ficha.
        if (venda.vendedoraCpf && c.cpf && venda.vendedoraCpf === c.cpf && !c.optOut) {
          c.optOut = true;
          c.optOutEm = new Date().toISOString();
          c.obs = [c.obs, "Funcionária (vendeu para o próprio CPF)"].filter(Boolean).join(" · ");
        }
      }
      if (registrarVenda(b, venda)) progresso.vendasNovas++;
    }
    conciliarVendas(b);
    // Venda cancelada na TOTVS sai da base e leva o cashback junto
    for (const id of canceladas) aplicarCancelamento(b, id);
    b.config.cashbackPct = pctAntes;
    b.config.ultimaSincTotvs = new Date().toISOString();
    b.config.ultimaSincTotvsResultado = `${de} a ${ate}: ${progresso.vendasNovas} vendas novas, ${progresso.clientesNovos} clientes novos`;
    if (!b.config.sincVendasDesde || de < b.config.sincVendasDesde) b.config.sincVendasDesde = de;
  });
}

/** Quebra o período em pedaços de até um mês: a API limita a janela e assim o progresso fica visível e vai sendo salvo. */
function trechos(de: string, ate: string): { de: string; ate: string }[] {
  const out: { de: string; ate: string }[] = [];
  let ini = de;
  while (ini <= ate) {
    const [a, m] = ini.split("-").map(Number);
    const fimMes = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    out.push({ de: ini, ate: fimMes < ate ? fimMes : ate });
    ini = somarDias(fimMes, 1);
  }
  return out;
}

/**
 * Sincroniza um período, mês a mês. `creditar=false` para a carga histórica,
 * que não deve gerar cashback antigo. Vai do mais recente para o mais antigo,
 * para a base útil aparecer primeiro.
 */
export async function sincronizar(de: string, ate: string, opcoes: { creditar?: boolean; pessoasAlteradas?: boolean } = {}): Promise<typeof progresso> {
  if (!totvsConfigured()) throw new Error("TOTVS não está configurado (veja /configurar).");
  if (progresso.rodando) throw new Error("Já tem uma sincronização rodando.");
  Object.assign(progresso, { rodando: true, etapa: "buscando notas", inicio: Date.now(), vendasNovas: 0, clientesNovos: 0, clientesAtualizados: 0, erro: undefined, fim: undefined });
  try {
    const partes = trechos(de, ate).reverse();
    for (let i = 0; i < partes.length; i++) {
      progresso.etapa = `mês ${i + 1} de ${partes.length} (${partes[i].de} a ${partes[i].ate}): buscando notas`;
      // Período curto (a diária) vem com os itens, pra ter o desconto de cada nota
      await sincronizarTrecho(partes[i].de, partes[i].ate, { ...opcoes, itens: diasEntre(de, ate) <= 7 });
    }
    await alterarBase((b) => {
      b.config.ultimaSincTotvsResultado = `${de} a ${ate}: ${progresso.vendasNovas} vendas novas, ${progresso.clientesNovos} clientes novos, ${progresso.clientesAtualizados} atualizados`;
    });
    progresso.etapa = "concluído";
  } catch (e) {
    progresso.erro = e instanceof Error ? e.message : String(e);
    progresso.etapa = "falhou";
    await alterarBase((b) => {
      b.config.ultimaSincTotvsResultado = `falhou (${progresso.vendasNovas} vendas já salvas): ${progresso.erro}`;
    });
  } finally {
    progresso.rodando = false;
    progresso.fim = Date.now();
  }
  return progresso;
}

/**
 * Sincronização automática, com cashback: no mínimo os últimos 3 dias e,
 * se ficou dia sem sincronizar (computador desligado, TOTVS fora), desde o
 * último dia coberto — até 45 dias; buraco maior é carga histórica, pela
 * tela. Chamada pelo agendador várias vezes ao dia.
 */
export async function sincronizarDiaria(): Promise<typeof progresso | null> {
  if (!totvsConfigured() || progresso.rodando) return null;
  const hoje = hojeSp();
  const ultimo = (await lerBase()).config.diariaTotvsAte;
  const candidatos = [somarDias(hoje, -3), ...(ultimo ? [somarDias(ultimo, -1)] : [])].sort();
  const de = candidatos[0] < somarDias(hoje, -45) ? somarDias(hoje, -45) : candidatos[0];
  const r = await sincronizar(de, hoje, { creditar: true, pessoasAlteradas: true });
  if (!r.erro)
    await alterarBase((b) => {
      b.config.diariaTotvsAte = hoje;
      b.config.diariaTotvsEm = new Date().toISOString();
    });
  // Devoluções: desde o último dia conferido (na primeira vez, desde o começo do cashback nas lojas)
  if (!r.erro) {
    const devAte = (await lerBase()).config.devolucoesAte;
    const devDe = devAte ? (somarDias(devAte, -2) < de ? somarDias(devAte, -2) : de) : INICIO_CASHBACK_LOJAS;
    try {
      const d = await conferirDevolucoes(devDe < somarDias(hoje, -45) ? somarDias(hoje, -45) : devDe, hoje);
      if (d.novas) console.log(`[crm] devoluções: ${d.novas} novas, R$ ${d.estorno} de cashback estornado`);
    } catch (e) {
      console.error("[crm] devoluções:", e instanceof Error ? e.message : e);
    }
  }
  return r;
}

/**
 * Relê o cadastro de toda cliente do TOTVS que está sem celular no CRM,
 * agora olhando também o endereço (complemento, referência). Roda uma vez
 * sozinha depois da atualização e pelo botão em Configurar → Dados.
 */
export async function completarTelefones(): Promise<{ consultadas: number; achados: number; cidades: number }> {
  if (!totvsConfigured()) throw new Error("TOTVS não está configurado.");
  if (progresso.rodando) throw new Error("Já tem uma sincronização rodando.");
  Object.assign(progresso, { rodando: true, etapa: "procurando celular nos cadastros", inicio: Date.now(), vendasNovas: 0, clientesNovos: 0, clientesAtualizados: 0, erro: undefined, fim: undefined });
  try {
    const base = await lerBase();
    const codigos = base.clientes.filter((c) => c.codigoTotvs && (!c.telefone || !c.cidade)).map((c) => c.codigoTotvs!);
    let achados = 0;
    let cidades = 0;
    for (let i = 0; i < codigos.length; i += 200) {
      progresso.etapa = `procurando celular nos cadastros (${Math.min(i + 200, codigos.length)} de ${codigos.length})`;
      const pessoas = await buscarPessoasPorCodigo(codigos.slice(i, i + 200));
      await alterarBase((b) => {
        for (const p of pessoas) {
          const c = p.codigo ? b.clientes.find((x) => x.codigoTotvs === p.codigo) : undefined;
          if (!c) continue;
          if (!c.telefone && p.telefone && !b.clientes.some((x) => x.telefone === p.telefone)) {
            c.telefone = p.telefone;
            achados++;
          }
          if (!c.cidade && p.cidade) {
            c.cidade = p.cidade;
            c.uf ??= p.uf;
            cidades++;
          }
          c.atualizadoEm = new Date().toISOString();
        }
      });
      progresso.clientesAtualizados = achados;
    }
    await alterarBase((b) => {
      b.config.telefonesNoEndereco = true;
      b.config.ultimaSincTotvsResultado = `celular no endereço: ${achados} clientes ganharam celular (de ${codigos.length} consultadas)`;
    });
    progresso.etapa = "concluído";
    return { consultadas: codigos.length, achados, cidades };
  } catch (e) {
    progresso.erro = e instanceof Error ? e.message : String(e);
    progresso.etapa = "falhou";
    throw e;
  } finally {
    progresso.rodando = false;
    progresso.fim = Date.now();
  }
}

/** Resposta crua de uma nota e de uma pessoa, para conferir os nomes dos campos. */
export async function diagnostico(): Promise<Record<string, unknown>> {
  if (!totvsConfigured()) throw new Error("TOTVS não está configurado.");
  const hoje = hojeSp();
  const nota = await totvsFetch(INVOICES, {
    filter: {
      branchCodeList: Object.keys(LOJAS).map(Number),
      operationType: "Output",
      change: { startDate: `${somarDias(hoje, -7)}T00:00:00`, endDate: `${hoje}T23:59:59` },
    },
    page: 1,
    pageSize: 1,
  });
  const item = (nota.json?.items as Obj[] | undefined)?.[0];
  const codigo = item ? str(item, "personCode", "customerCode", "personId") : undefined;
  let pessoaPorCodigo: unknown;
  if (codigo) {
    expandPessoa = undefined; // redescobre o expand a cada diagnóstico
    const r = await consultarPessoas({ personCodeList: [Number(codigo)] });
    pessoaPorCodigo = { status: r.status, expandAceito: expandPessoa ?? "(nenhum aceito)", lida: r.json ? lerPessoa(((r.json.items as Obj[]) ?? [])[0] ?? {}) : null, json: r.json ?? r.text.slice(0, 500) };
  }
  const alteradas = await consultarPessoas({
    change: { startDate: `${somarDias(hoje, -7)}T00:00:00`, endDate: `${hoje}T23:59:59`, inPerson: true, inAddress: true, inPhone: true, inEmail: true, inCustomer: true },
  });
  return {
    nota: { status: nota.status, json: nota.json ?? nota.text.slice(0, 500) },
    pessoaPorCodigo,
    pessoasAlteradas: { status: alteradas.status, count: alteradas.json?.count, erro: alteradas.status !== 200 ? alteradas.text.slice(0, 300) : undefined },
  };
}

/**
 * Explora a API à procura de um jeito de lançar crédito ou vale no cliente,
 * sem depender do suporte: endpoint que existe mas não pode ser usado
 * responde 400/401/405; o que não existe responde 404. Também procura a
 * documentação Swagger, que costuma listar tudo.
 */
export async function explorar(): Promise<Record<string, unknown>> {
  if (!totvsConfigured()) throw new Error("TOTVS não está configurado.");
  const base = totvsBaseUrl();
  const token = await getTotvsToken();
  const tentar = async (caminho: string, metodo: "GET" | "POST" = "GET", corpo?: unknown) => {
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), 15000);
    try {
      const r = await fetch(`${base}${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: corpo ? JSON.stringify(corpo) : undefined,
        cache: "no-store",
        signal: controle.signal,
      });
      const texto = await r.text();
      return { status: r.status, tipo: r.headers.get("content-type")?.split(";")[0], amostra: texto.slice(0, 220).replace(/\s+/g, " ") };
    } catch (e) {
      return { status: 0, erro: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(t);
    }
  };

  // 1. Documentação
  const docs: Record<string, unknown> = {};
  for (const c of ["/swagger/index.html", "/swagger/v1/swagger.json", "/swagger/v2/swagger.json", "/api/totvsmoda/swagger/v1/swagger.json", "/api/totvsmoda/docs", "/api/totvsmoda/api-docs", "/api/totvsmoda/person/v2/swagger.json", "/api/totvsmoda/fiscal/v2/swagger.json"]) {
    docs[c] = await tentar(c);
  }

  // 2. Módulos e endpoints prováveis (busca via POST .../search como os conhecidos)
  const modulos = ["person", "fiscal", "financial", "sales-order", "sales", "product", "stock", "pdv", "crm", "loyalty", "customer", "discount", "voucher", "credit", "gift-card", "promotion", "price", "commission", "seller", "cash", "accounts-receivable", "payment"];
  const recursos = ["customer-credits", "credits", "credit", "vouchers", "voucher", "gift-cards", "discounts", "customer-discounts", "promotions", "coupons", "bonus", "loyalty", "balances", "cash-credits", "advance-payments", "receivables", "titles"];
  const sondas: Record<string, unknown> = {};
  // Primeiro uma rodada leve por módulo, só pra ver quais existem
  for (const m of modulos) {
    sondas[`/api/totvsmoda/${m}/v2`] = await tentar(`/api/totvsmoda/${m}/v2`);
  }
  // Depois os recursos de crédito nos módulos que não deram 404
  const vivos = modulos.filter((m) => (sondas[`/api/totvsmoda/${m}/v2`] as { status: number }).status !== 404);
  for (const m of vivos.length ? vivos : ["person", "financial", "sales", "pdv"]) {
    for (const r of recursos) {
      const c = `/api/totvsmoda/${m}/v2/${r}/search`;
      const res = await tentar(c, "POST", { page: 1, pageSize: 1 });
      if (res.status !== 404) sondas[c] = res;
    }
  }
  return {
    comoLer: "404 = não existe. 400/405 = existe, mas pede outro formato ou método. 401/403 = existe e a credencial não tem permissão. 200 = existe e já responde.",
    documentacao: docs,
    sondas,
  };
}
