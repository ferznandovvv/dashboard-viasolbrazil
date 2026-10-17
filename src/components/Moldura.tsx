"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icone, type NomeIcone } from "./Icone";

/** Login e telas de aparelho (TV, loja, caixa) ocupam a tela inteira, sem menu. */
const SEM_MOLDURA = ["/login", "/tv", "/loja", "/crm/loja"];

interface Item {
  href: string;
  nome: string;
  icone: NomeIcone;
}

const MODULOS: Item[] = [
  { href: "/", nome: "Vendas", icone: "vendas" },
  { href: "/produtos", nome: "Produtos", icone: "produtos" },
  { href: "/financeiro", nome: "Financeiro", icone: "financeiro" },
  { href: "/crm", nome: "CRM", icone: "crm" },
];

/** Abrem em outra aba: são telas cheias, feitas para o aparelho da loja. */
const TELAS: Item[] = [
  { href: "/loja", nome: "Tela da loja", icone: "loja" },
  { href: "/crm/loja", nome: "Caixa e cashback", icone: "cashback" },
  { href: "/tv", nome: "TV", icone: "tv" },
];

const CONFIG: Item = { href: "/configurar", nome: "Configurações", icone: "config" };

const ativo = (href: string, atual: string) => (href === "/" ? atual === "/" : atual === href || atual.startsWith(href + "/"));

async function sair() {
  // O financeiro tem sessão própria; sair do sistema sai dos dois
  await fetch("/api/financeiro/sessao", { method: "DELETE" }).catch(() => {});
  await fetch("/api/login", { method: "DELETE" }).catch(() => {});
  window.location.href = "/login";
}

function ItemMenu({ item, atual }: { item: Item; atual: string }) {
  const on = ativo(item.href, atual);
  return (
    <Link href={item.href} className={`menu-item${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
      <Icone nome={item.icone} />
      <span>{item.nome}</span>
    </Link>
  );
}

function Menu({ atual }: { atual: string }) {
  return (
    <>
      <nav className="menu-grupo" aria-label="Módulos">
        {MODULOS.map((i) => (
          <ItemMenu key={i.href} item={i} atual={atual} />
        ))}
      </nav>
      <div className="menu-grupo">
        <p className="menu-titulo" id="menu-telas">
          Telas das lojas
        </p>
        <ul aria-labelledby="menu-telas">
          {TELAS.map((i) => (
            <li key={i.href}>
              <a href={i.href} target="_blank" rel="noreferrer" className="menu-item">
                <Icone nome={i.icone} />
                <span>{i.nome}</span>
                <span className="menu-fora">
                  <Icone nome="fora" tamanho={14} />
                  <span className="so-leitor">(abre em outra aba)</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="menu-grupo menu-fim">
        <ItemMenu item={CONFIG} atual={atual} />
        <button type="button" className="menu-item" onClick={sair}>
          <Icone nome="sair" />
          <span>Sair</span>
        </button>
      </div>
    </>
  );
}

/**
 * A moldura de todas as telas do sistema: menu lateral no computador e, no
 * celular, barra embaixo com os módulos e o resto do menu numa gaveta.
 */
export function Moldura({ children }: { children: React.ReactNode }) {
  const atual = usePathname() ?? "/";
  const gaveta = useRef<HTMLDialogElement>(null);

  // Trocou de página: fecha a gaveta do celular
  useEffect(() => {
    gaveta.current?.close();
  }, [atual]);

  if (SEM_MOLDURA.some((p) => atual === p || atual.startsWith(p + "/"))) return <>{children}</>;

  return (
    <div className="moldura">
      <a href="#conteudo" className="pular">
        Pular para o conteúdo
      </a>
      <aside className="lateral">
        <Link href="/" className="lateral-logo" aria-label="Via Sol — início">
          <span className="brand-word" aria-hidden="true" />
        </Link>
        <Menu atual={atual} />
      </aside>

      <div className="topo-cel">
        <Link href="/" aria-label="Via Sol — início">
          <span className="brand-word" aria-hidden="true" />
        </Link>
      </div>

      <div className="conteudo" id="conteudo" tabIndex={-1}>
        {children}
      </div>

      <nav className="barra-baixo" aria-label="Módulos">
        {MODULOS.map((i) => (
          <ItemMenu key={i.href} item={i} atual={atual} />
        ))}
        <button type="button" className="menu-item" onClick={() => gaveta.current?.showModal()} aria-haspopup="dialog">
          <Icone nome="menu" />
          <span>Menu</span>
        </button>
      </nav>

      <dialog
        ref={gaveta}
        className="gaveta"
        aria-label="Menu"
        onClick={(e) => {
          // Toque fora do painel fecha
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="gaveta-painel">
          <div className="gaveta-cab">
            <span className="brand-word" role="img" aria-label="Via Sol" />
            <button type="button" className="btn btn-sec btn-sm" onClick={() => gaveta.current?.close()}>
              Fechar
            </button>
          </div>
          <Menu atual={atual} />
        </div>
      </dialog>
    </div>
  );
}

/** Título da página e, à direita, o que é daquela página (período, usuário…). */
export function Cabecalho({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <header className="cabecalho">
      <h1>{titulo}</h1>
      {children && <div className="cabecalho-acoes">{children}</div>}
    </header>
  );
}
