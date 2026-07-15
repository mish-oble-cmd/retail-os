module.exports = {
  presets: [require("@retailos/config/tailwind-preset")],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      keyframes: {
        // POS-02 mockup: wrong-PIN dots shake (respects prefers-reduced-motion
        // via the `motion-reduce:animate-none` modifier at the call site).
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-6px)" },
          "40%, 80%": { transform: "translateX(6px)" },
        },
      },
      animation: {
        shake: "shake 350ms ease-in-out",
      },
    },
  },
};
