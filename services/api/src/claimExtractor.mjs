import { correctSpelling, detectLanguage, includesAny, normalizeText } from "./nlp.mjs";

export const INDIA_LOCATIONS = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
  "Diu"
];

const INDIA_LOCATION_PATTERNS = INDIA_LOCATIONS.map((location) => ({
  canonical: location,
  patterns: [new RegExp(`\\b${location.replaceAll(" ", "\\s+")}\\b`, "i")]
}));

const LOCATION_PATTERNS = [
  ...INDIA_LOCATION_PATTERNS,
  { canonical: "Daman and Diu", patterns: [/\bdaman\s*(?:&|and)\s*diu\b/i] },
  { canonical: "Diu", patterns: [/\bdiu\b/i] },
  { canonical: "Jammu", patterns: [/\bjammu\b/i] },
  { canonical: "Patna", patterns: [/\bpatna\b/i] },
  { canonical: "Ranchi", patterns: [/\branchi\b/i] },
  { canonical: "Assam", patterns: [/\bassam\b/i, /असम/u] },
  { canonical: "Odisha", patterns: [/\bodisha\b/i, /ओडिशा/u, /उड़ीसा/u] },
  { canonical: "Uttarakhand", patterns: [/\buttarakhand\b/i, /उत्तराखंड/u] },
  { canonical: "Sikkim", patterns: [/\bsikkim\b/i, /सिक्किम/u] },
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
    terms: ["weather alert", "weather warning", "rain alert", "heavy rain", "thunderstorm", "cyclone", "flood", "flood warning", "flood alert", "red alert", "orange alert", "rain warning", "बारिश", "मौसम", "चेतावनी", "बाढ़"]
  },
  {
    predicate: "weather_alert",
    harm_category: "hazard_warning",
    action_requested: "follow_weather_advisory",
    terms: ["baarish", "barish", "mausam", "chetaavni", "chetavani", "baadh", "toofan", "tufaan", "storm"]
  },
  {
    predicate: "earthquake_alert",
    harm_category: "hazard_warning",
    action_requested: "follow_earthquake_advisory",
    terms: ["earthquake", "earthquake warning", "seismic", "bhukamp"]
  },
  {
    predicate: "landslide_alert",
    harm_category: "hazard_warning",
    action_requested: "avoid_affected_area",
    terms: ["landslide", "land slide", "mudslide", "bhuskhalaan"]
  },
  {
    predicate: "wildfire_alert",
    harm_category: "hazard_warning",
    action_requested: "avoid_affected_area",
    terms: ["wildfire", "forest fire", "forestfire", "bushfire"]
  },
  {
    predicate: "heatwave_alert",
    harm_category: "hazard_warning",
    action_requested: "avoid_heat_exposure",
    terms: ["heatwave", "heat wave", "extreme heat", "garmi ki lehar"]
  },
  {
    predicate: "tsunami_alert",
    harm_category: "hazard_warning",
    action_requested: "move_to_high_ground",
    terms: ["tsunami", "समुद्री लहर"]
  },
  {
    predicate: "health_outbreak_alert",
    harm_category: "public_health",
    action_requested: "follow_health_advisory",
    terms: ["disease outbreak", "outbreak alert", "epidemic", "pandemic", "contagious disease", "mahamari", "bimari"]
  },
  {
    predicate: "public_safety_alert",
    harm_category: "emergency_instruction",
    action_requested: "follow_official_alert",
    terms: ["disaster alert", "official alert", "cap alert", "sachet alert", "emergency alert", "public safety alert"]
  },
  {
    predicate: "emergency_drill_notice",
    harm_category: "public_instruction",
    action_requested: "no_action_required",
    terms: ["drill", "simulation", "simulated emergency", "communications test", "scheduled drill", "exercise notice"]
  },
  {
    predicate: "evacuation_order",
    harm_category: "emergency_instruction",
    action_requested: "evacuate",
    terms: ["empty", "order to leave", "ordered to leave", "order to evacuate"]
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
    terms: [
      "road closed", "roads closed", "road is closed", "roads are closed", "road are closed", "road has been closed",
      "roads have been closed", "closed the road", "bridge closed", "closed to pedestrian", "road blocked",
      "roads blocked", "road is blocked", "traffic blocked", "highway closed", "route closed", "closed nh-",
      "national highway", "nh-", "सड़क बंद", "राजमार्ग बंद", "राष्ट्रीय राजमार्ग", "बंद सड़क"
    ]
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
  const spelling = correctSpelling(text);
  const correctedText = spelling.text;
  const language = options.language || detectLanguage(text);

  if (!text) {
    return {
      original_text,
      normalized_text: text,
      language,
      claims: []
    };
  }

  const segments = splitIntoClaimSegments(correctedText);
  const contextText = options.document_context ? correctedText : null;
  const claims = segments.map((segment, index) => claimFromSegment(segment, language, index, options.location, contextText, spelling.corrections));

  return {
    original_text,
    normalized_text: text,
    corrected_text: correctedText,
    spelling_corrections: spelling.corrections,
    language,
    claims
  };
}

function splitIntoClaimSegments(text) {
  const sentenceSegments = text
    .split(/(?<=[.!?।])\s+|\n+/u)
    .map(normalizeText)
    .filter(Boolean);
  const segments = sentenceSegments.flatMap(splitCompoundSegment).slice(0, 5);
  return segments.length ? segments : [text];
}

function splitCompoundSegment(segment) {
  const pieces = segment
    .split(/\s+(?:and|but|while|और|लेकिन)\s+|;\s*/iu)
    .map(normalizeText)
    .filter(Boolean);
  if (pieces.length < 2) return [segment];

  // Keep ordinary context together, such as "Example City and surrounding areas".
  // Split only when every part contains its own incident signal.
  return pieces.every((piece) => matchingPredicateRule(piece)) ? pieces : [segment];
}

function matchingPredicateRule(segment) {
  return PREDICATE_RULES.find((rule) => includesAny(segment, rule.terms)) ?? null;
}

function claimFromSegment(segment, language, index, locationOverride = null, contextText = null, spellingCorrections = []) {
  const extractionText = contextText || segment;
  const drillRule = PREDICATE_RULES.find((rule) => rule.predicate === "emergency_drill_notice");
  const predicateRule = includesAny(extractionText, drillRule.terms)
    ? drillRule
    : PREDICATE_RULES.find((rule) => includesAny(segment, rule.terms));
  const locationMatch = findLocationDetails(extractionText);
  const location = normalizeLocationOverride(locationOverride) ?? locationMatch?.canonical;
  const time_reference = findTimeReference(extractionText);
  const predicateMatch = predicateRule?.terms.find((term) => includesAny(extractionText, [term])) ?? null;

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
    extraction_method: "deterministic_multilingual_rules_v4_fuzzy_multilingual",
    extraction_signals: {
      predicate_term: predicateMatch,
      location_text: locationOverride ? null : locationMatch?.matched_text ?? null,
      time_text: time_reference === "unspecified" ? null : time_reference,
      spelling_corrections: spellingCorrections
    }
  };
}

function normalizeLocationOverride(location) {
  if (!location) return null;
  const normalized = normalizeText(location).toLowerCase();
  const known = {
    india: "India",
    diu: "Diu",
    "daman & diu": "Daman and Diu",
    "daman and diu": "Daman and Diu",
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
  return findLocationDetails(text)?.canonical ?? null;
}

function findLocationDetails(text) {
  if (/\bspecifically\s+diu\b/i.test(text)) return { canonical: "Diu", matched_text: "Diu" };
  if (/example\s*city/i.test(text)) return { canonical: "Example City", matched_text: text.match(/example\s*city/i)?.[0] };
  for (const candidate of LOCATION_PATTERNS) {
    const matched = candidate.patterns.find((pattern) => pattern.test(text));
    if (matched) {
      return { canonical: candidate.canonical, matched_text: text.match(matched)?.[0] ?? candidate.canonical };
    }
  }
  return null;
}

function findTimeReference(text) {
  const lowered = text.toLowerCase();
  const alertLanguage = /\b(?:alert|warning|advisory)\b/.test(lowered)
    || /\b(?:chetaavni|chetavani)\b/.test(lowered);
  const datedTime = text.match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)\d{4}(?:\s*[^0-9A-Za-z\s]{0,4}\s*\d{1,2}:\d{2}\s*(?:am|pm))?/i);
  if (datedTime) return datedTime[0].replace(/\s+/g, " ").trim();
  if (lowered.includes("tonight") || text.includes("आज रात")) return "tonight";
  if (lowered.includes("today") || text.includes("आज")) return "today";
  if (lowered.includes("tomorrow") || text.includes("कल")) return "tomorrow";
  if (lowered.includes("this week") || text.includes("इस सप्ताह") || text.includes("इस हफ्ते")) return "this week";
  if (lowered.includes("next week") || text.includes("अगले सप्ताह") || text.includes("अगले हफ्ते")) return "next week";
  const currentQuestion = /\b(?:is there|any|current|active|now)\b/.test(lowered)
    || /\b(?:hai\s+kya|kya\s+hai)\b/.test(lowered);
  if (currentQuestion && alertLanguage) return "current";
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
