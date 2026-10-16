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

import { LOJAS, totvsConfigured, totvsFetch } from "../connectors/totvs";
import { alterarBase, hojeSp, lerBase, somarDias } from "./base";
import { conciliarVendas, registrarVenda, salvarCliente } from "./clientes";
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
}

/** Lê uma pessoa da API, tentando os nomes de campo prováveis. */
function lerPessoa(p: Obj): PessoaLida {
  // Telefones: lista de objetos, ou campos soltos
  let telefone: string | undefined;
  const lista = (p.phones ?? p.telephones ?? p.phoneNumbers) as Obj[] | undefined;
  if (Array.isArray(lista)) {
    const nums = lista
      .map((t) => str(t, "number", "phoneNumber", "phone", "telephone", "value"))
      .map((n) => normalizarTelefone(n))
      .filter((n): n is string => Boolean(n));
    // Prefere celular (DDD + 9)
    telefone = nums.find((n) => n.length === 13 && n[4] === "9") ?? nums[0];
  }
  telefone ??= normalizarTelefone(str(p, "cellPhone", "cellphone", "mobilePhone", "mobile", "phoneNumber", "phone", "telephone"));
  let email = str(p, "email", "mainEmail");
  const emails = (p.emails ?? p.emailAddresses) as Obj[] | undefined;
  if (!email && Array.isArray(emails)) email = str(emails[0] ?? {}, "email", "address", "value");
  return {
    codigo: str(p, "code", "personCode", "customerCode", "id"),
    nome: str(p, "name", "personName", "fullName"),
    cpf: str(p, "cpf", "document", "cpfCnpj"),
    nascimento: str(p, "birthDate", "birthday", "dateOfBirth")?.slice(0, 10),
    telefone,
    email,
  };
}

/** Busca pessoas por lista de códigos (lotes de 50), tentando o nome de filtro que a API aceitar. */
async function buscarPessoasPorCodigo(codigos: string[]): Promise<PessoaLida[]> {
  const out: PessoaLida[] = [];
  const filtros = ["personCodeList", "codeList", "customerCodeList"];
  let filtroOk: string | undefined;
  for (let i = 0; i < codigos.length; i += 50) {
    const lote = codigos.slice(i, i + 50).map(Number).filter((n) => !Number.isNaN(n));
    if (!lote.length) continue;
    const tentar = filtroOk ? [filtroOk] : filtros;
    for (const f of tentar) {
      const r = await totvsFetch(PESSOAS, { filter: { [f]: lote }, page: 1, pageSize: 100 });
      if (r.status === 200 && Array.isArray(r.json?.items)) {
        filtroOk = f;
        for (const p of r.json!.items as Obj[]) out.push(lerPessoa(p));
        break;
      }
    }
  }
  return out;
}

/** Pessoas alteradas num período (cadastros novos e atualizados), paginado. */
async function buscarPessoasAlteradas(de: string, ate: string, limitePaginas = 100): Promise<PessoaLida[]> {
  const out: PessoaLida[] = [];
  const corpo = (pagina: number) => ({
    filter: { change: { startDate: `${de}T00:00:00`, endDate: `${ate}T23:59:59` } },
    page: pagina,
    pageSize: 100,
  });
  const primeira = await totvsFetch(PESSOAS, corpo(1));
  if (primeira.status !== 200) throw new Error(`Cadastro de pessoas: HTTP ${primeira.status} — ${primeira.text.slice(0, 200)}`);
  const colher = (itens: unknown) => {
    if (Array.isArray(itens)) for (const p of itens as Obj[]) out.push(lerPessoa(p));
  };
  colher(primeira.json?.items);
  const total = Number(primeira.json?.count ?? 0);
  const paginas = Math.min(Math.ceil(total / 100), limitePaginas);
  for (let p = 2; p <= paginas; p++) {
    const r = await totvsFetch(PESSOAS, corpo(p));
    if (r.status === 200) colher(r.json?.items);
  }
  return out;
}

interface VendaLida {
  venda: Venda;
  codigoCliente?: string;
}

/** Notas emitidas entre `de` e `ate` (datas YYYY-MM-DD), paginadas pela data de alteração. */
async function buscarVendas(de: string, ate: string, limitePaginas = 300): Promise<VendaLida[]> {
  const out: VendaLida[] = [];
  const hoje = hojeSp();
  const changeAte = somarDias(ate, 25) > hoje ? hoje : somarDias(ate, 25);
  const corpo = (pagina: number) => ({
    filter: {
      branchCodeList: Object.keys(LOJAS).map(Number),
      operationType: "Output",
      change: { startDate: `${de}T00:00:00`, endDate: `${changeAte}T23:59:59` },
    },
    page: pagina,
    pageSize: 100,
  });
  const colher = (itens: unknown) => {
    if (!Array.isArray(itens)) return;
    for (const inv of itens as Obj[]) {
      const data = String(inv.invoiceDate ?? "").slice(0, 10);
      if (data < de || data > ate || !ehVenda(inv)) continue;
      const filial = Number(inv.branchCode);
      const loja = LOJAS[filial] ?? `Filial ${filial}`;
      const codigoCliente = str(inv, "personCode", "customerCode", "personId");
      const pessoa = inv.person as Obj | undefined;
      out.push({
        codigoCliente: codigoCliente ?? (pessoa ? str(pessoa, "code", "personCode") : undefined),
        venda: {
          id: `${filial}-${inv.invoiceSequence}`,
          loja,
          data: `${data}T${inv.exitTime ?? "12:00:00"}-03:00`,
          valor: Number(inv.totalValue ?? 0),
          pecas: num(inv, "quantity"),
          nomeNaNota: str(inv, "personName", "customerName") ?? (pessoa ? str(pessoa, "name") : undefined),
          codigoClienteTotvs: codigoCliente,
          cpfNaNota: str(inv, "personCpfCnpj", "cpfCnpj", "personDocument", "customerCpf")?.replace(/\D/g, "") || undefined,
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

/**
 * Sincroniza um período: vendas, depois o cadastro das clientes que
 * apareceram, depois liga uma coisa à outra e credita o cashback.
 * `creditar=false` para a carga histórica, que não deve gerar cashback antigo.
 */
export async function sincronizar(de: string, ate: string, opcoes: { creditar?: boolean; pessoasAlteradas?: boolean } = {}): Promise<typeof progresso> {
  if (!totvsConfigured()) throw new Error("TOTVS não está configurado (veja /configurar).");
  if (progresso.rodando) throw new Error("Já tem uma sincronização rodando.");
  Object.assign(progresso, { rodando: true, etapa: "buscando notas", inicio: Date.now(), vendasNovas: 0, clientesNovos: 0, clientesAtualizados: 0, erro: undefined, fim: undefined });
  try {
    const vendas = await buscarVendas(de, ate);
    progresso.etapa = `lendo cadastro de ${vendas.length} notas`;

    const codigos = Array.from(new Set(vendas.map((v) => v.codigoCliente).filter((c): c is string => Boolean(c))));
    const base = await lerBase();
    const conhecidos = new Set(base.clientes.map((c) => c.codigoTotvs).filter(Boolean));
    const faltando = codigos.filter((c) => !conhecidos.has(c));
    const pessoas = faltando.length ? await buscarPessoasPorCodigo(faltando) : [];
    if (opcoes.pessoasAlteradas) {
      progresso.etapa = "cadastros alterados no período";
      pessoas.push(...(await buscarPessoasAlteradas(de, ate)));
    }

    progresso.etapa = "gravando";
    await alterarBase((b) => {
      const pctAntes = b.config.cashbackPct;
      if (opcoes.creditar === false) b.config.cashbackPct = 0; // carga histórica sem cashback
      for (const p of pessoas) {
        if (!p.nome) continue;
        const { nova } = salvarCliente(b, { nome: p.nome, telefone: p.telefone, cpf: p.cpf, email: p.email, nascimento: p.nascimento, codigoTotvs: p.codigo }, "totvs");
        if (nova) progresso.clientesNovos++;
        else progresso.clientesAtualizados++;
      }
      for (const { venda, codigoCliente } of vendas) {
        const c =
          (codigoCliente && b.clientes.find((x) => x.codigoTotvs === codigoCliente)) ||
          (venda.cpfNaNota && b.clientes.find((x) => x.cpf === venda.cpfNaNota)) ||
          undefined;
        if (c) {
          venda.clienteId = c.id;
          c.lojaOrigem ??= venda.loja;
        }
        if (registrarVenda(b, venda)) progresso.vendasNovas++;
      }
      conciliarVendas(b);
      b.config.cashbackPct = pctAntes;
      b.config.ultimaSincTotvs = new Date().toISOString();
      b.config.ultimaSincTotvsResultado = `${de} a ${ate}: ${progresso.vendasNovas} vendas novas, ${progresso.clientesNovos} clientes novos`;
      if (!b.config.sincVendasDesde || de < b.config.sincVendasDesde) b.config.sincVendasDesde = de;
    });
    progresso.etapa = "concluído";
  } catch (e) {
    progresso.erro = e instanceof Error ? e.message : String(e);
    progresso.etapa = "falhou";
    await alterarBase((b) => {
      b.config.ultimaSincTotvsResultado = `falhou: ${progresso.erro}`;
    });
  } finally {
    progresso.rodando = false;
    progresso.fim = Date.now();
  }
  return progresso;
}

/** Sincronização diária: os últimos 3 dias, com cashback. Chamada pelo agendador. */
export async function sincronizarDiaria(): Promise<typeof progresso | null> {
  if (!totvsConfigured() || progresso.rodando) return null;
  const hoje = hojeSp();
  return sincronizar(somarDias(hoje, -3), hoje, { creditar: true, pessoasAlteradas: true });
}

/** Resposta crua de uma nota e de uma pessoa, para conferir os nomes dos campos. */
export async function diagnostico(): Promise<{ nota: unknown; pessoa: unknown; pessoaPorCodigo?: unknown }> {
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
  const pessoa = await totvsFetch(PESSOAS, {
    filter: { change: { startDate: `${somarDias(hoje, -30)}T00:00:00`, endDate: `${hoje}T23:59:59` } },
    page: 1,
    pageSize: 1,
  });
  const item = (nota.json?.items as Obj[] | undefined)?.[0];
  const codigo = item ? str(item, "personCode", "customerCode", "personId") : undefined;
  let pessoaPorCodigo: unknown;
  if (codigo) {
    const r = await totvsFetch(PESSOAS, { filter: { personCodeList: [Number(codigo)] }, page: 1, pageSize: 1 });
    pessoaPorCodigo = { status: r.status, json: r.json ?? r.text.slice(0, 500) };
  }
  return {
    nota: { status: nota.status, json: nota.json ?? nota.text.slice(0, 500) },
    pessoa: { status: pessoa.status, json: pessoa.json ?? pessoa.text.slice(0, 500) },
    pessoaPorCodigo,
  };
}
