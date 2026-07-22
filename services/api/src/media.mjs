import { createWorker } from "tesseract.js";
import { detectLanguage } from "./nlp.mjs";
import { translateToEnglish } from "./translation.mjs";
import { publicError } from "./httpRequest.mjs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const OPENAI_VERIFY_URL = "https://openai.com/research/verify/";
const workers = new Map();
const workerPromises = new Map();
const MAX_OCR_WORKERS = 4;
const OCR_LANGUAGES = {
  en: "eng",
  hi: "hin",
  bn: "ben",
  gu: "guj",
  ta: "tam",
  te: "tel",
  kn: "kan",
  ml: "mal",
  mr: "mar"
};

export async function inspectImage({ data, mime_type, language = "en" }) {
  const buffer = decodeImageData(data, mime_type);
  const ocr = await runOcr(buffer, mime_type, language);
  const translation = await translateToEnglish(ocr.text, detectLanguage(ocr.text));
  const provenance = await inspectC2pa(buffer, mime_type);
  return {
    input_type: "image",
    ocr,
    translation,
    provenance: {
      ...provenance,
      openai_verify_url: OPENAI_VERIFY_URL,
      interpretation: provenance.status === "detected"
        ? "A supported provenance signal was found. This indicates origin metadata, not whether the claim is accurate or correctly presented."
        : "No supported provenance signal was found. This does not prove the image is real, synthetic, or false."
    }
  };
}

function decodeImageData(data, mimeType) {
  if (!/^image\/(png|jpeg|webp)$/i.test(String(mimeType ?? ""))) {
    throw publicError(400, "invalid_media", "Only PNG, JPEG, and WebP images are supported");
  }
  const encoded = String(data ?? "").replace(/^data:image\/(?:png|jpeg|webp);base64,/i, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || !encoded) throw publicError(400, "invalid_media", "Invalid image data");
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw publicError(400, "invalid_media", "Image must be smaller than 8 MB");
  if (!hasImageSignature(buffer, mimeType)) throw publicError(400, "invalid_media", "Image content does not match its declared type");
  return buffer;
}

function hasImageSignature(buffer, mimeType) {
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

async function runOcr(buffer, mimeType, language) {
  const started = Date.now();
  const timeoutMs = Number(process.env.AEGIS_OCR_TIMEOUT_MS ?? 90_000);
  try {
    const requestedLang = OCR_LANGUAGES[language] ?? "eng+hin";
    const primary = await recognizeOcr(buffer, mimeType, requestedLang, timeoutMs);
    const shouldTryBilingualFallback = Boolean(language && !["en", "hi"].includes(language)) &&
      (primary.status === "no_text_found" || (primary.confidence !== null && primary.confidence < 35));
    if (!shouldTryBilingualFallback) return { ...primary, requested_language: language || "auto", duration_ms: Date.now() - started };

    const fallback = await recognizeOcr(buffer, mimeType, "eng+hin", timeoutMs);
    const chosen = ocrScore(fallback) > ocrScore(primary) ? fallback : primary;
    return {
      ...chosen,
      requested_language: language,
      fallback_attempted: true,
      fallback_language: "eng+hin",
      duration_ms: Date.now() - started
    };
  } catch (error) {
    return {
      status: "unavailable",
      text: "",
      language: OCR_LANGUAGES[language] ?? "eng+hin",
      requested_language: language || "auto",
      engine: "tesseract.js",
      confidence: null,
      quality: "unavailable",
      error: error.message,
      duration_ms: Date.now() - started
    };
  }
}

async function recognizeOcr(buffer, mimeType, lang, timeoutMs) {
  let entry;
  try {
    entry = await getOcrWorker(lang, timeoutMs);
    entry.inUse += 1;
    entry.lastUsedAt = Date.now();
    const recognition = await withTimeout(entry.worker.recognize(buffer, { mimeType }), timeoutMs, "OCR");
    const text = String(recognition.data?.text ?? "").trim();
    const confidence = Number.isFinite(recognition.data?.confidence)
      ? Number(recognition.data.confidence.toFixed(1))
      : null;
    return {
      status: text ? "completed" : "no_text_found",
      text,
      language: lang,
      engine: "tesseract.js",
      engine_version: "7.x",
      confidence,
      quality: ocrQuality(confidence, text),
      word_count: text ? text.split(/\s+/).filter(Boolean).length : 0,
      line_count: Array.isArray(recognition.data?.lines) ? recognition.data.lines.length : null
    };
  } catch (error) {
    if (entry && error.message.includes("timed out")) {
      await entry.worker.terminate().catch(() => {});
      workers.delete(lang);
    }
    throw error;
  } finally {
    if (entry) entry.inUse = Math.max(0, entry.inUse - 1);
  }
}

async function getOcrWorker(lang, timeoutMs) {
  const existing = workers.get(lang);
  if (existing) return existing;

  const pending = workerPromises.get(lang);
  if (pending) return pending;

  await evictIdleOcrWorker();
  const initialization = withTimeout(createWorker(lang), timeoutMs, "OCR initialization")
    .then((worker) => {
      const entry = { worker, inUse: 0, lastUsedAt: Date.now() };
      workers.set(lang, entry);
      return entry;
    })
    .finally(() => workerPromises.delete(lang));
  workerPromises.set(lang, initialization);
  return initialization;
}

async function evictIdleOcrWorker() {
  if (workers.size + workerPromises.size < MAX_OCR_WORKERS) return;
  const idle = [...workers.entries()]
    .filter(([, entry]) => entry.inUse === 0)
    .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
  if (!idle) return;
  workers.delete(idle[0]);
  if (typeof idle[1].worker.terminate === "function") await idle[1].worker.terminate().catch(() => {});
}

export function getOcrWorkerStats() {
  return { active_workers: workers.size, initializing_workers: workerPromises.size, max_workers: MAX_OCR_WORKERS };
}

function ocrScore(result) {
  if (!result || result.status !== "completed") return 0;
  return (result.confidence ?? 0) + Math.min(20, result.word_count ?? 0);
}

function ocrQuality(confidence, text) {
  if (!text) return "no_text";
  if (confidence === null) return "unknown";
  if (confidence >= 80) return "high";
  if (confidence >= 55) return "medium";
  return "low";
}

async function withTimeout(promise, timeoutMs, operation) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs} ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function inspectC2pa(buffer, mimeType) {
  try {
    const { Reader } = await import("@contentauth/c2pa-node");
    const reader = await Reader.fromAsset({ buffer, mimeType }, { verify: { verify_after_reading: true } });
    if (!reader) return unavailable("No embedded C2PA manifest found");
    const manifest = reader.getActive();
    if (!manifest) return noManifest("No active C2PA manifest found");
    const assertions = manifest?.assertions ?? [];
    const issuer = manifest?.claim_generator ?? manifest?.claim_generator_info?.[0]?.name ?? null;
    return {
      status: "detected",
      signal: "c2pa_content_credentials",
      embedded: reader.isEmbedded(),
      verified: true,
      issuer,
      assertion_count: assertions.length
    };
  } catch (error) {
    return unavailable(error.message || "C2PA inspection unavailable");
  }
}

function unavailable(reason) {
  return { status: "unavailable", signal: null, embedded: false, verified: false, reason };
}

function noManifest(reason) {
  return { status: "not_detected", signal: null, embedded: false, verified: false, reason };
}

export function mediaLimits() {
  return { max_image_bytes: MAX_IMAGE_BYTES, supported_mime_types: ["image/png", "image/jpeg", "image/webp"] };
}
