import { NextRequest, NextResponse } from "next/server";
import { exigir } from "@/lib/financeiro/auth";
import { UNIDADES, alterarBase, copiaDeSeguranca, lerBase, novoId } from "@/lib/financeiro/base";
import { FORMAS, GRUPOS, type GrupoDre, type Papel } from "@/lib/financeiro/tipos";

export const dynamic = "force-dynamic";

/** Empresas, categorias e (para o admin) a configuração do backup. */
export async function GET(req: NextRequest) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const { base, usuario } = atual;
  const admin = usuario.papel === "admin";
  return NextResponse.json({
    empresas: base.empresas,
    categorias: base.categorias,
    unidades: UNIDADES,
    grupos: GRUPOS,
    formas: FORMAS,
    usuarios: [],
    backupDir: admin ? base.config.backupDir ?? "" : undefined,
  });
}

type Pedido =
  | { tipo: "empresa"; id?: string; nome: string; cnpj?: string; unidades: string[]; ativa?: boolean }
  | { tipo: "categoria"; id?: string; nome: string; grupo: GrupoDre; ativa?: boolean }
  | {
      tipo: "usuario";
      id?: string;
      nome: string;
      login: string;
      senha?: string;
      papel: Papel;
      veDre: boolean;
      ativo?: boolean;
    }
  | { tipo: "backup"; pasta: string }
  | { tipo: "excluir-empresa"; id: string };

/**
 * Cria ou altera um cadastro. Categorias, a equipe também cadastra; empresas,
 * usuários e backup, só o administrador.
 */
export async function POST(req: NextRequest) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const p = (await req.json().catch(() => ({}))) as Pedido;
  if (p.tipo !== "categoria" && atual.usuario.papel !== "admin")
    return NextResponse.json({ erro: "Só o administrador pode fazer isso." }, { status: 403 });

  try {
    const r = await alterarBase((base) => {
      if (p.tipo === "empresa") {
        if (!p.nome?.trim()) throw new Error("Dê um nome para a empresa.");
        if (base.empresas.some((e) => e.id !== p.id && e.nome.trim().toLowerCase() === p.nome.trim().toLowerCase()))
          throw new Error("Já existe uma empresa com esse nome.");
        const unidades = (p.unidades ?? []).filter((u) => UNIDADES.includes(u));
        // Uma loja não pode ser receita de duas empresas: sairia em dobro no DRE "todas"
        for (const e of base.empresas)
          if (e.id !== p.id) e.unidades = e.unidades.filter((u) => !unidades.includes(u));
        const e = base.empresas.find((x) => x.id === p.id);
        const dados = { nome: p.nome.trim(), cnpj: p.cnpj?.trim() || undefined, unidades, ativa: p.ativa ?? true };
        if (e) Object.assign(e, dados);
        else base.empresas.push({ id: novoId(), ...dados });
        return "ok";
      }
      if (p.tipo === "categoria") {
        if (!p.nome?.trim()) throw new Error("Dê um nome para a categoria.");
        if (!GRUPOS.some((g) => g.id === p.grupo)) throw new Error("Escolha o grupo do DRE.");
        const c = base.categorias.find((x) => x.id === p.id);
        const dados = { nome: p.nome.trim(), grupo: p.grupo, ativa: p.ativa ?? true };
        if (c) Object.assign(c, dados);
        else {
          if (base.categorias.some((x) => x.nome.trim().toLowerCase() === dados.nome.toLowerCase()))
            throw new Error("Já existe uma categoria com esse nome.");
          base.categorias.push({ id: novoId(), ...dados });
        }
        return `categoria:${c?.id ?? base.categorias[base.categorias.length - 1].id}`;
      }
      if (p.tipo === "usuario") {
        throw new Error("As pessoas agora são cadastradas em Configurações › Pessoas e acessos.");
      }
      if (p.tipo === "excluir-empresa") {
        const usadas = base.contas.filter((c) => c.empresaId === p.id).length;
        if (usadas) throw new Error(`Essa empresa tem ${usadas} conta(s) lançada(s). Desative em vez de excluir.`);
        base.empresas = base.empresas.filter((e) => e.id !== p.id);
        return "ok";
      }
      if (p.tipo === "backup") {
        base.config.backupDir = p.pasta?.trim() || undefined;
        return "backup";
      }
      throw new Error("Pedido desconhecido.");
    });
    if (r === "backup") {
      // Testa na hora: a resposta já diz se a pasta funciona
      const resultado = await copiaDeSeguranca(await lerBase(), true);
      return NextResponse.json({ ok: true, backup: resultado });
    }
    // Categoria nova devolve o id, para o lançamento já usar
    return NextResponse.json({ ok: true, id: r.startsWith("categoria:") ? r.slice(10) : undefined });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
