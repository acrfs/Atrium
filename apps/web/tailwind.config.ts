import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Studio theme: softer corners, and the stock blue accents remapped to the
      // studio's periwinkle and indigo so no off-brand blue appears.
      borderRadius: {
        md: "0.625rem",
        lg: "0.875rem",
        xl: "1.25rem",
        "2xl": "1.75rem",
      },
      colors: {
        blue: {
          50: "#f3f5fc",
          100: "#e6ebf8",
          200: "#ccd6f2",
          300: "#adbce9",
          400: "#8da3e0",
          500: "#5f7bbc",
          600: "#2d2c80",
          700: "#3a39a0",
          800: "#25246a",
          900: "#1c1b52",
          950: "#12113a",
        },
      },
      fontFamily: {
        sans: ['"Outfit"', "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        serif: ['"Instrument Serif"', '"Iowan Old Style"', '"Palatino Linotype"', "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
