/**
 * Generates tokens/tokens.css from tokens/tokens.json so the CSS variables
 * can never drift from the JSON export (which RN consumes directly).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tokens = JSON.parse(readFileSync(`${root}/tokens/tokens.json`, "utf8"));

function colorBlock(selector, colors) {
  const lines = Object.entries(colors).map(([name, value]) => `  --color-${name}: ${value};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

const shared = [
  `  --font-ui: ${tokens.typography.family.ui};`,
  `  --font-money: ${tokens.typography.family.money};`,
  `  --radius: ${tokens.radiusPx.default}px;`,
  `  --radius-card: ${tokens.radiusPx.card}px;`,
  `  --shadow-card: ${tokens.shadow.card};`,
  `  --shadow-overlay: ${tokens.shadow.overlay};`,
].join("\n");

const css = `/* GENERATED from tokens.json by scripts/build-tokens.mjs — do not edit by hand. */
${colorBlock(":root", tokens.color.light)}

:root {
${shared}
}

${colorBlock('[data-theme="dark"]', tokens.color.dark)}
`;

writeFileSync(`${root}/tokens/tokens.css`, css);
console.log("tokens.css generated");
