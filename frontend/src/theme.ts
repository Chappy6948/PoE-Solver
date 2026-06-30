// Dark gaming theme tokens
export const theme = {
  colors: {
    bg: "#0a0a0d",
    bgElev: "#13131a",
    bgCard: "#1a1a24",
    border: "#2a2a38",
    borderGold: "#5a4a1f",
    text: "#e8e6d9",
    textDim: "#9a988a",
    textMuted: "#5e5c52",
    gold: "#d4a957",
    goldBright: "#f4c861",
    crimson: "#c93838",
    crimsonGlow: "#ff5252",
    teal: "#3eb8b8",
    success: "#6abf4b",
    purple: "#9b5cd4",
    overlay: "rgba(0,0,0,0.55)",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    xl: 20,
    pill: 999,
  },
  font: {
    title: 28,
    h1: 22,
    h2: 18,
    body: 14,
    small: 12,
    micro: 10,
  },
};

export type Theme = typeof theme;
