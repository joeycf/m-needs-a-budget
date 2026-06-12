import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "M Needs a Budget",
  description: "Personal zero-based budgeting, YNAB-style.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Dark theme is the only theme (CLAUDE.md rule 9): data-theme="dark"
  // flips the design tokens, .dark covers shadcn + Tailwind dark: variants.
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
