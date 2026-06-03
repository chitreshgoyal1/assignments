/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand purple — base is rgb(102, 46, 130) → #662E82.
        // Scale derived by holding hue ≈ 280° / saturation ≈ 48% and
        // varying lightness. Tailwind utilities like text-brand-300 and
        // bg-brand-600 are used throughout the app so the full 50–900
        // ramp is provided rather than just the base.
        brand: {
          50:  "#f4eef8",
          100: "#e6d8ee",
          200: "#c8a8da",
          300: "#aa7ec6",
          400: "#874aa9",
          500: "#662e82", // ← rgb(102, 46, 130) — exact base
          600: "#532469",
          700: "#3f1c50",
          800: "#2b1338",
          900: "#1d0d25",
        },
        surface: {
          page:    "#1e2132",   // main background
          card:    "#272b3f",   // message bubbles / cards
          input:   "#2e3248",   // inputs
          border:  "#3a3f5c",   // borders
          sidebar: "#1a1d2e",   // activity sidebar
        },
      },
    },
  },
  plugins: [],
};
