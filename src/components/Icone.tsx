/** Ícones de traço do menu. Desenho simples, cor do texto ao redor. */
const DESENHOS = {
  vendas: (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 16v-4" />
      <path d="M12 16V8" />
      <path d="M16 16v-6" />
    </>
  ),
  produtos: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </>
  ),
  financeiro: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M15.5 14.5h2.5" />
    </>
  ),
  atendimento: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9.5h8" />
      <path d="M8 12.5h5" />
    </>
  ),
  crm: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18.5 14.8c1.6.8 2.6 2.6 3 5.2" />
    </>
  ),
  loja: (
    <>
      <path d="M3 9 4.5 4h15L21 9" />
      <path d="M4 9v11h16V9" />
      <path d="M3 9h18" />
      <path d="M9.5 20v-6h5v6" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>
  ),
  config: (
    <>
      <path d="M4 6h9" />
      <path d="M17 6h3" />
      <circle cx="15" cy="6" r="2" />
      <path d="M4 12h3" />
      <path d="M11 12h9" />
      <circle cx="9" cy="12" r="2" />
      <path d="M4 18h11" />
      <path d="M19 18h1" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  sair: (
    <>
      <path d="M9 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
      <path d="m16 16 4-4-4-4" />
      <path d="M20 12H9" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
  fora: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
};

export type NomeIcone = keyof typeof DESENHOS;

export function Icone({ nome, tamanho = 20 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {DESENHOS[nome]}
    </svg>
  );
}
