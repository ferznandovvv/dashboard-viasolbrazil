/**
 * Importação por CSV (exportado do TOTVS ou de qualquer planilha), com o
 * mapeamento de colunas escolhido na tela. Serve de plano B quando a API não
 * traz algum dado e para carregar base antiga.
 */

import { novoId } from "./base";
import { registrarVenda, salvarCliente } from "./clientes";
import type { BaseCrm, Venda } from "./tipos";
import { normalizarData } from "./telefone";

/** Lê CSV com ; ou , (detecta), aspas e BOM. Devolve linhas como arrays. */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/)[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      if (linha.some((c) => c.trim())) linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((c) => c.trim())) linhas.push(linha);
  return linhas;
}

export type CampoCliente = "nome" | "telefone" | "cpf" | "email" | "nascimento" | "loja" | "codigoTotvs" | "ignorar";
export type CampoVenda = "data" | "valor" | "loja" | "nomeCliente" | "telefoneCliente" | "cpfCliente" | "codigoTotvs" | "idVenda" | "pecas" | "ignorar";

/** Palpite de mapeamento a partir do nome da coluna. */
export function adivinharCliente(cab: string): CampoCliente {
  const c = cab.toLowerCase();
  if (/nome|name|cliente|razao/.test(c) && !/vend|loja/.test(c)) return "nome";
  if (/cel|fone|tel|whats|phone|mobile/.test(c)) return "telefone";
  if (/cpf|doc/.test(c)) return "cpf";
  if (/mail/.test(c)) return "email";
  if (/nasc|anivers|birth/.test(c)) return "nascimento";
  if (/loja|filial|unidade|branch/.test(c)) return "loja";
  if (/cod|code|id/.test(c)) return "codigoTotvs";
  return "ignorar";
}

export function adivinharVenda(cab: string): CampoVenda {
  const c = cab.toLowerCase();
  if (/data|date|emiss/.test(c)) return "data";
  if (/total|valor|value|liquido/.test(c)) return "valor";
  if (/loja|filial|unidade|branch/.test(c)) return "loja";
  if (/cpf/.test(c)) return "cpfCliente";
  if (/cel|fone|tel|whats/.test(c)) return "telefoneCliente";
  if (/nome|cliente|name/.test(c) && !/vend/.test(c)) return "nomeCliente";
  if (/cod.*cli|cli.*cod|personcode/.test(c)) return "codigoTotvs";
  if (/pec|qtd|quant/.test(c)) return "pecas";
  if (/nota|nf|pedido|seq|numero|id/.test(c)) return "idVenda";
  return "ignorar";
}

const lerValor = (s: string) => {
  const t = s.trim().replace(/[R$\s]/g, "");
  if (!t) return 0;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0;
};

export interface ResultadoImportacao {
  linhas: number;
  criados: number;
  atualizados: number;
  vendas: number;
  ignorados: number;
  avisos: string[];
}

export function importarClientes(base: BaseCrm, linhas: string[][], mapa: CampoCliente[], lojaPadrao?: string, optIn = true): ResultadoImportacao {
  const r: ResultadoImportacao = { linhas: 0, criados: 0, atualizados: 0, vendas: 0, ignorados: 0, avisos: [] };
  const idx = (campo: CampoCliente) => mapa.indexOf(campo);
  for (const l of linhas) {
    r.linhas++;
    const pega = (campo: CampoCliente) => (idx(campo) >= 0 ? (l[idx(campo)] ?? "").trim() : "");
    const nome = pega("nome");
    if (!nome) {
      r.ignorados++;
      continue;
    }
    try {
      const { nova } = salvarCliente(
        base,
        {
          nome,
          telefone: pega("telefone") || undefined,
          cpf: pega("cpf") || undefined,
          email: pega("email") || undefined,
          nascimento: pega("nascimento") || undefined,
          lojaOrigem: pega("loja") || lojaPadrao,
          codigoTotvs: pega("codigoTotvs") || undefined,
          optIn,
        },
        "csv"
      );
      if (nova) r.criados++;
      else r.atualizados++;
    } catch (e) {
      r.ignorados++;
      if (r.avisos.length < 10) r.avisos.push(`Linha ${r.linhas}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return r;
}

export function importarVendas(base: BaseCrm, linhas: string[][], mapa: CampoVenda[], lojaPadrao?: string, creditar = false): ResultadoImportacao {
  const r: ResultadoImportacao = { linhas: 0, criados: 0, atualizados: 0, vendas: 0, ignorados: 0, avisos: [] };
  const idx = (campo: CampoVenda) => mapa.indexOf(campo);
  const pctAntes = base.config.cashbackPct;
  if (!creditar) base.config.cashbackPct = 0;
  try {
    for (const l of linhas) {
      r.linhas++;
      const pega = (campo: CampoVenda) => (idx(campo) >= 0 ? (l[idx(campo)] ?? "").trim() : "");
      const data = normalizarData(pega("data"));
      const valor = lerValor(pega("valor"));
      if (!data || valor <= 0) {
        r.ignorados++;
        continue;
      }
      const loja = pega("loja") || lojaPadrao || "Loja";
      const nome = pega("nomeCliente");
      const telefone = pega("telefoneCliente");
      const cpf = pega("cpfCliente");
      const codigo = pega("codigoTotvs");
      let clienteId: string | undefined;
      if (nome && (telefone || cpf || codigo)) {
        const { cliente, nova } = salvarCliente(base, { nome, telefone, cpf, codigoTotvs: codigo, lojaOrigem: loja }, "csv");
        clienteId = cliente.id;
        if (nova) r.criados++;
        else r.atualizados++;
      }
      const venda: Venda = {
        id: `csv-${pega("idVenda") || `${data}-${loja}-${valor}-${r.linhas}`}`.replace(/\s+/g, "_"),
        clienteId,
        nomeNaNota: nome || undefined,
        cpfNaNota: cpf.replace(/\D/g, "") || undefined,
        codigoClienteTotvs: codigo || undefined,
        loja,
        data: `${data}T12:00:00-03:00`,
        valor,
        pecas: Number(pega("pecas")) || undefined,
        origem: "csv",
      };
      if (registrarVenda(base, venda)) r.vendas++;
    }
  } finally {
    base.config.cashbackPct = pctAntes;
  }
  return r;
}

export const idImportacao = () => `imp-${novoId()}`;
