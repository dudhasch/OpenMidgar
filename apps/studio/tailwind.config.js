/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* shadcn/ui Mapping (dark-only, siehe src/index.css) */
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        /* WebMidgar-Studio-Design-Tokens (design.md Abschnitt 2) */
        app: "var(--bg-app)",
        panel: "var(--bg-panel)",
        elevated: "var(--bg-elevated)",
        inset: "var(--bg-inset)",
        subtle: "var(--border-subtle)",
        strong: "var(--border-strong)",
        mako: {
          DEFAULT: "var(--accent-mako)",
          hover: "var(--accent-mako-hover)",
          dim: "var(--accent-mako-dim)",
        },
        engine: "var(--accent-engine)",
        warn: "var(--warn)",
        error: "var(--error)",
        info: "var(--info)",
        locked: "var(--locked)",
        ff7: {
          top: "var(--ff7-box-top)",
          bottom: "var(--ff7-box-bottom)",
          border: "var(--ff7-box-border)",
        },
      },
      textColor: {
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        ff7: ['"Press Start 2P"', 'monospace'],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        elevated: "0 1px 2px rgba(0,0,0,.4)",
        modal: "0 8px 32px rgba(0,0,0,.6)",
        'mako-glow': "0 0 0 1px rgba(61,220,151,.35), 0 0 24px rgba(61,220,151,.12)",
      },
      transitionTimingFunction: {
        ui: "cubic-bezier(.2,.8,.2,1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        "mako-pulse": {
          "0%": { opacity: "0.6" },
          "50%": { opacity: "1" },
          "100%": { opacity: "0.6" },
        },
        "shimmer": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(200%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "mako-pulse": "mako-pulse 1.6s ease-in-out infinite",
        "shimmer": "shimmer 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
