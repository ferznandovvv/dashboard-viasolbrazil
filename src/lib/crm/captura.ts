/**
 * Celular no caixa: das vendas de cada loja, quantas saíram com o celular da
 * cliente. Separa os dois jeitos de falhar, porque a cobrança é diferente:
 * - cadastro sem celular: a cliente foi identificada na nota, mas o cadastro
 *   dela não tem celular (nem no campo de celular, nem no endereço);
 * - venda sem cadastro: a nota saiu sem cliente (consumidor final).
 */

import { LOJAS } from "@/lib/connectors/totvs";
import { hojeSp, somarDias } from "./base";
import type { BaseCrm } from "./tipos";

export interface LinhaCaptura {
  vendas: number;
  comCelular: number;
  cadastroSemCelular: number;
  semCadastro: number;
  /** % das vendas com celular */
  pct: number | null;
}

export interface CapturaLoja extends LinhaCaptura {
  loja: string;
  /** Mesmo % no período anterior de mesmo tamanho */
  pctAnterior: number | null;
}

export interface VendaSemCelular {
  data: string;
  vendedora: string;
  cliente: string;
  valor: number;
  tipo: "cadastro_sem_celular" | "sem_cadastro";
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const padCpf = (c: string) => c.replace(/\D/g, "").padStart(11, "0");
const nomeCurto = (n: string) =>
  n
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");

const vazia = (): LinhaCaptura => ({ vendas: 0, comCelular: 0, cadastroSemCelular: 0, semCadastro: 0, pct: null });
const fechar = (l: LinhaCaptura) => ({ ...l, pct: pct(l.comCelular, l.vendas) });

export function capturaCelular(base: BaseCrm, dias = 30, loja?: string) {
  const hoje = hojeSp();
  const desde = somarDias(hoje, -dias);
  const antes = somarDias(hoje, -2 * dias);
  const clientes = new Map(base.clientes.map((c) => [c.id, c]));
  const nomeVend = (cpf?: string) => {
    if (!cpf) return "Sem vendedora na nota";
    const n = base.vendedoras?.[padCpf(cpf)];
    return n ? nomeCurto(n) : `CPF •••${padCpf(cpf).slice(3, 9)}`;
  };

  const porLoja = new Map<string, LinhaCaptura>();
  const anterior = new Map<string, { v: number; c: number }>();
  const porVendedora = new Map<string, LinhaCaptura>();
  const lista: VendaSemCelular[] = [];

  for (const v of base.vendas) {
    // Só o que passou no caixa da loja (site e ajustes ficam de fora)
    if (v.valor <= 0 || v.origem === "shopify") continue;
    const d = v.data.slice(0, 10);
    if (d <= antes) continue;
    const c = v.clienteId ? clientes.get(v.clienteId) : undefined;
    const tipo = !c ? "sem_cadastro" : c.telefone ? "com" : "cadastro_sem_celular";
    if (d <= desde) {
      const a = anterior.get(v.loja) ?? anterior.set(v.loja, { v: 0, c: 0 }).get(v.loja)!;
      a.v++;
      if (tipo === "com") a.c++;
      continue;
    }
    const somar = (l: LinhaCaptura) => {
      l.vendas++;
      if (tipo === "com") l.comCelular++;
      else if (tipo === "sem_cadastro") l.semCadastro++;
      else l.cadastroSemCelular++;
    };
    somar(porLoja.get(v.loja) ?? porLoja.set(v.loja, vazia()).get(v.loja)!);
    if (loja && v.loja === loja) {
      const vend = nomeVend(v.vendedoraCpf);
      somar(porVendedora.get(vend) ?? porVendedora.set(vend, vazia()).get(vend)!);
      if (tipo !== "com")
        lista.push({
          data: v.data,
          vendedora: vend,
          cliente: c ? nomeCurto(c.nome || "") || "Cliente sem nome" : v.nomeNaNota ? nomeCurto(v.nomeNaNota) : "Sem cliente na nota",
          valor: Math.round(v.valor),
          tipo,
        });
    }
  }

  const lojas: CapturaLoja[] = Object.values(LOJAS)
    .map((l) => {
      const a = anterior.get(l);
      return { loja: l, ...fechar(porLoja.get(l) ?? vazia()), pctAnterior: a ? pct(a.c, a.v) : null };
    })
    .filter((l) => l.vendas > 0)
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));

  const total = lojas.reduce(
    (t, l) => ({ vendas: t.vendas + l.vendas, comCelular: t.comCelular + l.comCelular, cadastroSemCelular: t.cadastroSemCelular + l.cadastroSemCelular, semCadastro: t.semCadastro + l.semCadastro }),
    { vendas: 0, comCelular: 0, cadastroSemCelular: 0, semCadastro: 0 }
  );

  return {
    dias,
    desde,
    total: fechar({ ...total, pct: null }),
    lojas,
    ...(loja
      ? {
          loja,
          vendedoras: Array.from(porVendedora, ([nome, l]) => ({ nome, ...fechar(l) })).sort((a, b) => b.vendas - a.vendas),
          lista: lista.sort((a, b) => b.data.localeCompare(a.data)).slice(0, 300),
        }
      : {}),
  };
}
