"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { Sessao } from "@/lib/acesso/sessao";
import { type Area, PAPEIS, inicio, temArea } from "@/lib/acesso/regras";
import { Icone, type NomeIcone } from "./Icone";
import { ProvedorSessao } from "./sessao";

/**
 * Login e TV ocupam a tela inteira. A tela da loja também, quando o aparelho
 * abre pelo código da TV (sem sessão); para quem entrou, tem menu.
 */
const TELA_CHEIA = ["/login", "/tv"];

interface Item {
  href: string;
  nome: string;
  icone: NomeIcone;
  area: Area;
  /** Abre em outra aba (a TV fica numa tela à parte) */
  fora?: boolean;
}

const MODULOS: Item[] = [
  { href: "/", nome: "Vendas", icone: "vendas", area: "vendas" },
  { href: "/produtos", nome: "Produtos", icone: "produtos", area: "estoque" },
  { href: "/financeiro", nome: "Financeiro", icone: "financeiro", area: "financeiro" },
  { href: "/atendimento", nome: "Atendimento", icone: "atendimento", area: "crm" },
  { href: "/crm", nome: "CRM", icone: "crm", area: "crm" },
];

const LOJAS: Item[] = [
  { href: "/crm/loja", nome: "Tela da loja", icone: "loja", area: "loja" },
  { href: "/tv", nome: "TV", icone: "tv", area: "tv", fora: true },
];

const CONFIG: Item = { href: "/configurar", nome: "Configurações", icone: "config", area: "config" };

const em = (href: string, atual: string) => (href === "/" ? atual === "/" : atual === href || atual.startsWith(href + "/"));

async function sair() {
  await fetch("/api/login", { method: "DELETE" }).catch(() => {});
  window.location.href = "/login";
}

function ItemMenu({ item, atual }: { item: Item; atual: string }) {
  if (item.fora)
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className="menu-item">
        <Icone nome={item.icone} />
        <span>{item.nome}</span>
        <span className="menu-fora">
          <Icone nome="fora" tamanho={14} />
          <span className="so-leitor">(abre em outra aba)</span>
        </span>
      </a>
    );
  // O caixa fica dentro de /crm: o item CRM não acende quando o caixa está aberto
  const on = em(item.href, atual) && !(item.href === "/crm" && em("/crm/loja", atual));
  return (
    <Link href={item.href} className={`menu-item${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
      <Icone nome={item.icone} />
      <span>{item.nome}</span>
    </Link>
  );
}

function Menu({ atual, sessao }: { atual: string; sessao: Sessao }) {
  const pode = (i: Item) => temArea(sessao.papel, i.area);
  const modulos = MODULOS.filter(pode);
  const lojas = LOJAS.filter(pode);
  const titulo = sessao.papel === "loja" ? sessao.lojas.join(" · ") || "Loja" : "Telas das lojas";
  return (
    <>
      {modulos.length > 0 && (
        <nav className="menu-grupo" aria-label="Módulos">
          {modulos.map((i) => (
            <ItemMenu key={i.href} item={i} atual={atual} />
          ))}
        </nav>
      )}
      {lojas.length > 0 && (
        <nav className="menu-grupo" aria-labelledby="menu-lojas">
          <p className="menu-titulo" id="menu-lojas">
            {titulo}
          </p>
          {lojas.map((i) => (
            <ItemMenu key={i.href} item={i} atual={atual} />
          ))}
        </nav>
      )}
      <div className="menu-grupo menu-fim">
        {pode(CONFIG) && <ItemMenu item={CONFIG} atual={atual} />}
        <p className="menu-quem">
          <b>{sessao.nome}</b>
          <span>{PAPEIS[sessao.papel].nome}</span>
        </p>
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
 * celular, barra embaixo com os módulos e o resto do menu numa gaveta. O menu
 * só mostra o que o papel de quem entrou pode abrir.
 */
export function Moldura({ sessao, children }: { sessao: Sessao | null; children: React.ReactNode }) {
  const atual = usePathname() ?? "/";
  const gaveta = useRef<HTMLDialogElement>(null);

  // Trocou de página: fecha a gaveta do celular
  useEffect(() => {
    gaveta.current?.close();
  }, [atual]);

  const naLista = (l: string[]) => l.some((p) => atual === p || atual.startsWith(p + "/"));
  if (!sessao || naLista(TELA_CHEIA))
    return <ProvedorSessao value={sessao}>{children}</ProvedorSessao>;

  // Barra do celular: os primeiros itens que o papel usa, mais o botão Menu
  const barra = [...MODULOS, ...LOJAS].filter((i) => !i.fora && temArea(sessao.papel, i.area)).slice(0, 4);

  return (
    <ProvedorSessao value={sessao}>
      <div className="moldura">
        <a href="#conteudo" className="pular">
          Pular para o conteúdo
        </a>
        <aside className="lateral">
          <Link href={inicio(sessao.papel)} className="lateral-logo" aria-label="Via Sol — início">
            <span className="brand-word" aria-hidden="true" />
          </Link>
          <Menu atual={atual} sessao={sessao} />
        </aside>

        <div className="topo-cel">
          <Link href={inicio(sessao.papel)} aria-label="Via Sol — início">
            <span className="brand-word" aria-hidden="true" />
          </Link>
        </div>

        <div className="conteudo" id="conteudo" tabIndex={-1}>
          {children}
        </div>

        <nav className="barra-baixo" aria-label="Atalhos">
          {barra.map((i) => (
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
            <Menu atual={atual} sessao={sessao} />
          </div>
        </dialog>
      </div>
    </ProvedorSessao>
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
