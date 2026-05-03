import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SleepOps",
    short_name: "SleepOps",
    description: "A 9h sleep constraint compiler for tomorrow's work start.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f8f7",
    theme_color: "#166534",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
