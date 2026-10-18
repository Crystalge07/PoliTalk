// The panel lives in a shadow root on third-party pages, where `rem` follows the
// page's root font size (YouTube uses 10px). Converting to px keeps sizes stable.
const remToPx = () => ({
  postcssPlugin: "rem-to-px",
  Declaration(decl) {
    if (decl.value.includes("rem")) {
      decl.value = decl.value.replace(/(-?\d*\.?\d+)rem\b/g, (_, n) => `${parseFloat(n) * 16}px`);
    }
  },
});
remToPx.postcss = true;

export default {
  plugins: [(await import("tailwindcss")).default, remToPx, (await import("autoprefixer")).default],
};
