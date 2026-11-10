import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CookieBanner, Footer, SiteHeader, SkipLink } from "@/components/shell/shell";
import { Toaster } from "@/components/ui/toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["500"] });

export const metadata: Metadata = {
  // Absolute URLs for the link-preview image, from the site's public address.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:5320"),
  title: { default: "Cleanup: remove logos and text from your videos", template: "%s · Cleanup" },
  description: "Remove your own logos, burned-in captions and stray text from videos you own. Preview free in your browser.",
};

export const viewport: Viewport = { themeColor: "#f0eee9", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <SkipLink />
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">{children}</main>
        <Footer />
        <CookieBanner />
        <Toaster />
      </body>
    </html>
  );
}
