import type { Metadata } from "next";
import { Outfit, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "../packages/graph-engine/styles/graph.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Cortex Graph Engine",
  description:
    "Portable 3D knowledge graph workspace with PostgreSQL/PGlite hybrid FTS + vector search and Gemini AI knowledge linking.",
  openGraph: {
    title: "Cortex Graph Engine",
    description:
      "Portable 3D knowledge graph workspace with PostgreSQL/PGlite hybrid FTS + vector search and Gemini AI knowledge linking.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cortex Graph Engine",
    description:
      "Portable 3D knowledge graph workspace with PostgreSQL/PGlite hybrid FTS + vector search and Gemini AI knowledge linking.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${plusJakarta.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="bg-[#050814] text-slate-100 antialiased selection:bg-sky-500/30 selection:text-sky-100"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
