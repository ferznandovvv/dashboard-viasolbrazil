"use client";

import { useEffect, useState } from "react";

interface Dados {
  codigo: string;
  lojas: string[];
  podeTrocar: boolean;
}

/**
 * Configurações › TV e telas da loja: os links prontos para abrir no aparelho
 * (sem login, com o código no endereço) e o botão para trocar o código.
 */
export function Aparelhos() {
  const [d, setD] = useState<Dados | null>(null);
  const [copiado, setCopiado] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch("/api/acesso/aparelhos", { cache: "no-store" })
      .then((r) => r.json())
      .then(setD)
      .catch(() => setErro("Não consegui carregar. Recarregue a página."));
  }, []);

  if (!d) return <div className="empty">{erro || "Carregando…"}</div>;

  const base = typeof window === "undefined" ? "" : window.location.origin;
  const k = encodeURIComponent(d.codigo);
  const links = [
    { nome: "TV (vendas do dia)", url: `${base}/tv?k=${k}` },
    ...d.lojas.map((l) => ({ nome: `Tela da loja ${l}`, url: `${base}/crm/loja?loja=${encodeURIComponent(l)}&k=${k}` })),
  ];

  const copiar = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(url);
      setTimeout(() => setCopiado(""), 2000);
    } catch {
      setErro("Não deu para copiar. Selecione o link e copie à mão.");
    }
  };

  const trocar = async () => {
    setErro("");
    const r = await fetch("/api/acesso/aparelhos", { method: "POST" }).catch(() => null);
    const j = (await r?.json().catch(() => ({}))) as { codigo?: string; erro?: string };
    if (r?.ok && j.codigo) setD({ ...d, codigo: j.codigo });
    else setErro(j?.erro ?? "Não deu para trocar o código.");
    setConfirmando(false);
  };

  return (
    <div className="pessoas">
      {erro && <div className="card err-msg">{erro}</div>}
      <section className="card">
        <h2>Links para os aparelhos</h2>
        <p className="pessoas-ajuda">
          Abra o link no navegador da TV ou do tablet da loja e deixe a tela aberta: ela atualiza sozinha e não pede
          senha. No computador da loja, prefira o usuário da loja (em Pessoas e acessos).
        </p>
        {!d.codigo ? (
          <p className="pessoas-ajuda">
            Ainda não existe código. {d.podeTrocar ? "Crie um no botão abaixo." : "Defina TV_CODE nas variáveis de ambiente."}
          </p>
        ) : (
          <ul className="aparelhos-lista">
            {links.map((l) => (
              <li key={l.url}>
                <span className="aparelhos-nome">{l.nome}</span>
                <code className="aparelhos-url">{l.url}</code>
                <button type="button" className="btn btn-sec btn-sm" onClick={() => copiar(l.url)} aria-label={`Copiar o link: ${l.nome}`}>
                  {copiado === l.url ? "Copiado" : "Copiar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.podeTrocar && (
        <section className="card">
          <h2>Código dos aparelhos</h2>
          <p className="pessoas-ajuda">
            Quem tem um destes links vê o faturamento da loja. Se um link foi parar onde não devia, troque o código:
            todos os links acima mudam e os aparelhos precisam abrir o link novo.
          </p>
          {confirmando ? (
            <div className="pessoas-acoes">
              <button type="button" className="btn btn-perigo btn-sm" onClick={trocar}>
                Sim, trocar o código
              </button>
              <button type="button" className="btn btn-sec btn-sm" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-sec btn-sm" onClick={() => setConfirmando(true)}>
              {d.codigo ? "Trocar o código" : "Criar código"}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
