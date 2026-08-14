import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = new Hono();

app.get("/health", (context) => {
  return context.json({
    status: "ok",
    service: "issue-governance-agent"
  });
});

serve(
  {
    fetch: app.fetch,
    port: env.PORT
  },
  (info) => {
    console.log(`issue-governance-agent listening on http://localhost:${info.port}`);
  }
);
