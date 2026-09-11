import type { Metadata } from "next";
import "./globals.css";
import "./pilotpaper-experience.css";

export const metadata: Metadata = {
  title: "PilotPaper",
  description:
    "Logiciel interne de préparation, de contrôle et de génération des dossiers photovoltaïques DP1 à DP8.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <head>
        <meta name="codex-preview" content="development" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
