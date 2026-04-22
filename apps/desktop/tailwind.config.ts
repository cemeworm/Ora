import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Aptos",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SFMono-Regular",
          "ui-monospace",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        bench: {
          50: "#fafaf7",
          100: "#f3f3ee",
          200: "#e7e7df",
          300: "#d2d2c7",
          700: "#34352f",
          900: "#171812",
        },
        signal: {
          amber: "#d79921",
          acid: "#9bd82e",
          red: "#bd4f42",
        },
      },
      boxShadow: {
        pane: "0 1px 2px rgba(23, 24, 18, 0.06), 0 12px 28px rgba(23, 24, 18, 0.05)",
        lift: "0 8px 20px rgba(23, 24, 18, 0.09)",
      },
    },
  },
  plugins: [],
} satisfies Config;
