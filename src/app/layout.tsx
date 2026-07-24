import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NFL Explorer",
  description: "NFL statistics explorer — players, teams, comparisons, history (2015–2025)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-hairline">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-6 px-6 py-3">
            <a href="/" className="font-semibold tracking-tight">NFL Explorer</a>
            <a href="/compare" className="text-sm text-ink-secondary hover:text-foreground">Compare</a>
            <a href="/teams" className="text-sm text-ink-secondary hover:text-foreground">Teams</a>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
