import type { MetadataRoute } from "next";

/** Manifest pro Android a PWA: ikony značky (`scripts/generate-icons.mjs`). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Se vezmou",
    short_name: "Se vezmou",
    description: "Svatební web česky i anglicky",
    start_url: "/",
    display: "browser",
    background_color: "#f7f4ed",
    theme_color: "#f7f4ed",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
