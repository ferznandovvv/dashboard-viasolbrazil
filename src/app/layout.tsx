import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import "./padrao.css";
import { Moldura } from "@/components/Moldura";
import { COOKIE_SESSAO, lerSessao } from "@/lib/acesso/sessao";

export const metadata: Metadata = {
  title: { default: "Vendas · Via Sol", template: "%s · Via Sol" },
  description: "Painel da Via Sol: vendas, produtos, financeiro e CRM",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Quem entrou decide o que aparece no menu
  const sessao = await lerSessao((await cookies()).get(COOKIE_SESSAO)?.value).catch(() => null);
  return (
    <html lang="pt-BR">
      <body>
        <Moldura sessao={sessao}>{children}</Moldura>
      </body>
    </html>
  );
}
