import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Tôi gì, bạn đó!", template: "%s · Tôi gì, bạn đó!" },
  description: "Đặt món từ các bếp cá nhân trong khu vực của bạn.",
  applicationName: "Tôi gì, bạn đó!",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tôi gì, bạn đó!",
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#206b50",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" data-scroll-behavior="smooth">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
