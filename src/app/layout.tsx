import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import BrandColorsProvider from "@/components/brand-colors-provider";
import { ConfigProvider } from "@/lib/config-context";
import { AuthProvider } from "@/lib/auth-context";
import { NavOrderProvider } from "@/lib/nav-order-context";
import { SidebarCollapseProvider } from "@/lib/sidebar-collapse-context";
import AppShell from "@/components/app-shell";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Nookleus",
    template: "%s · Nookleus",
  },
  description: "Operations platform for service businesses.",
  icons: {
    icon: [
      { url: "/nookleus-icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/nookleus-icon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/nookleus-icon-192.png",
  },
  manifest: "/manifest.webmanifest",
};

// viewport-fit=cover lets the layout viewport extend edge-to-edge on iOS so
// `position: fixed; top: 0` anchors to the screen top (covering the notch /
// status-bar strip) and `env(safe-area-inset-*)` resolves to real values that
// the mobile header and main padding already use.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthProvider>
            <ConfigProvider>
              <NavOrderProvider>
                <SidebarCollapseProvider>
                  <BrandColorsProvider />
                  <AppShell>{children}</AppShell>
                  <Toaster />
                </SidebarCollapseProvider>
              </NavOrderProvider>
            </ConfigProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
