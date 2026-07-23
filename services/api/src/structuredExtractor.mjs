import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_MODEL = process.env.AEGIS_STRUCTURED_MODEL || "Xenova/flan-t5-small";

const ALLOWED_PREDICATES = new Set([
  "weather_alert", "earthquake_alert", "landslide_alert", "wildfire_alert", "heatwave_alert",
  "tsunami_alert", "health_outbreak_alert", "public_safety_alert", "emergency_drill_notice",
  "evacuation_order", "boil_water_advisory", "road_closure", "altered_video_authenticity",
  "relief_shelter_open", "private_donation_account", "chemical_leak", "power_shutdown",
  "station_closed", "medical_camp_open", "food_distribution_open", "school_closed",
  "dam_gate_release", "emergency_number", "unknown_claim"
]);

const PREDICATE_DETAILS = {
  weather_alert: ["hazard_warning", "follow_weather_advisory"],
  earthquake_alert: ["hazard_warning", "follow_earthquake_advisory"],
  landslide_alert: ["hazard_warning", "avoid_affected_area"],
  wildfire_alert: ["hazard_warning", "avoid_affected_area"],
  heatwave_alert: ["hazard_warning", "avoid_heat_exposure"],
  tsunami_alert: ["hazard_warning", "move_to_high_ground"],
  health_outbreak_alert: ["public_health", "follow_health_advisory"],
  public_safety_alert: ["emergency_instruction", "follow_official_alert"],
  emergency_drill_notice: ["public_instruction", "no_action_required"],
  evacuation_order: ["emergency_instruction", "evacuate"],
  boil_water_advisory: ["public_health", "boil_water"],
  road_closure: ["movement_restriction", "avoid_route"],
  altered_video_authenticity: ["media_authenticity", "do_not_forward_as_verified"],
  relief_shelter_open: ["relief_service", "use_shelter"],
  private_donation_account: ["donation_request", "send_money"],
  chemical_leak: ["hazard_warning", "avoid_affected_area"],
  power_shutdown: ["utility_disruption", "follow_official_alert"],
  station_closed: ["movement_restriction", "avoid_route"],
  medical_camp_open: ["relief_service", "use_service"],
  food_distribution_open: ["relief_service", "use_service"],
  school_closed: ["public_instruction", "follow_official_alert"],
  dam_gate_release: ["hazard_warning", "follow_official_alert"],
  emergency_number: ["public_safety", "contact_official_service"],
  unknown_claim: ["unknown", "verify_before_forwarding"]
};

let generatorPromise = null;
let lastStatus = {
  enabled: process.env.AEGIS_ENABLE_LOCAL_STRUCTURED_AI === "true",
  provider: "local_transformers_js",
  model: DEFAULT_MODEL,
  loaded: false,
  fallback_used: false,
  error: null
};

export function getStructuredExtractionStatus() {
  return { ...lastStatus };
}

export function localStructuredExtractionEnabled() {
  return process.env.AEGIS_ENABLE_LOCAL_STRUCTURED_AI === "true";
}

export async function enrichClaimsWithLocalAI(text, extraction, options = {}) {
  const provider = options.structuredExtractorProvider;
  if (!provider && !localStructuredExtractionEnabled()) {
    return { extraction, status: getStructuredExtractionStatus() };
  }

  try {
    const raw = await generateStructuredOutput(text, provider, options);
    const modelClaims = validateStructuredOutput(parseJsonOutput(raw), text);
    if (!modelClaims.length) throw new Error("Structured model returned no valid claims");

    const mergedClaims = mergeModelFields(extraction.claims, modelClaims);
    return {
      extraction: { ...extraction, claims: mergedClaims },
      status: {
        ...getStructuredExtractionStatus(),
        enabled: true,
        loaded: true,
        fallback_used: false,
        error: null
      }
    };
  } catch (error) {
    lastStatus = {
      ...lastStatus,
      enabled: true,
      fallback_used: true,
      error: error.message
    };
    return {
      extraction,
      status: getStructuredExtractionStatus()
    };
  }
}

async function generateStructuredOutput(text, provider, options) {
  const prompt = buildPrompt(text);
  if (provider?.generate) return provider.generate(prompt, options);

  const generator = await loadGenerator(options.model || DEFAULT_MODEL);
  const predicate = parsePredicate(await generateField(generator, [
    "Classify the emergency claim below.",
    "Reply with exactly one label from this list: weather_alert, earthquake_alert, landslide_alert, wildfire_alert, heatwave_alert, tsunami_alert, health_outbreak_alert, public_safety_alert, emergency_drill_notice, evacuation_order, boil_water_advisory, road_closure, altered_video_authenticity, relief_shelter_open, private_donation_account, chemical_leak, power_shutdown, station_closed, medical_camp_open, food_distribution_open, school_closed, dam_gate_release, emergency_number, unknown_claim.",
    `Claim: ${String(text ?? "").slice(0, 4000)}`
  ].join("\n")), text);
  const location = parseLocation(await generateField(generator, [
    "Extract the place explicitly mentioned in this public-safety claim.",
    "Reply with only the place name, or unspecified if there is no reliable place.",
    `Claim: ${String(text ?? "").slice(0, 4000)}`
  ].join("\n")), text);
  const time_reference = parseTime(await generateField(generator, [
    "Extract the time reference explicitly mentioned in this public-safety claim.",
    "Reply with current, today, tonight, tomorrow, a stated date or time, or unspecified if none is present.",
    `Claim: ${String(text ?? "").slice(0, 4000)}`
  ].join("\n")), text);
  return { claims: [{ predicate, location, time_reference }] };
}

async function generateField(generator, prompt) {
  const output = await generator(prompt, { max_new_tokens: 64, do_sample: false });
  return Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
}

function parsePredicate(output, sourceText) {
  const text = String(output ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  let candidate = "unknown_claim";
  for (const predicate of ALLOWED_PREDICATES) {
    if (text.includes(predicate)) {
      candidate = predicate;
      break;
    }
  }
  if (candidate === "unknown_claim") {
    const aliases = [
    ["rain_alert", "weather_alert"], ["rainstorm", "weather_alert"], ["weather", "weather_alert"],
    ["earthquake", "earthquake_alert"], ["landslide", "landslide_alert"], ["wildfire", "wildfire_alert"],
    ["heatwave", "heatwave_alert"], ["tsunami", "tsunami_alert"], ["evacuation", "evacuation_order"],
    ["road_closure", "road_closure"], ["road_closed", "road_closure"], ["unknown", "unknown_claim"]
    ];
    candidate = aliases.find(([term]) => text.includes(term))?.[1] ?? "unknown_claim";
  }
  if (candidate === "unknown_claim") return candidate;
  const groundingTerms = {
    weather_alert: ["weather", "rain", "storm", "flood", "cyclone", "alert", "baarish", "barish"],
    earthquake_alert: ["earthquake", "seismic", "bhukamp"],
    landslide_alert: ["landslide", "mudslide", "bhuskhalaan"],
    wildfire_alert: ["wildfire", "forest fire", "bushfire"],
    heatwave_alert: ["heatwave", "heat wave", "extreme heat", "garmi"],
    tsunami_alert: ["tsunami"],
    health_outbreak_alert: ["outbreak", "epidemic", "pandemic", "disease", "bimari"],
    emergency_drill_notice: ["drill", "simulation", "test", "exercise"],
    evacuation_order: ["evacuate", "evacuation", "leave", "nikasi"],
    road_closure: ["road", "bridge", "closed", "closure"],
    altered_video_authenticity: ["video", "deepfake", "edited", "altered"],
    chemical_leak: ["chemical", "leak"],
    boil_water_advisory: ["boil", "water"],
    power_shutdown: ["power", "electricity", "shutdown"],
    school_closed: ["school", "closed"],
    public_safety_alert: ["emergency", "public safety", "official alert", "disaster"]
  };
  const source = String(sourceText ?? "").toLowerCase();
  return groundingTerms[candidate]?.some((term) => source.includes(term)) ? candidate : "unknown_claim";
}

function parseLocation(output, sourceText) {
  const text = cleanField(output, "unspecified");
  if (/^(?:unspecified|unknown|none|no reliable place|no specific location)$/i.test(text)) return "unspecified";
  const source = String(sourceText ?? "").toLowerCase();
  const knownLocations = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
    "Daman and Diu", "Diu", "India", "Hyderabad", "Bengaluru", "Bangalore", "Delhi", "Mumbai", "Chennai", "Kolkata"
  ];
  const groundedLocation = knownLocations.find((location) =>
    new RegExp(`\\b${location.replaceAll(" ", "\\s+")}\\b`, "i").test(text)
    && new RegExp(`\\b${location.replaceAll(" ", "\\s+")}\\b`, "i").test(source)
  );
  if (groundedLocation) return groundedLocation === "Bangalore" ? "Bengaluru" : groundedLocation;
  const candidateTokens = text.toLowerCase().split(/\s+/).filter((token) => token.length > 3);
  return candidateTokens.some((token) => source.includes(token)) ? text : "unspecified";
}

function parseTime(output, sourceText) {
  const text = cleanField(output, "unspecified");
  if (/^(?:unspecified|unknown|none|no time|no specific time)$/i.test(text)) return "unspecified";
  const source = String(sourceText ?? "").toLowerCase();
  const hasTimeCue = /\b(?:now|current|currently|right now|today|tonight|tomorrow|this week|next week)\b/.test(source)
    || /\b\d{1,2}:\d{2}\b/.test(source)
    || /\b(?:19|20)\d{2}\b/.test(source);
  if (!hasTimeCue) return "unspecified";
  const lowered = text.toLowerCase();
  if (/\b(?:now|current|currently|right now)\b/.test(lowered)) return "current";
  if (/\btoday\b/.test(lowered)) return "today";
  if (/\btonight\b/.test(lowered)) return "tonight";
  if (/\btomorrow\b/.test(lowered)) return "tomorrow";
  if (/\bthis week\b/.test(lowered)) return "this week";
  if (/\bnext week\b/.test(lowered)) return "next week";
  return text;
}

function buildPrompt(text) {
  return [
    "Extract public-safety claims from the text below.",
    "Return JSON only, with this exact shape: {\"claims\":[{\"predicate\":\"...\",\"location\":\"...\",\"time_reference\":\"...\"}]}",
    "Allowed predicates: weather_alert, earthquake_alert, landslide_alert, wildfire_alert, heatwave_alert, tsunami_alert, health_outbreak_alert, public_safety_alert, emergency_drill_notice, evacuation_order, boil_water_advisory, road_closure, altered_video_authenticity, relief_shelter_open, private_donation_account, chemical_leak, power_shutdown, station_closed, medical_camp_open, food_distribution_open, school_closed, dam_gate_release, emergency_number, unknown_claim.",
    "Use unknown_claim, unspecified, and unspecified when the text does not provide a reliable value.",
    "Do not decide whether the claim is true. Do not add facts that are not in the text.",
    `Text: ${String(text ?? "").slice(0, 4000)}`
  ].join("\n");
}

async function loadGenerator(model) {
  if (!generatorPromise) {
    lastStatus = {
      enabled: true,
      provider: "local_transformers_js",
      model,
      loaded: false,
      fallback_used: false,
      error: null
    };
    generatorPromise = import("@huggingface/transformers")
      .then(async ({ pipeline, env }) => {
        env.allowLocalModels = true;
        env.allowRemoteModels = true;
        env.cacheDir = path.join(repoRoot, "data", "structured-ai-cache");
        return pipeline("text2text-generation", model);
      })
      .then((generator) => {
        lastStatus = { ...lastStatus, loaded: true, error: null };
        return generator;
      })
      .catch((error) => {
        lastStatus = { ...lastStatus, loaded: false, fallback_used: true, error: error.message };
        generatorPromise = null;
        throw error;
      });
  }
  return generatorPromise;
}

function parseJsonOutput(output) {
  if (output && typeof output === "object") return output;
  const text = String(output ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function validateStructuredOutput(value, sourceText = "") {
  const rows = Array.isArray(value) ? value : value?.claims;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 5).map((row) => {
    if (!row || typeof row !== "object") return null;
    const candidatePredicate = ALLOWED_PREDICATES.has(row.predicate) ? row.predicate : "unknown_claim";
    return {
      predicate: candidatePredicate === "unknown_claim" || predicateIsGrounded(candidatePredicate, sourceText)
        ? candidatePredicate
        : "unknown_claim",
      location: parseLocation(row.location, sourceText),
      time_reference: parseTime(row.time_reference, sourceText)
    };
  }).filter(Boolean);
}

function predicateIsGrounded(predicate, sourceText) {
  const terms = {
    weather_alert: ["weather", "rain", "storm", "flood", "cyclone", "alert", "baarish", "barish"],
    earthquake_alert: ["earthquake", "seismic", "bhukamp"],
    landslide_alert: ["landslide", "mudslide", "bhuskhalaan"],
    wildfire_alert: ["wildfire", "forest fire", "bushfire"],
    heatwave_alert: ["heatwave", "heat wave", "extreme heat", "garmi"],
    tsunami_alert: ["tsunami"],
    health_outbreak_alert: ["outbreak", "epidemic", "pandemic", "disease", "bimari"],
    emergency_drill_notice: ["drill", "simulation", "test", "exercise"],
    evacuation_order: ["evacuate", "evacuation", "leave", "nikasi"],
    road_closure: ["road", "bridge", "closed", "closure"],
    altered_video_authenticity: ["video", "deepfake", "edited", "altered"],
    chemical_leak: ["chemical", "leak"],
    boil_water_advisory: ["boil", "water"],
    power_shutdown: ["power", "electricity", "shutdown"],
    school_closed: ["school", "closed"],
    public_safety_alert: ["emergency", "public safety", "official alert", "disaster"]
  };
  const source = String(sourceText ?? "").toLowerCase();
  return terms[predicate]?.some((term) => source.includes(term)) ?? false;
}

function mergeModelFields(deterministicClaims, modelClaims) {
  return deterministicClaims.map((claim, index) => {
    const modelClaim = modelClaims[index] ?? (modelClaims.length === 1 ? modelClaims[0] : null);
    if (!modelClaim) return claim;

    const shouldUsePredicate = claim.predicate === "unknown_claim" && modelClaim.predicate !== "unknown_claim";
    const shouldUseLocation = claim.location === "unspecified" && modelClaim.location !== "unspecified";
    const shouldUseTime = claim.time_reference === "unspecified" && modelClaim.time_reference !== "unspecified";
    if (!shouldUsePredicate && !shouldUseLocation && !shouldUseTime) return claim;

    const predicate = shouldUsePredicate ? modelClaim.predicate : claim.predicate;
    const [harm_category, action_requested] = PREDICATE_DETAILS[predicate] ?? PREDICATE_DETAILS.unknown_claim;
    return {
      ...claim,
      predicate,
      location: shouldUseLocation ? modelClaim.location : claim.location,
      time_reference: shouldUseTime ? modelClaim.time_reference : claim.time_reference,
      harm_category: shouldUsePredicate ? harm_category : claim.harm_category,
      action_requested: shouldUsePredicate ? action_requested : claim.action_requested,
      extraction_method: `${claim.extraction_method}+local_structured_ai`,
      extraction_signals: {
        ...claim.extraction_signals,
        structured_model: DEFAULT_MODEL,
        structured_fields: [
          ...(shouldUsePredicate ? ["predicate"] : []),
          ...(shouldUseLocation ? ["location"] : []),
          ...(shouldUseTime ? ["time_reference"] : [])
        ]
      }
    };
  });
}

function cleanField(value, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.toLowerCase() === "null" || cleaned.toLowerCase() === "none") return fallback;
  return cleaned.slice(0, 120);
}
