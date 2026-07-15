export type Theme = "light" | "dark";
export const nextTheme = (t: Theme): Theme => (t === "light" ? "dark" : "light");
