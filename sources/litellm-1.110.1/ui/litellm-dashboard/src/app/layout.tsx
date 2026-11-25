import type { Metadata } from "next";
import "./globals.css";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "next-themes";

import { AuthProvider } from "@/contexts/AuthContext";
import ReactQueryProvider from "@/contexts/ReactQueryProvider";
import HotkeysProvider from "@/contexts/HotkeysProvider";
import { TerminologyProvider } from "@/contexts/TerminologyContext";
import { Toaster } from "@/components/ui/sonner";
import I18nProvider from "@/i18n/I18nProvider";


export const metadata: Metadata = {
  title: "AI大模型智能网关平台",
  description: "内网模型统一接入、路由与运行监控",
  icons: { icon: "/ui/realai-symbol.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // next-themes stamps the theme class on <html> before paint, which the exported markup
    // cannot predict; suppressHydrationWarning confines that mismatch to this element.
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="realai-body">
        <I18nProvider>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
            <NuqsAdapter>
              <ReactQueryProvider>
                <TerminologyProvider>
                  <HotkeysProvider>
                    <AuthProvider>{children}</AuthProvider>
                  </HotkeysProvider>
                </TerminologyProvider>
                <Toaster />
              </ReactQueryProvider>
            </NuqsAdapter>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
