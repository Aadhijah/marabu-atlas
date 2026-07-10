/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: "#0d8b8b",
          dark: "#0a6e6e",
          light: "#5fbfbf",
        },
        navy: "#0f1b2d",
        sand: "#f5efe6",
      },
      fontFamily: {
        display: ["'Playfair Display'", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
