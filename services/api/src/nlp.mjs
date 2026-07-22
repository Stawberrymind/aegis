const SCRIPT_LANGUAGES = [
  ["hi", /[\u0900-\u097F]/],
  ["bn", /[\u0980-\u09FF]/],
  ["gu", /[\u0A80-\u0AFF]/],
  ["ta", /[\u0B80-\u0BFF]/],
  ["te", /[\u0C00-\u0C7F]/],
  ["kn", /[\u0C80-\u0CFF]/],
  ["ml", /[\u0D00-\u0D7F]/]
];

const SPELLING_ALIASES = new Map([
  ["evacutaton", "evacuation"], ["evacuacion", "evacuation"], ["evactuation", "evacuation"],
  ["evacution", "evacuation"], ["evacuate", "evacuate"], ["fllod", "flood"], ["flod", "flood"],
  ["folod", "flood"], ["alret", "alert"], ["alerte", "alert"], ["wether", "weather"],
  ["weater", "weather"], ["thunderstrom", "thunderstorm"], ["cyclon", "cyclone"],
  ["emergncy", "emergency"], ["emergencyy", "emergency"], ["advisary", "advisory"],
  ["sheltr", "shelter"], ["shelterr", "shelter"], ["chemcal", "chemical"], ["leek", "leak"],
  ["earthqauke", "earthquake"], ["earthquke", "earthquake"], ["landslidee", "landslide"],
  ["tsunmai", "tsunami"], ["wildifre", "wildfire"], ["heatwvae", "heatwave"]
]);

const FUZZY_VOCABULARY = [
  "evacuation", "evacuate", "flood", "alert", "warning", "weather", "rain", "thunderstorm", "cyclone",
  "emergency", "advisory", "shelter", "chemical", "leak", "earthquake", "landslide", "tsunami", "wildfire",
  "heatwave", "road", "closed", "bridge", "relief", "donation", "school", "power", "safety", "medical",
  "drill", "simulation", "water", "boil", "dam", "release", "storm", "fire", "outbreak", "disease"
];

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
  ["warning", "alert"],
  ["baarish", "rain"], ["barish", "rain"], ["mausam", "weather"], ["chetaavni", "alert"],
  ["chetavani", "alert"], ["baadh", "flood"], ["toofan", "storm"], ["tufaan", "storm"],
  ["bhukamp", "earthquake"], ["bhuskhalaan", "landslide"], ["aag", "fire"], ["paani", "water"],
  ["nikasi", "evacuation"], ["nikaasi", "evacuation"], ["rahat", "relief"], ["shivir", "shelter"],
  ["sadak", "road"], ["band", "closure"], ["garmi", "heatwave"], ["bijli", "power"],
  ["bimari", "disease"], ["mahamari", "outbreak"]
]);

export function normalizeText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function correctSpelling(text) {
  const corrections = [];
  const normalized = normalizeText(text);
  const corrected = normalized.replace(/[\p{L}\p{N}'-]+/gu, (token) => {
    const lower = token.toLowerCase();
    const alias = SPELLING_ALIASES.get(lower);
    const candidate = alias ?? closestVocabulary(lower);
    if (candidate && candidate !== lower) {
      corrections.push({ from: token, to: candidate });
      return candidate;
    }
    return token;
  });
  return { text: corrected, corrections };
}

export function detectLanguage(text) {
  return SCRIPT_LANGUAGES.find(([, pattern]) => pattern.test(text))?.[0] ?? "en";
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

function closestVocabulary(token) {
  if (token.length < 5) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of FUZZY_VOCABULARY) {
    if (Math.abs(candidate.length - token.length) > 2) continue;
    const distance = levenshtein(token, candidate);
    const threshold = token.length >= 8 ? 2 : 1;
    if (distance <= threshold && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    for (let column = 0; column <= b.length; column += 1) previous[column] = current[column];
  }
  return previous[b.length];
}
