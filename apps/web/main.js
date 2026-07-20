const button = document.querySelector("#analyze");
const text = document.querySelector("#claim-text");
const language = document.querySelector("#language");
const locationScope = document.querySelector("#location");
const result = document.querySelector("#result");
const demoScenarios = document.querySelector("#demo-scenarios");
const apiBase = window.location.protocol === "file:" ? "http://localhost:8787" : "";

loadDemoScenarios();

button.addEventListener("click", async () => {
  result.textContent = "Analyzing...";
  try {
    const response = await fetch(`${apiBase}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: text.value,
        language: language.value || undefined,
        location: locationScope.value || undefined,
        analysis_at: "2026-07-20T18:00:00+05:30"
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analysis failed");
    renderResult(data);
  } catch (error) {
    result.innerHTML = `
      <p class="error">${escapeHtml(error.message)}</p>
      <p>Start the local app with <code>npm run api</code>, then open <code>http://localhost:8787</code>.</p>
    `;
  }
});

function renderResult(data) {
  const claim = data.claims[0];
  result.innerHTML = `
    ${renderSourceFetch(data.source_fetch)}
    ${renderModelStatus(data)}
    <div class="verdict ${claim.verdict}">${claim.verdict}</div>
    <p><strong>Extracted claim:</strong> ${escapeHtml(claim.claim.text)}</p>
    <p><strong>Location scope:</strong> ${escapeHtml(claim.claim.location)}</p>
    <p><strong>Rationale:</strong> ${escapeHtml(claim.rationale)}</p>
    <p><strong>Confidence:</strong> ${escapeHtml(claim.confidence_band)} (${claim.confidence_score})</p>
    <p><strong>Retrieval method:</strong> ${escapeHtml(claim.retrieval_method || data.retrieval?.method || "unknown")}</p>
    <h3>Evidence</h3>
    ${claim.evidence.length ? claim.evidence.map(renderEvidence).join("") : "<p>No directly establishing evidence found.</p>"}
    <h3>Safe action</h3>
    <p>${escapeHtml(claim.safety_note)}</p>
    <details>
      <summary>AI pipeline used</summary>
      <ul>${data.model.components.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </details>
  `;
}

async function loadDemoScenarios() {
  try {
    const response = await fetch(`${apiBase}/demo/scenarios`);
    const data = await response.json();
    demoScenarios.innerHTML = `
      <p class="demo-label">Try a scenario:</p>
      ${data.scenarios.map((scenario) => `
        <button class="secondary" type="button" data-scenario="${escapeHtml(scenario.id)}">${escapeHtml(scenario.label)}</button>
      `).join("")}
    `;
    for (const scenarioButton of demoScenarios.querySelectorAll("button")) {
      scenarioButton.addEventListener("click", () => {
        const scenario = data.scenarios.find((item) => item.id === scenarioButton.dataset.scenario);
        if (scenario) {
          text.value = scenario.text;
          locationScope.value = scenario.location || "";
        }
      });
    }
  } catch {
    demoScenarios.innerHTML = "";
  }
}

function renderSourceFetch(sourceFetch) {
  if (!sourceFetch) return "";
  const statuses = sourceFetch.statuses || [];
  const summary = sourceFetch.enabled
    ? `Live trusted-source fetch enabled. ${sourceFetch.live_record_count} live records available; ${sourceFetch.fixture_record_count} fixture fallback records loaded.`
    : `Live trusted-source fetch disabled. ${sourceFetch.fixture_record_count} fixture records loaded.`;
  return `
    <section class="source-status" aria-label="Source fetch status">
      <p><strong>Source status:</strong> ${escapeHtml(summary)}</p>
      ${statuses.map((status) => `
        <p>
          ${escapeHtml(status.source_name)}:
          <span class="${status.status === "ok" ? "ok" : "error"}">${escapeHtml(status.status)}</span>
          ${status.error ? ` — ${escapeHtml(status.error)}` : ""}
        </p>
      `).join("")}
    </section>
  `;
}

function renderModelStatus(data) {
  const embedding = data.retrieval?.embedding;
  if (!embedding) return "";
  const status = embedding.fallback_used
    ? "Local AI embeddings unavailable; lexical fallback used."
    : `Local AI semantic retrieval enabled with ${embedding.model}.`;
  return `
    <section class="source-status" aria-label="Local AI status">
      <p><strong>AI status:</strong> ${escapeHtml(status)}</p>
      <p><strong>Provider:</strong> ${escapeHtml(embedding.provider || "local_transformers_js")}</p>
    </section>
  `;
}

function renderEvidence(item) {
  return `
    <article class="evidence">
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.body)}</p>
      <p>
        Source: <a href="${escapeHtml(item.source_url)}">${escapeHtml(item.source_name)}</a><br />
        Published: ${escapeHtml(item.published_at)}<br />
        Origin: ${escapeHtml(item.evidence_origin)}
      </p>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
