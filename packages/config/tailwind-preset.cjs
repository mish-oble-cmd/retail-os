/**
 * Shared Tailwind preset — maps Counter design tokens (design-system.md) to
 * the Tailwind theme. Colors reference CSS variables so light/dark is a
 * token swap ([data-theme="dark"]), never per-component styles.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        "primary-hover": "var(--color-primary-hover)",
        accent: "var(--color-accent)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        ink: "var(--color-ink)",
        "ink-muted": "var(--color-ink-muted)",
        border: "var(--color-border)",
      },
      borderRadius: {
        DEFAULT: "8px",
        card: "12px",
      },
      fontFamily: {
        ui: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        money: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        caption: "12px",
        "body-sm": "14px",
        body: "16px",
        "pos-body": "18px",
        h3: "20px",
        h2: "24px",
        h1: "30px",
        "pos-total": "40px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(28, 31, 29, 0.10)",
        overlay: "0 8px 24px rgba(28, 31, 29, 0.18)",
      },
      minHeight: {
        "touch-pos": "48px",
        "touch-admin": "36px",
      },
      minWidth: {
        "touch-pos": "48px",
      },
    },
  },
};
