import test from "node:test";
import assert from "node:assert/strict";
import { extractClaims } from "../../services/api/src/claimExtractor.mjs";

const evaluationCases = [
  {
    name: "corrects misspelled flood alert",
    text: "Is there a fllod alret in Hyderabad?",
    predicate: "weather_alert",
    location: "Hyderabad",
    time_reference: "current"
  },
  {
    name: "understands Hinglish rain question",
    text: "Diu mein baarish ka alert hai kya?",
    predicate: "weather_alert",
    location: "Diu",
    time_reference: "current"
  },
  {
    name: "classifies earthquake warning",
    text: "Is there an earthquake warning in Assam?",
    predicate: "earthquake_alert",
    location: "Assam",
    time_reference: "current"
  },
  {
    name: "classifies landslide alert with date cue",
    text: "Uttarakhand landslide alert today",
    predicate: "landslide_alert",
    location: "Uttarakhand",
    time_reference: "today"
  },
  {
    name: "classifies evacuation order",
    text: "Is there an evacuation order in Ladakh tonight?",
    predicate: "evacuation_order",
    location: "Ladakh",
    time_reference: "tonight"
  },
  {
    name: "understands a Hindi evacuation question without translation drift",
    text: "\u0915\u094d\u092f\u093e \u0905\u0938\u092e \u092e\u0947\u0902 \u0906\u091c \u0928\u093f\u0915\u093e\u0938\u0940 \u0906\u0926\u0947\u0936 \u091c\u093e\u0930\u0940 \u0939\u0941\u0906 \u0939\u0948?",
    predicate: "evacuation_order",
    location: "Assam",
    time_reference: "today"
  },
  {
    name: "captures a relative week reference",
    text: "Is there a Delhi heatwave warning this week?",
    predicate: "heatwave_alert",
    location: "Delhi",
    time_reference: "this week"
  },
  {
    name: "does not invent an incident type",
    text: "Please check this message from a group chat.",
    predicate: "unknown_claim",
    location: "unspecified",
    time_reference: "unspecified"
  }
];

test("AI extraction evaluation cases remain within expected fields", () => {
  for (const expected of evaluationCases) {
    const claim = extractClaims(expected.text).claims[0];
    assert.equal(claim.predicate, expected.predicate, expected.name);
    assert.equal(claim.location, expected.location, expected.name);
    assert.equal(claim.time_reference, expected.time_reference, expected.name);
  }
});

test("splits two independently located claims joined by and", () => {
  const claims = extractClaims("There is a flood in Patna and roads are closed in Ranchi.").claims;
  assert.equal(claims.length, 2);
  assert.equal(claims[0].predicate, "weather_alert");
  assert.equal(claims[0].location, "Patna");
  assert.equal(claims[1].predicate, "road_closure");
  assert.equal(claims[1].location, "Ranchi");
});

test("classifies a national-highway closure near Jammu", () => {
  const claim = extractClaims("The government has closed NH-44 near Jammu today.").claims[0];
  assert.equal(claim.predicate, "road_closure");
  assert.equal(claim.location, "Jammu");
  assert.equal(claim.time_reference, "today");
});
