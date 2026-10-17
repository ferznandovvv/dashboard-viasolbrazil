"use client";

import { useRef, useState } from "react";
import type { Categoria, Empresa, GrupoDre } from "@/lib/financeiro/tipos";
import { type Cadastros as Dados, api } from "./comum";

type Secao = "empresas" | "categorias" | "usuarios" | "backup";

/** Cadastros do financeiro — só o administrador vê esta aba. */
export function Cadastros({ cad, admin, aoMudar }: { cad: Dados; admin: boolean; aoMudar: () => Promise<void> }) {
  // A equipe só cadastra categorias; o resto é do administrador
  const [secao, setSecao] = useState<Secao>(admin ? "empresas" : "categorias");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const salvando = useRef(false);

  const salvar = async (corpo: object, msg = "Salvo.") => {
    // Duplo clique no salvar criava o mesmo cadastro duas vezes
    if (salvando.current) return false;
    salvando.current = true;
    setErro("");
    setAviso("");
    try {
      const r = await api<{ backup?: string }>("/api/financeiro/cadastros", {
        method: "POST",
        body: JSON.stringify(corpo),
      });
      await aoMudar();
      setAviso(r.backup ? `Pasta salva. Teste de cópia: ${r.backup}` : msg);
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
      return false;
    } finally {
      salvando.current = false;
    }
  };

  return (
    <div>
      {admin && (
        <div className="seg" role="group" style={{ marginBottom: 14 }}>
        {(
          [
            ["empresas", "Empresas"],
            ["categorias", "Categorias"],
            ["usuarios", "Usuários"],
            ["backup", "Backup"],
          ] as [Secao, string][]
        ).map(([s, nome]) => (
          <button key={s} className={secao === s ? "on" : ""} onClick={() => setSecao(s)}>
            {nome}
          </button>
        ))}
        </div>
      )}
      {erro && <div className="card err-msg">{erro}</div>}
      {aviso && <div className="parcial">{aviso}</div>}

      {admin && secao === "empresas" && <Empresas cad={cad} salvar={salvar} />}
      {secao === "categorias" && <Categorias cad={cad} salvar={salvar} />}
      {admin && secao === "usuarios" && <Usuarios />}
      {admin && secao === "backup" && <Backup cad={cad} salvar={salvar} />}
    </div>
  );
}

type Salvar = (corpo: object, msg?: string) => Promise<boolean>;

function Empresas({ cad, salvar }: { cad: Dados; salvar: Salvar }) {
  const [edit, setEdit] = useState<Partial<Empresa> | null>(null);
  const dono = (u: string) => cad.empresas.find((e) => e.unidades.includes(u) && e.id !== edit?.id)?.nome;

  return (
    <div className="card">
      <div className="goal-head fin-cab">
        <h2>Empresas</h2>
        <button className="mini" onClick={() => setEdit({ nome: "", cnpj: "", unidades: [], ativa: true })}>
          + Nova empresa
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
        Marque as lojas e canais de cada empresa: a venda deles é a receita dela no DRE. Cada loja só pode ser de uma
        empresa.
      </p>
      {cad.empresas.map((e) =>
        edit?.id === e.id ? null : (
          <div key={e.id} className="fin-item">
            <div>
              <b>{e.nome}</b>
              {e.cnpj && <span className="fin-sub"> · {e.cnpj}</span>}
              {!e.ativa && <span className="fin-status"> inativa</span>}
              <div className="fin-sub">{e.unidades.length ? e.unidades.join(", ") : "nenhuma loja ligada"}</div>
            </div>
            <button className="link" onClick={() => setEdit({ ...e })}>
              editar
            </button>
          </div>
        )
      )}
      {edit && (
        <div className="fin-edit">
          <div className="fin-grid">
            <label className="config-campo">
              <span>Nome</span>
              <input value={edit.nome ?? ""} onChange={(ev) => setEdit({ ...edit, nome: ev.target.value })} autoFocus />
            </label>
            <label className="config-campo">
              <span>CNPJ (opcional)</span>
              <input value={edit.cnpj ?? ""} onChange={(ev) => setEdit({ ...edit, cnpj: ev.target.value })} />
            </label>
          </div>
          <div className="fin-sub" style={{ marginBottom: 6 }}>
            Lojas e canais desta empresa:
          </div>
          <div className="filters" style={{ marginBottom: 10 }}>
            {cad.unidades.map((u) => {
              const marcada = edit.unidades?.includes(u);
              const outra = dono(u);
              return (
                <button
                  key={u}
                  type="button"
                  className={marcada ? "active" : ""}
                  title={outra && !marcada ? `Hoje é da ${outra} — marcar aqui tira de lá` : undefined}
                  onClick={() =>
                    setEdit({
                      ...edit,
                      unidades: marcada ? edit.unidades!.filter((x) => x !== u) : [...(edit.unidades ?? []), u],
                    })
                  }
                >
                  {u}
                  {outra && !marcada ? " ·" : ""}
                </button>
              );
            })}
          </div>
          <label className="fin-check">
            <input type="checkbox" checked={edit.ativa ?? true} onChange={(ev) => setEdit({ ...edit, ativa: ev.target.checked })} />
            Ativa
          </label>
          <div className="config-acoes">
            <button
              className="buscar"
              style={{ width: "auto" }}
              onClick={async () => (await salvar({ tipo: "empresa", ...edit })) && setEdit(null)}
            >
              Salvar empresa
            </button>
            <button className="exportar" onClick={() => setEdit(null)}>
              Cancelar
            </button>
            {edit.id && (
              <button
                className="link fin-excluir"
                onClick={async () =>
                  confirm(`Excluir a empresa "${edit.nome}"? Só dá se ela não tiver nenhuma conta lançada.`) &&
                  (await salvar({ tipo: "excluir-empresa", id: edit.id }, "Empresa excluída.")) &&
                  setEdit(null)
                }
              >
                excluir empresa
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Categorias({ cad, salvar }: { cad: Dados; salvar: Salvar }) {
  const [edit, setEdit] = useState<Partial<Categoria> | null>(null);
  return (
    <div className="card">
      <div className="goal-head fin-cab">
        <h2>Categorias (plano de contas)</h2>
        <button className="mini" onClick={() => setEdit({ nome: "", grupo: "administrativas", ativa: true })}>
          + Nova categoria
        </button>
      </div>
      {edit && (
        <div className="fin-edit">
          <div className="fin-grid">
            <label className="config-campo">
              <span>Nome</span>
              <input value={edit.nome ?? ""} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} autoFocus />
            </label>
            <label className="config-campo">
              <span>Grupo do DRE</span>
              <select value={edit.grupo} onChange={(e) => setEdit({ ...edit, grupo: e.target.value as GrupoDre })}>
                {cad.grupos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="fin-check">
            <input type="checkbox" checked={edit.ativa ?? true} onChange={(e) => setEdit({ ...edit, ativa: e.target.checked })} />
            Ativa (inativa some da lista ao lançar, mas continua no DRE)
          </label>
          <div className="config-acoes">
            <button
              className="buscar"
              style={{ width: "auto" }}
              onClick={async () => (await salvar({ tipo: "categoria", ...edit })) && setEdit(null)}
            >
              Salvar categoria
            </button>
            <button className="exportar" onClick={() => setEdit(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {cad.grupos.map((g) => {
        const cats = cad.categorias.filter((c) => c.grupo === g.id);
        return (
          <div key={g.id} className="fin-grupo">
            <div className="fin-grupo-nome">
              {g.nome} <span className="fin-sub">— {g.dica}</span>
            </div>
            {cats.map((c) => (
              <span key={c.id} className={`fin-chip${c.ativa ? "" : " inativa"}`} onClick={() => setEdit({ ...c })}>
                {c.nome}
              </span>
            ))}
            {cats.length === 0 && <span className="fin-sub">nenhuma</span>}
          </div>
        );
      })}
      <p className="fin-sub" style={{ marginTop: 10 }}>
        Clique numa categoria para renomear, mudar de grupo ou desativar.
      </p>
    </div>
  );
}

function Usuarios() {
  return (
    <div className="card">
      <h2>Usuários</h2>
      <p className="fin-sub" style={{ margin: "8px 0 14px" }}>
        As pessoas agora entram no sistema todo com o mesmo usuário e são cadastradas num lugar só. Quem já tinha
        usuário aqui continua com a mesma senha.
      </p>
      <a className="btn btn-sec btn-sm" href="/configurar?aba=pessoas">
        Abrir Pessoas e acessos
      </a>
    </div>
  );
}

function Backup({ cad, salvar }: { cad: Dados; salvar: Salvar }) {
  const [pasta, setPasta] = useState(cad.backupDir ?? "");
  return (
    <div className="card">
      <h2>Cópia de segurança</h2>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
        Os lançamentos ficam no seu PC. Indique uma pasta do <b>Google Drive</b> ou <b>OneDrive</b> sincronizada no
        computador: o sistema copia o financeiro para lá a cada alteração (uma cópia por dia, guardando os últimos 60
        dias). Se o PC der problema, nada se perde.
      </p>
      <label className="config-campo">
        <span>Pasta</span>
        <input value={pasta} onChange={(e) => setPasta(e.target.value)} placeholder="ex.: G:\Meu Drive\Via Sol\backup-financeiro" />
        <small>
          No Explorador de Arquivos, abra a pasta do Drive, clique na barra de endereço, copie o caminho e cole aqui.
        </small>
      </label>
      <button className="buscar" style={{ width: "auto" }} onClick={() => salvar({ tipo: "backup", pasta })}>
        Salvar e testar
      </button>
    </div>
  );
}
