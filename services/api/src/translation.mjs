import { detectLanguage } from "./nlp.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_BY_LANGUAGE = {
  hi: "Xenova/opus-mt-hi-en",
  mr: "Xenova/opus-mt-mr-en",
  bn: "Xenova/opus-mt-bn-en",
  ta: "Xenova/opus-mt-ta-en",
  te: "Xenova/opus-mt-te-en",
  kn: "Xenova/opus-mt-kn-en",
  ml: "Xenova/opus-mt-ml-en",
  gu: "Xenova/opus-mt-gu-en"
};

const translators = new Map();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export async function translateToEnglish(text, language = null) {
  const originalText = String(text ?? "").trim();
  const detectedLanguage = language || detectLanguage(originalText);
  if (!originalText || detectedLanguage === "en") {
    return { status: "not_needed", source_language: detectedLanguage, text: originalText, model: null };
  }
  if (!hasExpectedScript(originalText, detectedLanguage)) {
    return { status: "not_needed", source_language: detectedLanguage, text: originalText, model: null, reason: "Text does not contain the expected source-language script." };
  }

  const model = MODEL_BY_LANGUAGE[detectedLanguage];
  if (!model) {
    return {
      status: "unavailable",
      source_language: detectedLanguage,
      text: originalText,
      model: null,
      reason: "No local translation model is configured for this language yet."
    };
  }

  try {
    let translatorPromise = translators.get(model);
    if (!translatorPromise) {
      translatorPromise = import("@huggingface/transformers").then(async ({ pipeline, env }) => {
        env.allowLocalModels = true;
        env.allowRemoteModels = true;
        env.cacheDir = path.join(repoRoot, "data", "translation-cache");
        return pipeline("translation", model);
      });
      translators.set(model, translatorPromise);
    }
    const translator = await translatorPromise;
    const output = await translator(originalText.slice(0, 4000), { max_new_tokens: 512 });
    const translated = Array.isArray(output)
      ? output.map((item) => item.translation_text).filter(Boolean).join(" ")
      : "";
    return {
      status: translated ? "completed" : "unavailable",
      source_language: detectedLanguage,
      text: translated || originalText,
      original_text: originalText,
      model
    };
  } catch (error) {
    translators.delete(model);
    return {
      status: "unavailable",
      source_language: detectedLanguage,
      text: originalText,
      original_text: originalText,
      model,
      reason: error.message
    };
  }
}

function hasExpectedScript(text, language) {
  const ranges = {
    hi: /[\u0900-\u097F]/,
    bn: /[\u0980-\u09FF]/,
    gu: /[\u0A80-\u0AFF]/,
    ta: /[\u0B80-\u0BFF]/,
    te: /[\u0C00-\u0C7F]/,
    kn: /[\u0C80-\u0CFF]/,
    ml: /[\u0D00-\u0D7F]/
  };
  return ranges[language]?.test(text) ?? true;
}
