// A tiny local server for the API route, so `npm run dev` (Vite on 5173) can call /api/run on port 3001.
//
//   npm run dev:api        needs MODEL_API_KEY and DEMO_CODE in .env.local
import { createServer } from "node:http";
import handler from "../api/run.ts";

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body: unknown = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      /* an unreadable body is treated as empty and refused by validation */
    }
    const r = res as unknown as Record<string, unknown>;
    r.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    r.json = (payload: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(payload));
      return res;
    };
    void handler(Object.assign(req, { body }) as never, res as never);
  });
}).listen(3001, "127.0.0.1", () => console.error("API on http://127.0.0.1:3001 (the page runs on Vite, port 5173)"));
