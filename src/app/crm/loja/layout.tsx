import type { Metadata } from "next";

export const metadata: Metadata = { title: { absolute: "Tela da loja · Via Sol" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
