import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GameVerse Mobile Arcade",
    short_name: "GameVerse",
    description: "Sign in and play live mobile games.",
    start_url: "/",
    display: "standalone",
    background_color: "#06031a",
    theme_color: "#06031a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]
  };
}
