const DEVANAGARI_RE = /[\u0900-\u097F]/;

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "at", "has", "have", "been", "is", "are",
  "this", "that", "today", "tonight", "please", "before", "after", "by", "from", "with", "as", "it", "be",
  "है", "हैं", "के", "की", "का", "को", "में", "से", "और", "पर", "लिए", "आज", "रात", "कृपया", "तक"
]);

const SYNONYMS = new Map([
  ["evacuate", "evacuation"],
  ["evacuated", "evacuation"],
  ["evacuation", "evacuation"],
  ["leave", "evacuation"],
  ["empty", "evacuation"],
  ["निकासी", "evacuation"],
  ["खाली", "evacuation"],
  ["boil", "boil"],
  ["boiled", "boil"],
  ["उबालें", "boil"],
  ["उबालना", "boil"],
  ["water", "water"],
  ["पानी", "water"],
  ["closed", "closure"],
  ["closure", "closure"],
  ["close", "closure"],
  ["बंद", "closure"],
  ["bridge", "bridge"],
  ["पुल", "bridge"],
  ["shelter", "shelter"],
  ["relief", "relief"],
  ["राहत", "relief"],
  ["donation", "donation"],
  ["donate", "donation"],
  ["account", "account"],
  ["video", "video"],
  ["वीडियो", "video"],
  ["altered", "altered"],
  ["edited", "altered"],
  ["fake", "fake"],
  ["chemical", "chemical"],
  ["leak", "leak"],
  ["power", "power"],
  ["school", "school"],
  ["dam", "dam"],
  ["metro", "metro"],
  ["weather", "weather"],
  ["rain", "rain"],
  ["बारिश", "rain"],
  ["मौसम", "weather"],
  ["चेतावनी", "alert"],
  ["alert", "alert"],
  ["warning", "alert"]
]);

export function normalizeText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectLanguage(text) {
  return DEVANAGARI_RE.test(text) ? "hi" : "en";
}

export function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => SYNONYMS.get(token) ?? token)
    .filter((token) => !STOP_WORDS.has(token) && token.length > 1);
}

export function tokenSet(text) {
  return new Set(tokenize(text));
}

export function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

export function includesAny(text, patterns) {
  const lowered = normalizeText(text).toLowerCase();
  return patterns.some((pattern) => lowered.includes(pattern));
}
