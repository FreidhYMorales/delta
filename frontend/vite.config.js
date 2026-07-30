import { defineConfig } from "vite";

export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: "jsdom",
  },
});
