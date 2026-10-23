"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContaPublica } from "@/lib/acesso/base";
import { PAPEIS, type Papel } from "@/lib/acesso/regras";

interface Dados {
  contas: ContaPublica[];
  lojas: string[];
  senhaAntiga: boolean;
  temSenhaAntiga: boolean;
  /** A senha antiga ainda entra como Dono (nenhum dono entrou com o usuário ainda) */
  antigaComoDono: boolean;
  entrouComSenhaAntiga: boolean;
  eu: string;
}

interface Form {
  id?: string;
  nome: string;
  login: string;
  senha: string;
  papel: Papel;
  lojas: string[];
  podeLancar: boolean;
  veDre: boolean;
  ativo: boolean;
}

/** Usuário curto de cada loja, igual às abreviações do resto do sistema */
const USUARIO_DA_LOJA: Record<string, string> = {
  Centro: "centro",
  Fiusa: "fiusa",
  "Loja de Fábrica": "fabrica",
  "Rio de Janeiro": "rj",
  "Ribeirão Preto": "rp",
  "SP — Itaim": "sp",
  "Belo Horizonte": "bh",
  "Praia Grande": "pg",
};
const usuarioDaLoja = (loja: string) =>
  USUARIO_DA_LOJA[loja] ?? loja.normalize("NFD").replace(/[^\w]/g, "").toLowerCase().slice(0, 20);

/** Senha fácil de digitar: sem 0/O nem 1/l, que se confundem */
function senhaNova(): string {
  const letras = "abcdefghjkmnpqrstuvwxyz23456789";
  const n = crypto.getRandomValues(new Uint32Array(8));
  return Array.from(n, (x) => letras[x % letras.length]).join("");
}

const ORDEM: Papel[] = ["dono", "socia", "gerente", "financeiro", "loja"];

async function chamar<T>(corpo?: object): Promise<T> {
  const r = await fetch("/api/acesso/contas", {
    method: corpo ? "POST" : "GET",
    headers: corpo ? { "Content-Type": "application/json" } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { erro?: string }).erro ?? `Erro ${r.status}`);
  return j as T;
}

/** Configurações › Pessoas e acessos: quem entra no sistema e o que cada um vê. */
export function Pessoas() {
  const [d, setD] = useState<Dados | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [trocando, setTrocando] = useState<{ id: string; nome: string; senha: string } | null>(null);
  const [criadas, setCriadas] = useState<{ loja: string; login: string; senha: string }[]>([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);
  const topo = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      setD(await chamar<Dados>());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  /** Roda uma ação, mostra o resultado e recarrega a lista */
  const fazer = async (acao: () => Promise<unknown>, ok: string) => {
    setErro("");
    setAviso("");
    setSalvando(true);
    try {
      await acao();
      setAviso(ok);
      await carregar();
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
      return false;
    } finally {
      setSalvando(false);
      topo.current?.scrollIntoView({ block: "nearest" });
    }
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || salvando) return;
    const { id, senha, ...resto } = form;
    const deu = await fazer(
      () => chamar(id ? { acao: "editar", id, ...resto } : { acao: "criar", senha, ...resto }),
      id ? `${form.nome}: alterações salvas.` : `${form.nome} pode entrar com o usuário “${form.login.trim().toLowerCase()}”.`
    );
    if (deu) setForm(null);
  };

  const trocarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trocando || salvando) return;
    const deu = await fazer(() => chamar({ acao: "senha", id: trocando.id, senha: trocando.senha }), `Senha de ${trocando.nome} trocada.`);
    if (deu) setTrocando(null);
  };

  /** Um usuário para cada loja que ainda não tem, com senha gerada na hora */
  const criarLojas = async () => {
    if (!d || salvando) return;
    const faltam = d.lojas.filter((l) => !d.contas.some((c) => c.papel === "loja" && c.lojas.includes(l)));
    const feitas: typeof criadas = [];
    await fazer(async () => {
      for (const loja of faltam) {
        let login = usuarioDaLoja(loja);
        if (d.contas.some((c) => c.login === login)) login = `loja.${login}`;
        const senha = senhaNova();
        await chamar({ acao: "criar", nome: `Loja ${loja}`, login, senha, papel: "loja", lojas: [loja] });
        feitas.push({ loja, login, senha });
      }
    }, faltam.length ? `${faltam.length} usuário(s) de loja criado(s).` : "Todas as lojas já têm usuário.");
    setCriadas(feitas);
  };

  if (!d) return erro ? <div className="card err-msg">{erro}</div> : <div className="empty">Carregando…</div>;

  const lojasSemUsuario = d.lojas.filter((l) => !d.contas.some((c) => c.papel === "loja" && c.ativo && c.lojas.includes(l)));
  const porPapel = ORDEM.map((p) => ({ p, contas: d.contas.filter((c) => c.papel === p) })).filter((x) => x.contas.length);

  return (
    <div className="pessoas">
      <div ref={topo} aria-live="polite">
        {erro && <div className="card err-msg">{erro}</div>}
        {aviso && <div className="parcial">{aviso}</div>}
      </div>

      {d.entrouComSenhaAntiga && (
        <section className="card pessoas-aviso">
          <h2>Você entrou com a senha antiga</h2>
          <p className="pessoas-ajuda">
            Ache o seu nome na lista abaixo: o usuário aparece embaixo dele. Se não lembrar a senha, clique em{" "}
            <b>Trocar senha</b>, escolha uma nova, clique em Sair e entre com o usuário e a senha nova.
          </p>
        </section>
      )}

      {criadas.length > 0 && (
        <section className="card pessoas-criadas">
          <h2>Anote os usuários das lojas</h2>
          <p className="pessoas-ajuda">As senhas aparecem só agora. Entre uma vez no computador de cada loja e deixe o navegador lembrar.</p>
          <div className="tbl-wrap">
            <table className="prod-tbl">
              <thead>
                <tr>
                  <th>Loja</th>
                  <th>Usuário</th>
                  <th>Senha</th>
                </tr>
              </thead>
              <tbody>
                {criadas.map((c) => (
                  <tr key={c.login}>
                    <td>{c.loja}</td>
                    <td className="mono">{c.login}</td>
                    <td className="mono">{c.senha}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-sec btn-sm" onClick={() => setCriadas([])}>
            Já anotei
          </button>
        </section>
      )}

      {!form && (
        <div className="pessoas-acoes">
          <button
            className="btn btn-pri"
            onClick={() => setForm({ nome: "", login: "", senha: "", papel: "socia", lojas: [], podeLancar: false, veDre: false, ativo: true })}
          >
            ＋ Nova pessoa
          </button>
          {lojasSemUsuario.length > 0 && (
            <button className="btn btn-sec" onClick={criarLojas} disabled={salvando}>
              Criar usuário para {lojasSemUsuario.length === d.lojas.length ? "cada loja" : `as ${lojasSemUsuario.length} lojas que faltam`}
            </button>
          )}
        </div>
      )}

      {form && (
        <form className="card pessoas-form" onSubmit={salvar}>
          <h2>{form.id ? `Editar ${form.nome}` : "Nova pessoa"}</h2>
          <div className="pessoas-campos">
            <div className="campo">
              <label htmlFor="p-nome">Nome</label>
              <input id="p-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required autoFocus />
            </div>
            <div className="campo">
              <label htmlFor="p-login">Usuário</label>
              <input
                id="p-login"
                value={form.login}
                onChange={(e) => setForm({ ...form, login: e.target.value.toLowerCase().replace(/\s/g, "") })}
                autoCapitalize="none"
                spellCheck={false}
                required
                aria-describedby="p-login-dica"
              />
              <span className="dica" id="p-login-dica">
                Letras minúsculas, sem espaço. Ex.: maria, centro
              </span>
            </div>
            {!form.id && (
              <div className="campo">
                <label htmlFor="p-senha">Senha</label>
                <input
                  id="p-senha"
                  value={form.senha}
                  onChange={(e) => setForm({ ...form, senha: e.target.value })}
                  minLength={6}
                  required
                  autoComplete="new-password"
                  aria-describedby="p-senha-dica"
                />
                <span className="dica" id="p-senha-dica">
                  Pelo menos 6 caracteres. Passe para a pessoa; ela pode pedir para você trocar depois.
                </span>
              </div>
            )}
          </div>

          <fieldset className="pessoas-papeis">
            <legend>Papel</legend>
            {ORDEM.map((p) => (
              <label key={p} className={`pessoas-papel${form.papel === p ? " on" : ""}`}>
                <input type="radio" name="papel" value={p} checked={form.papel === p} onChange={() => setForm({ ...form, papel: p })} />
                <span>
                  <b>{PAPEIS[p].nome}</b>
                  <small>{PAPEIS[p].explica}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {form.papel === "loja" && (
            <fieldset className="pessoas-lojas">
              <legend>Loja</legend>
              {d.lojas.map((l) => (
                <label key={l} className="pessoas-check">
                  <input
                    type="checkbox"
                    checked={form.lojas.includes(l)}
                    onChange={(e) => setForm({ ...form, lojas: e.target.checked ? [...form.lojas, l] : form.lojas.filter((x) => x !== l) })}
                  />
                  {l}
                </label>
              ))}
            </fieldset>
          )}
          {form.papel === "socia" && (
            <label className="pessoas-check">
              <input type="checkbox" checked={form.podeLancar} onChange={(e) => setForm({ ...form, podeLancar: e.target.checked })} />
              Também lança e paga contas no financeiro (sem marcar, só consulta)
            </label>
          )}
          {form.papel === "financeiro" && (
            <label className="pessoas-check">
              <input type="checkbox" checked={form.veDre} onChange={(e) => setForm({ ...form, veDre: e.target.checked })} />
              Vê o DRE
            </label>
          )}
          {form.id && (
            <label className="pessoas-check">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
              Acesso ligado (desmarque para a pessoa não entrar mais)
            </label>
          )}

          <div className="pessoas-acoes">
            <button type="submit" className="btn btn-pri" disabled={salvando}>
              {salvando ? "Salvando…" : form.id ? "Salvar alterações" : "Cadastrar"}
            </button>
            <button type="button" className="btn btn-sec" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {trocando && (
        <form className="card pessoas-form" onSubmit={trocarSenha}>
          <h2>Trocar a senha de {trocando.nome}</h2>
          <div className="campo">
            <label htmlFor="p-nova">Senha nova</label>
            <input
              id="p-nova"
              value={trocando.senha}
              onChange={(e) => setTrocando({ ...trocando, senha: e.target.value })}
              minLength={6}
              required
              autoFocus
              autoComplete="new-password"
            />
            <span className="dica">Quem estava conectado com a senha antiga precisa entrar de novo.</span>
          </div>
          <div className="pessoas-acoes">
            <button type="submit" className="btn btn-pri" disabled={salvando}>
              Trocar senha
            </button>
            <button type="button" className="btn btn-sec" onClick={() => setTrocando(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {porPapel.map(({ p, contas }) => (
        <section key={p} className="card pessoas-grupo" aria-labelledby={`grupo-${p}`}>
          <h2 id={`grupo-${p}`}>{PAPEIS[p].nome}</h2>
          <ul>
            {contas.map((c) => (
              <li key={c.id} className={c.ativo ? "" : "desligada"}>
                <div className="pessoas-quem">
                  <b>
                    {c.nome}
                    {c.id === d.eu && <span className="pessoas-voce"> (você)</span>}
                  </b>
                  <span>
                    usuário <span className="mono">{c.login}</span>
                    {c.papel === "loja" && ` · ${c.lojas.join(", ")}`}
                    {c.papel === "socia" && (c.podeLancar ? " · lança no financeiro" : " · só consulta o financeiro")}
                    {c.papel === "financeiro" && (c.veDre ? " · vê o DRE" : " · sem DRE")}
                    {!c.ativo && " · acesso desligado"}
                  </span>
                </div>
                <div className="pessoas-botoes">
                  <button
                    className="btn btn-sec btn-sm"
                    onClick={() => {
                      setTrocando(null);
                      setForm({ id: c.id, nome: c.nome, login: c.login, senha: "", papel: c.papel, lojas: c.lojas, podeLancar: c.podeLancar, veDre: c.veDre, ativo: c.ativo });
                    }}
                    aria-label={`Editar ${c.nome}`}
                  >
                    Editar
                  </button>
                  <button
                    className="btn btn-sec btn-sm"
                    onClick={() => {
                      setForm(null);
                      setTrocando({ id: c.id, nome: c.nome, senha: "" });
                    }}
                    aria-label={`Trocar a senha de ${c.nome}`}
                  >
                    Trocar senha
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {d.temSenhaAntiga && (
        <section className="card pessoas-grupo">
          <h2>Senha antiga do painel</h2>
          <p className="pessoas-ajuda">
            {!d.senhaAntiga
              ? "Desligada: só entra quem tem usuário."
              : d.antigaComoDono
                ? "Ainda funciona e, até você entrar uma vez com o seu usuário, entra como Dono. Depois disso, quem entrar com ela (deixando o usuário em branco) vê o sistema como Sócia."
                : "Ainda funciona: quem entra com ela (deixando o usuário em branco) vê o sistema como Sócia. Desligue quando todo mundo tiver o próprio usuário."}
          </p>
          <button
            className={`btn btn-sm ${d.senhaAntiga ? "btn-perigo" : "btn-sec"}`}
            disabled={salvando}
            onClick={() =>
              fazer(() => chamar({ acao: "senha-antiga", ligada: !d.senhaAntiga }), d.senhaAntiga ? "Senha antiga desligada." : "Senha antiga ligada de novo.")
            }
          >
            {d.senhaAntiga ? "Desligar a senha antiga" : "Ligar a senha antiga de novo"}
          </button>
        </section>
      )}
    </div>
  );
}
