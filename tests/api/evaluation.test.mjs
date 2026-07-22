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
