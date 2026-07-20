import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const cacheDir = path.join(repoRoot, "data", "embedding-cache");
const DEFAULT_MODEL = process.env.AEGIS_EMBEDDING_MODEL || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let extractorPromise = null;
let lastStatus = {
  enabled: process.env.AEGIS_ENABLE_LOCAL_EMBEDDINGS !== "false",
  provider: "local_transformers_js",
  model: DEFAULT_MODEL,
  loaded: false,
  fallback_used: false,
  error: null
};

export function getEmbeddingStatus() {
  return { ...lastStatus };
}

export function localEmbeddingsEnabled() {
  return process.env.AEGIS_ENABLE_LOCAL_EMBEDDINGS !== "false";
}

export async function embedText(text, options = {}) {
  if (options.embeddingProvider) {
    return options.embeddingProvider.embedText(text);
  }

  if (!localEmbeddingsEnabled()) {
    throw new Error("Local embeddings disabled");
  }

  const model = options.model || DEFAULT_MODEL;
  const cacheKey = hashText(`${model}|${text}`);
  const cached = await readEmbeddingCache(cacheKey);
  if (cached) return cached;

  const extractor = await loadExtractor(model);
  const output = await extractor(String(text), {
    pooling: "mean",
    normalize: true
  });
  const vector = Array.from(output.data ?? output.tolist?.()[0] ?? []);
  if (!vector.length) {
    throw new Error("Embedding model returned an empty vector");
  }

  await writeEmbeddingCache(cacheKey, vector);
  return vector;
}

export async function embedMany(texts, options = {}) {
  const vectors = [];
  for (const text of texts) {
    vectors.push(await embedText(text, options));
  }
  return vectors;
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function embeddingInputForClaim(claim) {
  return [
    claim.text,
    `predicate: ${claim.predicate}`,
    `location: ${claim.location}`,
    `time: ${claim.time_reference}`,
    `action: ${claim.action_requested}`,
    `category: ${claim.harm_category}`
  ].join("\n");
}

export function embeddingInputForEvidence(record) {
  return [
    record.title,
    record.body,
    `scope: ${record.scope}`,
    `source type: ${record.source_type}`,
    ...(record.assertions ?? []).map((assertion) =>
      `assertion: ${assertion.predicate} ${assertion.polarity} ${assertion.location} ${assertion.time_scope}`
    )
  ].join("\n");
}

async function loadExtractor(model) {
  if (!extractorPromise) {
    lastStatus = {
      enabled: true,
      provider: "local_transformers_js",
      model,
      loaded: false,
      fallback_used: false,
      error: null
    };
    extractorPromise = import("@huggingface/transformers")
      .then(({ pipeline, env }) => {
        env.allowLocalModels = true;
        env.allowRemoteModels = true;
        return pipeline("feature-extraction", model);
      })
      .then((extractor) => {
        lastStatus = {
          ...lastStatus,
          loaded: true,
          error: null
        };
        return extractor;
      })
      .catch((error) => {
        lastStatus = {
          ...lastStatus,
          loaded: false,
          fallback_used: true,
          error: error.message
        };
        extractorPromise = null;
        throw error;
      });
  }

  return extractorPromise;
}

async function readEmbeddingCache(cacheKey) {
  try {
    const raw = await readFile(path.join(cacheDir, `${cacheKey}.json`), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.vector;
  } catch {
    return null;
  }
}

async function writeEmbeddingCache(cacheKey, vector) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(cacheDir, `${cacheKey}.json`), JSON.stringify({ vector }), "utf8");
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
