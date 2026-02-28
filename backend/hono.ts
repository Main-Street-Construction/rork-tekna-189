import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { feedbackStore } from "./trpc/routes/feedback";

const app = new Hono();

app.use("*", cors());

app.use(
  "/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext,
  }),
);

app.get("/", (c) => {
  return c.json({ status: "ok", message: "API is running" });
});

app.get("/admin/feedback", (c) => {
  const items = feedbackStore;
  const rows = items
    .slice()
    .reverse()
    .map(
      (f) =>
        `<tr><td>${f.id}</td><td>${f.userName}</td><td>${f.message}</td><td>${f.createdAt}</td></tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feedback Admin</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#f5f5f7;color:#1d1d1f}
  h1{font-size:22px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  th,td{text-align:left;padding:12px 16px;border-bottom:1px solid #e5e5ea}
  th{background:#f9f9fb;font-weight:600;font-size:13px;color:#86868b;text-transform:uppercase;letter-spacing:.5px}
  td{font-size:14px}
  tr:last-child td{border-bottom:none}
  .empty{text-align:center;padding:40px;color:#86868b}
</style></head><body>
<h1>Feedback (${items.length})</h1>
${items.length ? `<table><thead><tr><th>ID</th><th>User</th><th>Message</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">No feedback yet</div>'}
</body></html>`;

  return c.html(html);
});

export default app;
