import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tôi gì, bạn đó!",
    short_name: "TGBĐ",
    description: "Đặt món từ bếp cá nhân",
    start_url: "/",
    id: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafbf8",
    theme_color: "#206b50",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
