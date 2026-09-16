import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  // `npm run dev` serves on 5173; the API lives on 3000. Forward /api across so the
  // relative path works in development exactly as it does in the built app.
  server: { proxy: { "/api": "http://localhost:3000" } }, plugins: [react()] });
