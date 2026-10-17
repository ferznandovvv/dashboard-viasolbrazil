import type { Metadata } from "next";
import "./globals.css";
import "./padrao.css";
import { Moldura } from "@/components/Moldura";

export const metadata: Metadata = {
  title: { default: "Vendas · Via Sol", template: "%s · Via Sol" },
  description: "Painel da Via Sol: vendas, produtos, financeiro e CRM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Moldura>{children}</Moldura>
      </body>
    </html>
  );
}
