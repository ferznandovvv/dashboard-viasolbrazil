import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Via Sol Brazil — Vendas Online",
  description: "Dashboard unificado de vendas: Shopify, TikTok Shop e Mercado Livre",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
