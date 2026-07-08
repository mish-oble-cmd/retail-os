/** Tailwind config for @retailos/ui (Storybook + component build preview). */
module.exports = {
  presets: [require("@retailos/config/tailwind-preset")],
  content: ["./src/**/*.{ts,tsx}", "./.storybook/**/*.{ts,tsx}"],
};
