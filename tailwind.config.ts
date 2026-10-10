import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        violet: "rgb(var(--violet) / <alpha-value>)",
        sky: "rgb(var(--sky) / <alpha-value>)",
        cyan: "rgb(var(--cyan) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        pop: { from: { opacity: "0", transform: "scale(0.96)" }, to: { opacity: "1", transform: "scale(1)" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        breathe: { "0%,100%": { transform: "scale(1)", opacity: "0.55" }, "50%": { transform: "scale(1.08)", opacity: "0.9" } },
        pulseFast: { "0%,100%": { transform: "scale(1)", opacity: "0.7" }, "50%": { transform: "scale(1.18)", opacity: "1" } },
        spinSlow: { to: { transform: "rotate(360deg)" } },
        blink: { "0%,49%": { opacity: "1" }, "50%,100%": { opacity: "0" } },
      },
      animation: {
        rise: "rise 0.45s cubic-bezier(0.22,1,0.36,1) both",
        fade: "fade 0.3s ease both",
        pop: "pop 0.22s cubic-bezier(0.22,1,0.36,1) both",
        float: "float 6s ease-in-out infinite",
        breathe: "breathe 5s ease-in-out infinite",
        pulseFast: "pulseFast 1.2s ease-in-out infinite",
        spinSlow: "spinSlow 14s linear infinite",
        blink: "blink 1s steps(1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
