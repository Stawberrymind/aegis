import { analyzeSubmission } from "./pipeline.mjs";

const text = process.argv.slice(2).join(" ") || "Sector 4 evacuation ordered tonight. Leave before 9 PM.";
const result = await analyzeSubmission({
  text,
  location: process.env.AEGIS_DEMO_LOCATION,
  analysis_at: "2026-07-20T18:00:00+05:30"
});

console.log(JSON.stringify(result, null, 2));
