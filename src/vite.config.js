import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // IMPORTANT: set the repo name here (including leading and trailing slashes)
  base: "/dotandbloom/",
});
