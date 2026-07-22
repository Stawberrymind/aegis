import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/analyze", async (route) => {
    const request = route.request().postDataJSON() ?? {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(makeAnalysis(request)) });
  });
  await page.goto("/");
});

test("submits a claim, scopes the location, and renders the timeline", async ({ page }) => {
  const request = page.waitForRequest("**/analyze");
  await page.locator("#claim-text").fill("Is there a flood alert?");
  await page.getByRole("button", { name: "Continue to context" }).click();
  await page.locator("#location").selectOption("Hyderabad");
  await page.getByRole("button", { name: "Check this claim" }).click();
  const sent = await request;

  expect(sent.postDataJSON().location).toBe("Hyderabad");
  await expect(page.locator("#result")).toContainText("Supported");
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.locator("#timeline-heading")).toContainText("What happened to this claim");
  await expect(page.locator(".timeline-step")).toHaveCount(4);
  await page.getByRole("tab", { name: "Understanding" }).click();
  await expect(page.locator("#basic-understanding-heading")).toBeVisible();
});

test("shows OCR output and switches between Normal and Expert detail", async ({ page }) => {
  await page.getByRole("tab", { name: "Upload image" }).click();
  await page.locator("#claim-image").setInputFiles({
    name: "alert.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image-for-mocked-ui")
  });
  await expect(page.locator("#image-preview")).toBeVisible();
  await page.getByRole("button", { name: "Continue to context" }).click();
  await page.getByRole("button", { name: "Check this claim" }).click();

  await expect(page.locator("#result")).toContainText("Image checked locally");
  await page.getByRole("tab", { name: "Understanding" }).click();
  await page.getByRole("button", { name: "Expert" }).click();
  await expect(page.locator('[data-result-panel="understanding"] #media-heading')).toBeVisible();
  await page.getByRole("tab", { name: "Evidence" }).click();
  await expect(page.locator('[data-result-panel="evidence"] #matches-heading')).toBeVisible();
  await page.getByRole("button", { name: "Normal" }).click();
  await expect(page.locator("#basic-evidence-heading")).toBeVisible();
});

test("keeps the mobile submit flow usable and exposes accessible controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Forwarded message or public-safety claim")).toBeVisible();
  await page.getByLabel("Forwarded message or public-safety claim").fill("Is there a rain alert in Diu?");
  await page.getByRole("button", { name: "Continue to context" }).click();
  await expect(page.getByLabel("Language")).toBeVisible();
  await expect(page.getByLabel("Location to check")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check this claim" })).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(horizontalOverflow).toBe(false);
});

function makeAnalysis(request) {
  const hasImage = Boolean(request.image?.data);
  return {
    analysis_id: "analysis-browser-test",
    analyzed_at: "2026-07-22T12:00:00.000Z",
    input: { input_type: hasImage ? "image" : "text", original_text: request.text || "OCR flood alert for Hyderabad", normalized_text: request.text || "OCR flood alert for Hyderabad", language: request.language || "en", location_override: request.location || null },
    media: hasImage ? {
      ocr: { status: "completed", text: "Flood alert for Hyderabad today", confidence: 94, quality: "high" },
      provenance: { status: "not_detected", interpretation: "No provenance signal. This does not prove the image is false.", openai_verify_url: "https://openai.com/research/verify/" }
    } : null,
    audio: null,
    translation: { status: "not_needed", source_language: "en", text: request.text || "" },
    source_fetch: { live_evidence_available: true, live_record_count: 1, cache_fallback_record_count: 0, statuses: [{ source_name: "Mock official source", status: "ok", record_count: 1 }] },
    retrieval: { method: "lexical_fallback", embedding: { fallback_used: true } },
    structured_extraction: { loaded: false, fallback_used: true },
    claims: [{
      claim: { predicate: "flood_alert", location: request.location || "Hyderabad", time_reference: "current", harm_category: "hazard_warning", action_requested: "follow_weather_advisory", extraction_method: "deterministic" },
      verdict: "supported",
      confidence_band: "high",
      rationale: "A current official source directly supports this scoped alert.",
      evidence: [{ id: "mock-evidence-1", title: "Official flood warning for Hyderabad", body: "Flood warning is active for Hyderabad today.", source_name: "Mock official source", source_url: "https://example.gov/alert", published_at: "2026-07-22T10:00:00.000Z", evidence_origin: "live_fetch", staleness: { is_stale: false } }],
      stale_evidence: [],
      ai_analysis: {
        understanding: { interpretation: "A flood alert for Hyderabad now.", needs_clarification: false, fields: { claim_type: "weather or hazard alert", location: "Hyderabad", time: "current", requested_action: "follow weather advisory", risk_category: "hazard warning", language: "EN", location_source: "user_selected" }, missing_fields: [] },
        evidence_search: { records_checked: 1, sources_checked_count: 1, source_diversity: 1, sources_checked: [{ name: "Mock official source", origin: "live_fetch" }], matches: [], score_disclaimer: "Scores are ranking signals, not probabilities." },
        decision: { semantic_score_role: "Similarity scores help rank records but do not determine the verdict." }
      }
    }],
    disclaimers: ["AEGIS does not replace official emergency services."]
  };
}
