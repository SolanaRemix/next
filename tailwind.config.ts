import type { Config } from "tailwindcss";

export default {
  content: ["./apps/web/index.html", "./apps/web/src/**/*.{ts,tsx}", "./packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: "#FF5722", positive: "#00FF80", negative: "#FF4444" },
      backdropBlur: { glass: "16px" },
    },
  },
  plugins: [],
} satisfies Config;
