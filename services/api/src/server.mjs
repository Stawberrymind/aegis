import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSubmission } from "./pipeline.mjs";
import { getEmbeddingStatus } from "./embeddings.mjs";
import { getStructuredExtractionStatus } from "./structuredExtractor.mjs";
import { fetchLiveEvidence, getLastSourceStatus } from "./trustedFetch.mjs";

const PORT = Number(process.env.AEGIS_API_PORT ?? 8787);
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const webRoot = path.join(repoRoot, "apps", "web");
const socialHandlesPath = path.join(repoRoot, "data", "sources", "social-handles.json");
const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/main.js", { file: "main.js", type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }]
]);
const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && STATIC_FILES.has(url.pathname)) {
      await sendStatic(res, STATIC_FILES.get(url.pathname));
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "aegis-api" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/sources/status") {
      sendJson(res, 200, getLastSourceStatus());
      return;
    }

    if (req.method === "GET" && url.pathname === "/sources/social") {
      sendJson(res, 200, JSON.parse(await readFile(socialHandlesPath, "utf8")));
      return;
    }

    if (req.method === "POST" && url.pathname === "/sources/refresh") {
      const refreshed = await fetchLiveEvidence();
      sendJson(res, 200, {
        enabled: refreshed.enabled,
        statuses: refreshed.statuses,
        live_record_count: refreshed.records.length
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/models/status") {
      sendJson(res, 200, {
        embedding: getEmbeddingStatus(),
        structured_extraction: getStructuredExtractionStatus()
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/analyze") {
      const body = await readJsonBody(req);
      if ((!body.text || String(body.text).trim().length === 0) && !body.image?.data) {
        sendJson(res, 400, { error: "text or image is required" });
        return;
      }
      const result = await analyzeSubmission({
        text: body.text,
        image: body.image,
        language: body.language,
        location: body.location,
        analysis_at: body.analysis_at
      });
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`AEGIS running at http://localhost:${PORT}`);
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

async function sendStatic(res, asset) {
  const content = await readFile(path.join(webRoot, asset.file));
  res.writeHead(200, { "content-type": asset.type });
  res.end(content);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
