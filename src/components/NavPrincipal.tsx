import Link from "next/link";

const ITENS = [
  { href: "/", nome: "Vendas" },
  { href: "/produtos", nome: "Produtos" },
  { href: "/financeiro", nome: "Financeiro" },
];

/** Os três módulos do sistema, no topo de cada tela. */
export function NavPrincipal({ atual }: { atual: "/" | "/produtos" | "/financeiro" }) {
  return (
    <nav className="nav-principal" aria-label="Módulos">
      {ITENS.map((i) => (
        <Link key={i.href} href={i.href} className={i.href === atual ? "on" : ""} aria-current={i.href === atual ? "page" : undefined}>
          {i.nome}
        </Link>
      ))}
    </nav>
  );
}
