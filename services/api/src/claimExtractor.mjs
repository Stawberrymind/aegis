import { detectLanguage, includesAny, normalizeText } from "./nlp.mjs";

const LOCATION_PATTERNS = [
  { canonical: "Sector 4", patterns: [/sector\s*4/i, /सेक्टर\s*4/i] },
  { canonical: "Ward 7", patterns: [/ward\s*7/i, /वार्ड\s*7/i] },
  { canonical: "Bridge A", patterns: [/bridge\s*a/i, /पुल\s*a/i] },
  { canonical: "Lake Road", patterns: [/lake\s*road/i] },
  { canonical: "Market Road", patterns: [/market\s*road/i, /मार्केट\s*रोड/i] },
  { canonical: "Riverside School", patterns: [/riverside\s*school/i] },
  { canonical: "Industrial Gate", patterns: [/industrial\s*gate/i] },
  { canonical: "Ward 2", patterns: [/ward\s*2/i] },
  { canonical: "Central Metro", patterns: [/central\s*metro/i] },
  { canonical: "Park 3", patterns: [/park\s*3/i] },
  { canonical: "Old Bus Stand", patterns: [/old\s*bus\s*stand/i] },
  { canonical: "River belt", patterns: [/river\s*belt/i, /dam\s*gate/i] },
  { canonical: "India", patterns: [/\bindia\b/i, /भारत/i] },
  { canonical: "Delhi", patterns: [/\bdelhi\b/i, /दिल्ली/i] },
  { canonical: "Mumbai", patterns: [/\bmumbai\b/i, /मुंबई/i] },
  { canonical: "Hyderabad", patterns: [/\bhyderabad\b/i, /\bhyd\b/i, /हैदराबाद/i] },
  { canonical: "Kolkata", patterns: [/\bkolkata\b/i, /कोलकाता/i] },
  { canonical: "Chennai", patterns: [/\bchennai\b/i, /चेन्नई/i] },
  { canonical: "Bengaluru", patterns: [/\bbengaluru\b/i, /\bbangalore\b/i, /बेंगलुरु/i] },
  { canonical: "Kerala", patterns: [/\bkerala\b/i, /केरल/i] },
  { canonical: "Karnataka", patterns: [/\bkarnataka\b/i, /कर्नाटक/i] },
  { canonical: "Maharashtra", patterns: [/\bmaharashtra\b/i, /महाराष्ट्र/i] },
  { canonical: "Tamil Nadu", patterns: [/\btamil\s*nadu\b/i, /तमिल\s*नाडु/i] },
  { canonical: "West Bengal", patterns: [/\bwest\s*bengal\b/i, /पश्चिम\s*बंगाल/i] },
  { canonical: "District", patterns: [/district/i, /जिला/i] }
];

const PREDICATE_RULES = [
  {
    predicate: "weather_alert",
    harm_category: "hazard_warning",
    action_requested: "follow_weather_advisory",
    terms: ["weather alert", "weather warning", "rain alert", "heavy rain", "thunderstorm", "cyclone", "flood warning", "flood alert", "red alert", "orange alert", "rain warning", "बारिश", "मौसम", "चेतावनी", "बाढ़"]
  },
  {
    predicate: "public_safety_alert",
    harm_category: "emergency_instruction",
    action_requested: "follow_official_alert",
    terms: ["disaster alert", "official alert", "cap alert", "sachet alert", "emergency alert", "public safety alert"]
  },
  {
    predicate: "evacuation_order",
    harm_category: "emergency_instruction",
    action_requested: "evacuate",
    terms: ["evacuate", "evacuation", "leave sector", "empty sector", "खाली", "निकासी"]
  },
  {
    predicate: "boil_water_advisory",
    harm_category: "public_health",
    action_requested: "boil_water",
    terms: ["boil", "boiled water", "water for at least", "उबालें", "उबालना", "पानी"]
  },
  {
    predicate: "road_closure",
    harm_category: "movement_restriction",
    action_requested: "avoid_route",
    terms: ["road closed", "bridge closed", "closed to pedestrian", "बंद"]
  },
  {
    predicate: "altered_video_authenticity",
    harm_category: "media_authenticity",
    action_requested: "do_not_forward_as_verified",
    terms: ["video", "altered", "edited", "deepfake", "fake video", "वीडियो"]
  },
  {
    predicate: "relief_shelter_open",
    harm_category: "relief_service",
    action_requested: "use_shelter",
    terms: ["shelter", "relief shelter", "camp open"]
  },
  {
    predicate: "private_donation_account",
    harm_category: "donation_request",
    action_requested: "send_money",
    terms: ["donation", "private bank", "bank account", "upi"]
  },
  {
    predicate: "chemical_leak",
    harm_category: "hazard_warning",
    action_requested: "take_shelter",
    terms: ["chemical leak", "gas leak"]
  },
  {
    predicate: "power_shutdown",
    harm_category: "utility_disruption",
    action_requested: "prepare_for_power_cut",
    terms: ["power cut", "power shutdown", "electricity"]
  },
  {
    predicate: "station_closed",
    harm_category: "movement_restriction",
    action_requested: "avoid_station",
    terms: ["metro closed", "station closed"]
  },
  {
    predicate: "medical_camp_open",
    harm_category: "relief_service",
    action_requested: "seek_medical_help",
    terms: ["medical camp", "medicine camp", "first-aid"]
  },
  {
    predicate: "food_distribution_open",
    harm_category: "relief_service",
    action_requested: "collect_food",
    terms: ["food packet", "food distribution"]
  },
  {
    predicate: "school_closed",
    harm_category: "public_instruction",
    action_requested: "keep_children_home",
    terms: ["school closed", "schools closed", "school closure"]
  },
  {
    predicate: "dam_gate_release",
    harm_category: "hazard_warning",
    action_requested: "move_from_low_lying_area",
    terms: ["dam gate", "gate release", "water release"]
  },
  {
    predicate: "emergency_number",
    harm_category: "emergency_contact",
    action_requested: "call_112",
    terms: ["112", "emergency number"]
  }
];

export function extractClaims(inputText, options = {}) {
  const original_text = String(inputText ?? "");
  const text = normalizeText(original_text);
  const language = options.language || detectLanguage(text);

  if (!text) {
    return {
      original_text,
      normalized_text: text,
      language,
      claims: []
    };
  }

  const segments = splitIntoClaimSegments(text);
  const claims = segments.map((segment, index) => claimFromSegment(segment, language, index, options.location));

  return {
    original_text,
    normalized_text: text,
    language,
    claims
  };
}

function splitIntoClaimSegments(text) {
  const segments = text
    .split(/(?<=[.!?।])\s+|\n+/u)
    .map(normalizeText)
    .filter(Boolean)
    .slice(0, 5);
  return segments.length ? segments : [text];
}

function claimFromSegment(segment, language, index, locationOverride = null) {
  const predicateRule = PREDICATE_RULES.find((rule) => includesAny(segment, rule.terms));
  const location = normalizeLocationOverride(locationOverride) ?? findLocation(segment);
  const time_reference = findTimeReference(segment);

  return {
    claim_id: `claim-${String(index + 1).padStart(3, "0")}`,
    text: segment,
    subject: inferSubject(segment),
    predicate: predicateRule?.predicate ?? "unknown_claim",
    location: location ?? "unspecified",
    time_reference,
    harm_category: predicateRule?.harm_category ?? "unknown",
    action_requested: predicateRule?.action_requested ?? "verify_before_forwarding",
    language,
    extraction_method: "deterministic_multilingual_rules_v3_multi_claim"
  };
}

function normalizeLocationOverride(location) {
  if (!location) return null;
  const normalized = normalizeText(location).toLowerCase();
  const known = {
    india: "India",
    hyderabad: "Hyderabad",
    hyd: "Hyderabad",
    bengaluru: "Bengaluru",
    bangalore: "Bengaluru",
    blr: "Bengaluru",
    delhi: "Delhi",
    mumbai: "Mumbai",
    chennai: "Chennai",
    kolkata: "Kolkata"
  };
  return known[normalized] ?? normalizeText(location);
}

function findLocation(text) {
  for (const candidate of LOCATION_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(text))) {
      return candidate.canonical;
    }
  }
  return null;
}

function findTimeReference(text) {
  const lowered = text.toLowerCase();
  if (lowered.includes("tonight") || text.includes("आज रात")) return "tonight";
  if (lowered.includes("today") || text.includes("आज")) return "today";
  if (lowered.includes("tomorrow") || text.includes("कल")) return "tomorrow";
  if (/\b\d{1,2}:\d{2}\b/.test(text) || /\b\d{1,2}\s*(am|pm)\b/i.test(text)) return "specific_time";
  return "unspecified";
}

function inferSubject(text) {
  const lowered = text.toLowerCase();
  if (lowered.includes("ndma") || lowered.includes("sachet")) return "NDMA SACHET";
  if (lowered.includes("imd")) return "India Meteorological Department";
  if (lowered.includes("district") || text.includes("जिला")) return "district administration";
  if (lowered.includes("municipal") || text.includes("नगर")) return "municipal authority";
  if (lowered.includes("official") || text.includes("आधिकारिक")) return "public authority";
  return "unspecified source";
}
