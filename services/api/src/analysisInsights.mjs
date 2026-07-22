const PREDICATE_LABELS = {
  weather_alert: "weather or hazard alert",
  earthquake_alert: "earthquake alert",
  landslide_alert: "landslide alert",
  wildfire_alert: "wildfire alert",
  heatwave_alert: "heatwave alert",
  tsunami_alert: "tsunami alert",
  health_outbreak_alert: "health-outbreak alert",
  public_safety_alert: "public-safety alert",
  emergency_drill_notice: "emergency drill / simulation notice",
  evacuation_order: "evacuation order",
  boil_water_advisory: "boil-water advisory",
  road_closure: "road closure",
  altered_video_authenticity: "media-authenticity claim",
  relief_shelter_open: "relief-shelter availability",
  private_donation_account: "private donation request",
  chemical_leak: "chemical-leak warning",
  power_shutdown: "power shutdown",
  station_closed: "station closure",
  medical_camp_open: "medical-camp availability",
  food_distribution_open: "food-distribution availability",
  school_closed: "school closure",
  dam_gate_release: "dam-gate release",
  emergency_number: "emergency contact claim",
  unknown_claim: "unclassified crisis claim"
};

const TIME_LABELS = {
  current: "current / now",
  tonight: "tonight",
  today: "today",
  tomorrow: "tomorrow",
  specific_time: "at a stated time",
  unspecified: "with no clear time stated"
};

const MISSING_FIELD_DETAILS = {
  "alert or claim type": {
    label: "incident type",
    explanation: "AEGIS needs to know the incident type: weather, evacuation, road closure, health, media, or another safety issue.",
    action: "focus_claim"
  },
  location: {
    label: "location",
    explanation: "Official alerts are scoped. A city, district, state, Union Territory, or Overall India selection makes the evidence check precise.",
    action: "focus_location"
  },
  time: {
    label: "time",
    explanation: "A current alert can expire quickly. Add today, tonight, a date, or a stated time when the message provides one.",
    action: "focus_claim"
  }
};

export function buildClaimUnderstanding(claim, context = {}) {
  const missingFields = [];
  if (claim.predicate === "unknown_claim") missingFields.push("alert or claim type");
  if (claim.location === "unspecified") missingFields.push("location");
  if (claim.time_reference === "unspecified") missingFields.push("time");

  const locationSource = context.location_override
    ? "user_selected"
    : claim.location === "unspecified"
      ? "missing"
      : "claim_text";
  const languageSource = context.language_override ? "user_selected" : "auto_detected";
  const interpretation = interpretationFor(claim);

  return {
    interpretation,
    fields: {
      claim_type: PREDICATE_LABELS[claim.predicate] ?? claim.predicate,
      predicate: claim.predicate,
      location: claim.location,
      location_source: locationSource,
      time_reference: claim.time_reference,
      time_label: TIME_LABELS[claim.time_reference] ?? claim.time_reference,
      subject: claim.subject,
      harm_category: claim.harm_category,
      action_requested: claim.action_requested,
      language: claim.language,
      language_source: languageSource
    },
    missing_fields: missingFields,
    needs_clarification: missingFields.length > 0,
    clarification_prompt: clarificationPrompt(missingFields),
    missing_field_details: missingFields.map((field) => ({ field, ...MISSING_FIELD_DETAILS[field] })),
    clarification_options: clarificationOptions(missingFields),
    extraction_method: claim.extraction_method,
    extraction_signals: claim.extraction_signals ?? null
  };
}

export function buildDecisionExplanation(claim, comparison) {
  const basis = comparison.verdict === "not_established"
    ? "AEGIS did not find fresh trusted evidence that directly matched both the claim type and location."
    : `AEGIS found fresh trusted evidence whose recorded assertion ${comparison.verdict === "supported" ? "agrees with" : "conflicts with"} the claim.`;

  return {
    verdict: comparison.verdict,
    basis,
    evidence_rule: "A verdict requires a matching claim type, compatible location, and fresh evidence assertion.",
    semantic_score_role: "Semantic and lexical scores rank candidate evidence only; they do not determine whether a claim is true.",
    rationale: comparison.rationale
  };
}

function interpretationFor(claim) {
  const type = PREDICATE_LABELS[claim.predicate] ?? claim.predicate;
  const article = /^[aeiou]/i.test(type) ? "an" : "a";
  const location = claim.location === "unspecified" ? "an unspecified location" : claim.location;
  const time = TIME_LABELS[claim.time_reference] ?? claim.time_reference;
  return `A claim about ${article} ${type} concerning ${location}, ${time}.`;
}

function clarificationPrompt(missingFields) {
  if (missingFields.includes("alert or claim type") && missingFields.includes("location") && missingFields.includes("time")) {
    return "What kind of incident is this, which city, district, or state is it about, and when does it apply?";
  }
  if (missingFields.includes("alert or claim type") && missingFields.includes("location")) {
    return "What kind of incident are you checking, and which city, district, or state is it about?";
  }
  if (missingFields.includes("alert or claim type")) {
    return "What kind of incident or official instruction are you checking?";
  }
  if (missingFields.includes("location")) {
    return "Which city, district, or state should AEGIS check?";
  }
  if (missingFields.includes("time")) {
    return "Add a date or time if the claim is about a current alert.";
  }
  return null;
}

function clarificationOptions(missingFields) {
  return missingFields
    .map((field) => MISSING_FIELD_DETAILS[field])
    .filter(Boolean)
    .map((detail) => ({
      action: detail.action,
      label: detail.action === "focus_location" ? "Choose a location" : `Add ${detail.label}`,
      target: detail.action === "focus_location" ? "location" : "claim-text"
    }));
}
