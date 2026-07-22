const button = document.querySelector("#analyze");
const text = document.querySelector("#claim-text");
const image = document.querySelector("#claim-image");
const audio = document.querySelector("#claim-audio");
const language = document.querySelector("#language");
const locationScope = document.querySelector("#location");
const result = document.querySelector("#result");
const resultCard = document.querySelector(".result-card");
const charCount = document.querySelector("#char-count");
const clearClaim = document.querySelector("#clear-claim");
const imagePreview = document.querySelector("#image-preview");
const audioPreview = document.querySelector("#audio-preview");
const viewModeHelp = document.querySelector("#view-mode-help");
const submitCard = document.querySelector(".submit-card");
const progressCard = document.querySelector("#analysis-progress");
const wizardStepper = document.querySelector("#wizard-stepper");
const resultTabs = document.querySelector("#result-tabs");
const apiBase = window.location.protocol === "file:" ? "http://localhost:8787" : "";
let imagePreviewUrl = null;
let viewMode = "normal";
let latestAnalysis = null;
let wizardStep = 1;
let resultTab = "answer";
let inputMode = "text";
let progressTimer = null;

button.addEventListener("click", analyzeClaim);
result.addEventListener("click", handleClarificationAction);
resultTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-result-tab]");
  if (tab) setResultTab(tab.dataset.resultTab);
});
resultTabs.addEventListener("keydown", (event) => {
  const tabs = [...resultTabs.querySelectorAll('[role="tab"]')].filter((tab) => !tab.hidden);
  const current = tabs.indexOf(event.target.closest('[role="tab"]'));
  if (current < 0 || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (current + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
  setResultTab(tabs[next].dataset.resultTab);
  tabs[next].focus();
});
wizardStepper.addEventListener("click", (event) => {
  const control = event.target.closest("[data-wizard-target]");
  const target = Number(control?.dataset.wizardTarget);
  if (target && target <= 2) setWizardStep(target);
});
document.querySelectorAll("[data-view-mode]").forEach((control) => {
  control.addEventListener("click", () => setViewMode(control.dataset.viewMode));
});
text.addEventListener("input", updateCharacterCount);
clearClaim.addEventListener("click", clearClaimText);
image.addEventListener("change", renderImageSelection);
audio.addEventListener("change", renderAudioSelection);
imagePreview.addEventListener("click", (event) => {
  if (event.target.closest("[data-remove-image]")) clearSelectedImage();
});
document.querySelectorAll("[data-example]").forEach((example) => {
  example.addEventListener("click", () => {
    text.value = example.dataset.example || "";
    if (example.dataset.exampleLocation) locationScope.value = example.dataset.exampleLocation;
    updateCharacterCount();
    text.focus();
  });
});

setupWizard();
updateCharacterCount();

function setupWizard() {
  const claimLabel = submitCard.querySelector('label[for="claim-text"]');
  const composerTools = submitCard.querySelector(".composer-tools");
  const exampleStrip = submitCard.querySelector(".example-strip");
  const mediaBlocks = [...submitCard.querySelectorAll(".media-upload")];
  const formGrid = submitCard.querySelector(".form-grid");
  const liveNote = submitCard.querySelector(".live-only-note");
  const privacy = submitCard.querySelector(".privacy");
  const stepOne = document.createElement("div");
  const stepTwo = document.createElement("div");
  stepOne.className = "wizard-pane";
  stepTwo.className = "wizard-pane";
  stepOne.dataset.wizardPane = "1";
  stepTwo.dataset.wizardPane = "2";

  const methodSwitch = document.createElement("div");
  methodSwitch.className = "input-method-switch";
  methodSwitch.setAttribute("role", "tablist");
  methodSwitch.setAttribute("aria-label", "Choose claim input type");
  for (const [value, label] of [["text", "Type or paste"], ["image", "Upload image"], ["audio", "Voice note"]]) {
    const control = document.createElement("button");
    control.type = "button";
    control.dataset.inputMode = value;
    control.setAttribute("role", "tab");
    control.textContent = label;
    control.addEventListener("click", () => setInputMode(value));
    methodSwitch.append(control);
  }

  const textPanel = document.createElement("div");
  textPanel.className = "input-panel";
  textPanel.dataset.inputPanel = "text";
  textPanel.append(claimLabel, text, composerTools, exampleStrip);
  const imagePanel = document.createElement("div");
  imagePanel.className = "input-panel";
  imagePanel.dataset.inputPanel = "image";
  imagePanel.append(mediaBlocks[0]);
  const audioPanel = document.createElement("div");
  audioPanel.className = "input-panel";
  audioPanel.dataset.inputPanel = "audio";
  audioPanel.append(mediaBlocks[1]);

  const stepOneHeading = document.createElement("div");
  stepOneHeading.className = "wizard-heading";
  stepOneHeading.innerHTML = '<p class="step-label">Step 1 · Add claim</p><h2 id="submit-heading">What should AEGIS check?</h2><p>Paste the forwarded message, or choose an image or voice note.</p>';
  if (privacy) {
    const privacyNote = document.createElement("span");
    privacyNote.className = "wizard-privacy";
    privacyNote.textContent = privacy.textContent;
    stepOneHeading.append(privacyNote);
  }
  stepOne.append(stepOneHeading, methodSwitch, textPanel, imagePanel, audioPanel);
  const continueButton = document.createElement("button");
  continueButton.type = "button";
  continueButton.className = "wizard-next-button";
  continueButton.textContent = "Continue to context";
  continueButton.addEventListener("click", () => {
    if (!hasSubmission()) {
      showStepError("Add a message, image, or voice note before continuing.");
      return;
    }
    clearStepError();
    updateContextPreview();
    setWizardStep(2);
  });
  stepOne.append(continueButton);

  const contextHeading = document.createElement("div");
  contextHeading.className = "wizard-heading";
  contextHeading.innerHTML = '<p class="step-label">Step 2 · Set context</p><h2>Where and in which language?</h2><p>These choices help AEGIS check the exact scope of the claim.</p>';
  const contextPreview = document.createElement("div");
  contextPreview.id = "context-preview";
  contextPreview.className = "context-preview";
  const contextActions = document.createElement("div");
  contextActions.className = "wizard-actions";
  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "secondary-button";
  backButton.textContent = "Back";
  backButton.addEventListener("click", () => setWizardStep(1));
  contextActions.append(backButton, button);
  stepTwo.append(contextHeading, contextPreview, formGrid, liveNote, contextActions);

  submitCard.replaceChildren(stepOne, stepTwo);
  setInputMode("text");
  setWizardStep(1);
  text.addEventListener("input", updateContextPreview);
  locationScope.addEventListener("change", updateContextPreview);
}

function hasSubmission() {
  return Boolean(text.value.trim() || image.files.length || audio.files.length);
}

function setInputMode(mode) {
  inputMode = ["text", "image", "audio"].includes(mode) ? mode : "text";
  document.querySelectorAll("[data-input-mode]").forEach((control) => {
    const active = control.dataset.inputMode === inputMode;
    control.classList.toggle("active", active);
    control.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-input-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.inputPanel !== inputMode;
  });
}

function updateContextPreview() {
  const preview = document.querySelector("#context-preview");
  if (!preview) return;
  const source = text.value.trim() || (image.files.length ? `Image · ${image.files[0].name}` : audio.files.length ? `Voice note · ${audio.files[0].name}` : "No claim added yet");
  preview.innerHTML = `<span>Claim to check</span><strong>${escapeHtml(source.slice(0, 180))}${source.length > 180 ? "…" : ""}</strong><small>${escapeHtml(locationScope.value || "Location will be read from the claim")} · ${escapeHtml(language.options[language.selectedIndex]?.text || "Auto detect")}</small>`;
}

function showStepError(message, pane = wizardStep === 1 ? 1 : 2) {
  clearStepError();
  const error = document.createElement("p");
  error.className = "step-error";
  error.id = "wizard-error";
  error.setAttribute("role", "alert");
  error.textContent = message;
  submitCard.querySelector(`[data-wizard-pane="${pane}"]`)?.append(error);
}

function clearStepError() {
  document.querySelector("#wizard-error")?.remove();
}

function setWizardStep(step) {
  wizardStep = Math.max(1, Math.min(4, Number(step) || 1));
  document.querySelectorAll("[data-wizard-pane]").forEach((pane) => {
    pane.hidden = Number(pane.dataset.wizardPane) !== wizardStep;
  });
  submitCard.hidden = wizardStep >= 3;
  progressCard.hidden = wizardStep !== 3;
  resultCard.classList.toggle("is-hidden", wizardStep !== 4);
  document.body.classList.toggle("has-result", wizardStep === 4);
  wizardStepper.querySelectorAll("[data-wizard-target]").forEach((control) => {
    const target = Number(control.dataset.wizardTarget);
    control.classList.toggle("active", target === wizardStep);
    control.classList.toggle("complete", target < wizardStep);
    if (target === wizardStep) control.setAttribute("aria-current", "step");
    else control.removeAttribute("aria-current");
  });
  if (wizardStep === 3) startProgressAnimation();
  else stopProgressAnimation();
  if (wizardStep === 2) updateContextPreview();
}

function startProgressAnimation() {
  stopProgressAnimation();
  let index = 0;
  const stages = [...document.querySelectorAll("[data-progress-stage]")];
  const update = () => stages.forEach((stage, stageIndex) => stage.classList.toggle("active", stageIndex === index));
  update();
  progressTimer = window.setInterval(() => { index = (index + 1) % stages.length; update(); }, 900);
}

function stopProgressAnimation() {
  if (progressTimer) window.clearInterval(progressTimer);
  progressTimer = null;
}

function updateCharacterCount() {
  const count = text.value.length;
  charCount.textContent = `${count.toLocaleString()} character${count === 1 ? "" : "s"}`;
}

function clearClaimText() {
  text.value = "";
  updateCharacterCount();
  text.focus();
}

function renderImageSelection() {
  const file = image.files[0];
  if (!file) {
    clearSelectedImage();
    return;
  }
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  imagePreviewUrl = URL.createObjectURL(file);
  imagePreview.hidden = false;
  imagePreview.innerHTML = `
    <img src="${escapeHtml(imagePreviewUrl)}" alt="Preview of selected claim image" />
    <div class="image-preview-info"><strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(formatBytes(file.size))} · Ready for local OCR</span></div>
    <button class="remove-image" type="button" data-remove-image>Remove</button>
  `;
}

function clearSelectedImage() {
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  imagePreviewUrl = null;
  image.value = "";
  imagePreview.hidden = true;
  imagePreview.innerHTML = "";
}

function renderAudioSelection() {
  const file = audio.files[0];
  if (!file) {
    audioPreview.hidden = true;
    audioPreview.innerHTML = "";
    return;
  }
  audioPreview.hidden = false;
  audioPreview.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(formatBytes(file.size))} · Ready for local transcription</span>`;
}

function handleClarificationAction(event) {
  const control = event.target.closest("[data-clarification-action]");
  if (!control) return;
  const target = control.dataset.clarificationTarget === "location" ? locationScope : text;
  target.focus();
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  if (target === text) target.setSelectionRange(text.value.length, text.value.length);
}

function setViewMode(mode) {
  viewMode = mode === "expert" ? "expert" : "normal";
  document.querySelectorAll("[data-view-mode]").forEach((control) => {
    const active = control.dataset.viewMode === viewMode;
    control.classList.toggle("active", active);
    control.setAttribute("aria-pressed", String(active));
  });
  viewModeHelp.textContent = viewMode === "expert"
    ? "All extraction, retrieval, source, and provenance detail."
    : "Essential answer and next action.";
  if (latestAnalysis) renderResult(latestAnalysis);
}

function setResultTab(tab) {
  const allowedTabs = ["answer", "understanding", "evidence", "timeline", "technical"];
  resultTab = allowedTabs.includes(tab) ? tab : "answer";
  if (resultTab === "technical" && viewMode !== "expert") resultTab = "answer";
  resultTabs.querySelectorAll("[data-result-tab]").forEach((control) => {
    const active = control.dataset.resultTab === resultTab;
    control.hidden = control.hasAttribute("data-expert-only") && viewMode !== "expert";
    control.setAttribute("aria-selected", String(active));
    control.setAttribute("aria-controls", `result-panel-${control.dataset.resultTab}`);
    control.tabIndex = active ? 0 : -1;
  });
  result.querySelectorAll("[data-result-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.resultPanel !== resultTab;
  });
}

async function analyzeClaim() {
  if (!hasSubmission()) {
    setWizardStep(1);
    showStepError("Add a message, image, or voice note before checking.");
    text.focus();
    return;
  }

  clearStepError();
  setWizardStep(3);
  setLoading(true);

  try {
    const imagePayload = image.files.length ? await readImage(image.files[0]) : undefined;
    const audioPayload = audio.files.length ? await readAudio(audio.files[0]) : undefined;
    const response = await fetch(`${apiBase}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: text.value,
        image: imagePayload,
        audio: audioPayload,
        language: language.value || undefined,
        location: locationScope.value || undefined
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Analysis failed");
      error.status = response.status;
      error.code = data.code;
      error.retryAfter = response.headers.get("retry-after");
      throw error;
    }
    renderResult(data);
  } catch (error) {
    const message = friendlyErrorMessage(error);
    setWizardStep(2);
    showStepError(`AEGIS could not complete the analysis. ${message}`);
  } finally {
    setLoading(false);
  }
}

function friendlyErrorMessage(error) {
  if (error?.status === 429) return `Too many analyses in a short period. Try again${error.retryAfter ? ` in ${error.retryAfter} seconds` : " shortly"}.`;
  if (error?.status === 413) return "The upload is too large. Choose a smaller image or voice note.";
  if (error?.status === 400) return error.message || "The submitted claim or media could not be read.";
  if (error?.code === "internal_error") return "The local service encountered an internal error. Review the terminal for the operator-safe diagnostic.";
  if (error instanceof TypeError) return "AEGIS could not reach the local service. Start it with npm run api, then use http://localhost:8787.";
  return error?.message || "Analysis failed. Try again.";
}

function setLoading(loading) {
  button.disabled = loading;
  button.textContent = loading ? "Checking…" : "Check this claim";
  wizardStepper.querySelectorAll("[data-wizard-target]").forEach((control) => { control.disabled = loading; });
  resultCard.setAttribute("aria-busy", String(loading));
}

function renderResult(data) {
  latestAnalysis = data;
  result.className = "analysis-result";
  const claims = data.claims || [];
  result.innerHTML = `
    <section id="result-panel-answer" class="result-panel" data-result-panel="answer" role="tabpanel" tabindex="0" aria-labelledby="result-tab-answer answer-heading">
      <div class="result-panel-intro"><p class="mini-label">Normal mode</p><h3 id="answer-heading">The clearest answer first</h3><p>Use this view to decide what to do next. Open the other sections when you need the reasoning.</p></div>
      ${claims.map((claim, index) => renderAnswerClaim(claim, index, claims.length)).join("")}
      ${renderDisclaimer(data)}
    </section>
    <section id="result-panel-understanding" class="result-panel" data-result-panel="understanding" role="tabpanel" tabindex="0" aria-labelledby="result-tab-understanding understanding-tab-heading" hidden>
      <div class="result-panel-intro"><p class="mini-label">Interpretation</p><h3 id="understanding-tab-heading">What AEGIS understood</h3><p>AI extracts the incident, place, time, action, and language before evidence is compared.</p></div>
      ${renderMedia(data.media, viewMode)}
      ${renderAudioResult(data.audio, viewMode)}
      ${claims.map((claim) => viewMode === "expert" ? renderUnderstanding(claim.ai_analysis?.understanding, claim.claim) : renderBasicUnderstanding(claim.ai_analysis?.understanding, claim.claim)).join("")}
    </section>
    <section id="result-panel-evidence" class="result-panel" data-result-panel="evidence" role="tabpanel" tabindex="0" aria-labelledby="result-tab-evidence evidence-tab-heading" hidden>
      <div class="result-panel-intro"><p class="mini-label">Trusted sources</p><h3 id="evidence-tab-heading">Evidence and source comparison</h3><p>Only records that pass the type, location, freshness, and provenance rules can establish a verdict.</p></div>
      ${renderSourceFetch(data.source_fetch)}
      ${claims.map((claim, index) => renderEvidenceTab(claim, index, data.translation)).join("")}
    </section>
    <section id="result-panel-timeline" class="result-panel" data-result-panel="timeline" role="tabpanel" tabindex="0" aria-labelledby="result-tab-timeline timeline-tab-heading" hidden>
      <div class="result-panel-intro"><p class="mini-label">Process trace</p><h3 id="timeline-tab-heading">How AEGIS reached the result</h3><p>Follow the check from submission through interpretation, trusted-source retrieval, and the final evidence rule.</p></div>
      ${renderTimeline(data)}
    </section>
    <section id="result-panel-technical" class="result-panel" data-result-panel="technical" role="tabpanel" tabindex="0" aria-labelledby="result-tab-technical technical-tab-heading" hidden>
      <div class="result-panel-intro"><p class="mini-label">Expert mode</p><h3 id="technical-tab-heading">Full extraction, retrieval, and policy detail</h3><p>Scores are ranking signals only. The verdict remains evidence-linked and policy constrained.</p></div>
      ${renderMedia(data.media, "expert")}
      ${renderAudioResult(data.audio, "expert")}
      ${claims.map((claim, index) => renderClaim(claim, index, claims.length, data.translation, "expert")).join("")}
      ${renderDisclaimer(data)}
    </section>
  `;
  setWizardStep(4);
  setResultTab(resultTab);
}

function renderAnswerClaim(claim, index, totalClaims) {
  const item = claim.evidence?.[0];
  const understanding = claim.ai_analysis?.understanding;
  const location = understanding?.fields?.location || claim.claim?.location || "the selected scope";
  return `
    <article class="answer-claim">
      ${totalClaims > 1 ? `<p class="claim-number">Claim ${index + 1} of ${totalClaims}</p>` : ""}
      <section class="verdict-panel ${escapeHtml(claim.verdict)}">
        <div><p class="verdict-kicker">Evidence verdict</p><p class="verdict">${escapeHtml(humanize(claim.verdict))}</p></div>
        <div class="confidence"><span>Evidence confidence</span><strong>${escapeHtml(humanize(claim.confidence_band))}</strong><small>${Number.isFinite(claim.confidence_score) ? `${Math.round(claim.confidence_score * 100)}% policy score` : "Policy score unavailable"}</small></div>
      </section>
      <div class="answer-rationale"><p class="mini-label">In plain language</p><p>${escapeHtml(claim.rationale || `AEGIS found no clear conclusion for ${location}.`)}</p><small>Scope checked: ${escapeHtml(location)}</small></div>
      <section class="safe-action"><span aria-hidden="true">!</span><div><p class="mini-label">Recommended safe action</p><p>${escapeHtml(claim.safety_note || "Verify with the relevant official authority before acting or forwarding.")}</p></div></section>
      ${item ? `<div class="answer-source"><span class="origin-tag">${escapeHtml(humanize(item.evidence_origin))}</span><div><strong>Evidence used</strong><p>${escapeHtml(item.title)} · ${escapeHtml(item.source_name)}</p></div>${renderSourceLink(item)}</div>` : `<div class="neutral-callout"><strong>No single source established this claim.</strong><p>Open Evidence to see what was checked and why related records may not count.</p></div>`}
    </article>
  `;
}

function renderEvidenceTab(claim, index, translation) {
  const search = claim.ai_analysis?.evidence_search;
  return `
    <section class="evidence-tab-section" aria-labelledby="evidence-claim-${index}">
      ${claim.claim?.location || claim.claim?.predicate ? `<h4 id="evidence-claim-${index}">${escapeHtml(humanize(claim.claim?.predicate || "Claim"))}${claim.claim?.location ? ` · ${escapeHtml(claim.claim.location)}` : ""}</h4>` : ""}
      ${viewMode === "expert" ? renderEvidenceSearch(search, translation) : renderBasicEvidenceSearch(search, translation)}
      <div class="evidence-list">${claim.evidence?.length ? claim.evidence.map(renderEvidence).join("") : `<div class="neutral-callout"><strong>No evidence passed the verification rules.</strong><p>Related records can still be useful context, but they do not establish this claim.</p></div>`}</div>
    </section>
  `;
}

function renderDisclaimer(data) {
  const disclaimers = data.disclaimers || [];
  if (!disclaimers.length) return "";
  return `<div class="disclaimer-box"><strong>Important limitations</strong><ul>${disclaimers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
}

function renderTimeline(data) {
  const first = data.claims?.[0];
  const understanding = first?.ai_analysis?.understanding;
  const search = first?.ai_analysis?.evidence_search;
  const verdict = first?.verdict;
  const sourceCount = search?.source_consensus?.publisher_count ?? data.source_fetch?.live_record_count ?? 0;
  const sourceLabel = sourceCount ? `${sourceCount} trusted publisher${sourceCount === 1 ? "" : "s"} represented` : "No live publisher returned a usable record";
  const submittedLabel = data.input?.input_type === "image"
    ? "Image received for local OCR"
    : data.input?.input_type === "voice"
      ? "Voice note received for local transcription"
      : "Claim received from the user";
  const steps = [
    { label: "Submitted", detail: submittedLabel, status: "complete" },
    { label: "AI understood", detail: understanding?.interpretation || "Structured fields extracted from the submission.", status: understanding?.needs_clarification ? "attention" : "complete" },
    { label: "Trusted evidence checked", detail: sourceLabel, status: sourceCount ? "complete" : "attention" },
    { label: verdict ? humanize(verdict) : "Awaiting verdict", detail: verdict ? (first?.rationale || "Evidence rules completed the comparison.") : "The analysis is still being prepared.", status: verdict ? verdict : "pending" }
  ];
  return `
    <section class="timeline-panel" aria-labelledby="timeline-heading">
      <div class="timeline-heading"><div><p class="mini-label">Analysis timeline</p><h3 id="timeline-heading">What happened to this claim</h3></div><small>${escapeHtml(formatDate(data.analyzed_at))}</small></div>
      <ol class="analysis-timeline">${steps.map((step, index) => `
        <li class="timeline-step ${escapeHtml(step.status)}">
          <span class="timeline-marker">${index + 1}</span>
          <div><strong>${escapeHtml(step.label)}</strong><p>${escapeHtml(step.detail)}</p></div>
        </li>`).join("")}</ol>
    </section>
  `;
}

function renderMedia(media, mode = "expert") {
  if (!media) return "";
  const ocr = media.ocr || {};
  const provenance = media.provenance || {};
  if (mode !== "expert") {
    return `
      <section class="media-summary" aria-label="Media check summary">
        <span class="media-summary-icon">M</span>
        <div><strong>Image checked locally</strong><p>OCR: ${escapeHtml(humanize(ocr.status))}${ocr.quality ? ` · ${escapeHtml(humanize(ocr.quality))} quality` : ""}. Provenance was inspected as a signal, not an authenticity verdict.</p></div>
        <span class="media-summary-link">Expert mode has details</span>
      </section>
    `;
  }
  return `
    <section class="analysis-section media-analysis" aria-labelledby="media-heading">
      <div class="section-title-row"><span class="number-badge">M</span><div><p class="mini-label">Media inspection</p><h3 id="media-heading">OCR and provenance signals</h3></div></div>
      <div class="media-grid">
        <div><strong>OCR</strong><span>${escapeHtml(humanize(ocr.status))}${ocr.quality ? ` · ${escapeHtml(humanize(ocr.quality))} quality` : ""}</span><small>${escapeHtml(ocr.text || "No readable text found")}${ocr.confidence !== null && ocr.confidence !== undefined ? ` · ${ocr.confidence}% confidence` : ""}</small></div>
        <div><strong>AI provenance signal</strong><span>${escapeHtml(provenance.status === "detected" ? "Supported signal detected" : provenance.status === "unavailable" ? "Inspection unavailable" : "No supported signal detected")}</span><small>${escapeHtml(provenance.interpretation || "This is not an authenticity verdict.")}</small></div>
      </div>
      <p class="media-note">A provenance signal can indicate origin, but it cannot prove that the claim is accurate. No signal does not prove the image is real or false. <a href="${escapeHtml(provenance.openai_verify_url)}" target="_blank" rel="noopener noreferrer">Check OpenAI Verify manually</a>.</p>
    </section>
  `;
}

function renderAudioResult(audioResult, mode = "expert") {
  if (!audioResult) return "";
  const transcript = audioResult.text || audioResult.reason || "No transcription was produced.";
  if (mode !== "expert") {
    return `
      <section class="media-summary" aria-label="Voice transcription summary">
        <span class="media-summary-icon">V</span>
        <div><strong>Voice note checked locally</strong><p>${escapeHtml(humanize(audioResult.status))}. ${escapeHtml(transcript)}</p></div>
        <span class="media-summary-link">Expert mode has details</span>
      </section>
    `;
  }
  return `
    <section class="analysis-section media-analysis" aria-labelledby="voice-heading">
      <div class="section-title-row"><span class="number-badge">V</span><div><p class="mini-label">Voice inspection</p><h3 id="voice-heading">Local transcription</h3></div></div>
      <div class="media-grid">
        <div><strong>Status</strong><span>${escapeHtml(humanize(audioResult.status))}</span><small>${escapeHtml(audioResult.engine || "Local adapter")}${audioResult.model ? ` · ${escapeHtml(audioResult.model)}` : ""}</small></div>
        <div><strong>Transcript</strong><span>${escapeHtml(transcript)}</span><small>${audioResult.duration_seconds ? `${escapeHtml(String(audioResult.duration_seconds))} seconds` : "Review the original recording for names, locations, and numbers."}</small></div>
      </div>
      <p class="media-note">Transcription is an interpretation aid, not evidence. Review the original recording before acting.</p>
    </section>
  `;
}

function renderRunOverview(data) {
  const embedding = data.retrieval?.embedding;
  const structured = data.structured_extraction;
  const semanticStatus = embedding?.fallback_used
    ? "semantic fallback"
    : `semantic model${embedding?.model ? `: ${embedding.model}` : " active"}`;
  const structuredStatus = structured?.loaded
    ? ` + structured model${structured.model ? `: ${structured.model}` : ""}`
    : structured?.fallback_used
      ? " + structured fallback"
      : " + rules for structured fields";
  const aiStatus = `Local AI: ${semanticStatus}${structuredStatus}`;
  const sourceFetch = data.source_fetch;
  const liveStatus = sourceFetch.live_evidence_available
    ? `${sourceFetch.live_record_count} official records${sourceFetch.cache_fallback_record_count ? ` · ${sourceFetch.cache_fallback_record_count} from recent cache` : ""}`
    : "No current or cached official records available";

  return `
    <section class="run-overview" aria-label="Analysis run overview">
      <div><span class="metric-label">AI status</span><strong>${escapeHtml(aiStatus)}</strong></div>
      <div><span class="metric-label">Live official evidence</span><strong>${escapeHtml(liveStatus)}</strong></div>
      <div><span class="metric-label">Analyzed</span><strong>${escapeHtml(formatDate(data.analyzed_at))}</strong></div>
    </section>
    ${renderSourceFetch(sourceFetch)}
  `;
}

function renderClaim(claim, index, totalClaims, translation, mode = "normal") {
  const understanding = claim.ai_analysis?.understanding;
  const search = claim.ai_analysis?.evidence_search;
  const decision = claim.ai_analysis?.decision;

  return `
    <article class="claim-analysis">
      ${totalClaims > 1 ? `<p class="claim-number">Claim ${index + 1} of ${totalClaims}</p>` : ""}
      <section class="verdict-panel ${escapeHtml(claim.verdict)}">
        <div>
          <p class="verdict-kicker">Evidence verdict</p>
          <p class="verdict">${escapeHtml(humanize(claim.verdict))}</p>
        </div>
        <div class="confidence">
          <span>Evidence confidence</span>
          <strong>${escapeHtml(humanize(claim.confidence_band))}</strong>
          <small>${Math.round(claim.confidence_score * 100)}% policy score</small>
        </div>
      </section>

      ${mode === "expert" ? renderUnderstanding(understanding, claim.claim) : renderBasicUnderstanding(understanding, claim.claim)}
      ${mode === "expert" ? renderEvidenceSearch(search, translation) : renderBasicEvidenceSearch(search, translation)}

      <section class="analysis-section decision-section" aria-labelledby="decision-${index}">
        <div class="section-title-row">
          <span class="number-badge">3</span>
          <div><p class="mini-label">${mode === "expert" ? "Evidence rules" : "The answer"}</p><h3 id="decision-${index}">${mode === "expert" ? "Why this verdict?" : "What should you take away?"}</h3></div>
        </div>
        <p class="decision-basis">${escapeHtml(decision?.basis || claim.rationale)}</p>
        ${mode === "expert" ? `<p>${escapeHtml(claim.rationale)}</p>${decision ? `<p class="guardrail-note"><strong>Guardrail:</strong> ${escapeHtml(decision.semantic_score_role)}</p>` : ""}` : `<p class="normal-answer-note">The result is based on fresh trusted evidence with matching claim type and location scope.</p>`}
      </section>

      ${mode === "expert" ? `<section class="analysis-section" aria-labelledby="used-evidence-${index}">
        <div class="section-title-row">
          <span class="number-badge">4</span>
          <div><p class="mini-label">Traceability</p><h3 id="used-evidence-${index}">Evidence used for the verdict</h3></div>
        </div>
        ${claim.evidence.length ? claim.evidence.map(renderEvidence).join("") : `<div class="neutral-callout"><strong>No evidence established this claim.</strong><p>AEGIS may have found related records, but none passed the type, location, and freshness rules.</p></div>`}
      </section>` : renderBasicEvidence(claim)}

      <section class="safe-action">
        <span aria-hidden="true">!</span>
        <div><p class="mini-label">Recommended safe action</p><p>${escapeHtml(claim.safety_note)}</p></div>
      </section>
    </article>
  `;
}

function renderBasicUnderstanding(understanding, claim) {
  const fields = understanding?.fields;
  if (!fields) return `<section class="analysis-section"><p><strong>Claim:</strong> ${escapeHtml(claim.text)}</p></section>`;
  return `
    <section class="analysis-section basic-understanding" aria-labelledby="basic-understanding-heading">
      <div class="section-title-row"><span class="number-badge">1</span><div><p class="mini-label">Quick read</p><h3 id="basic-understanding-heading">What AEGIS understood</h3></div></div>
      <p class="basic-interpretation">${escapeHtml(understanding.interpretation)}</p>
      <div class="basic-fields">
        ${renderField("Claim type", fields.claim_type)}
        ${renderField("Location", fields.location, fields.location_source)}
        ${renderField("Time", fields.time_label)}
      </div>
      ${understanding.missing_fields.length ? `<div class="basic-missing"><strong>Still needed:</strong> ${escapeHtml(understanding.missing_fields.join(", "))}</div>` : ""}
    </section>
  `;
}

function renderBasicEvidenceSearch(search, translation) {
  const consensus = search?.source_consensus;
  const matched = search?.fresh_direct_match_count ?? 0;
  const sourceText = consensus?.status === "conflict"
    ? "Trusted sources disagree"
    : matched
      ? `${matched} fresh direct match${matched === 1 ? "" : "es"}`
      : "No fresh direct match";
  return `
    <section class="analysis-section basic-evidence" aria-labelledby="basic-evidence-heading">
      <div class="section-title-row"><span class="number-badge">2</span><div><p class="mini-label">Trusted evidence</p><h3 id="basic-evidence-heading">What the sources say</h3></div></div>
      <div class="basic-evidence-summary"><strong>${escapeHtml(sourceText)}</strong><span>${search?.sources_checked?.length ?? 0} publisher${search?.sources_checked?.length === 1 ? "" : "s"} checked</span></div>
      ${consensus ? `<p class="source-consensus ${escapeHtml(consensus.status)}"><strong>${escapeHtml(consensus.status === "agreement" ? "Source agreement:" : consensus.status === "conflict" ? "Source conflict:" : "Source status:")}</strong> ${escapeHtml((consensus.publishers || []).join(", ") || "No publisher established the claim.")}</p>` : ""}
      ${translation?.status === "completed" ? `<details class="translation-panel"><summary>Show English translation used</summary><p>${escapeHtml(translation.text)}</p></details>` : ""}
    </section>
  `;
}

function renderBasicEvidence(claim) {
  const item = claim.evidence?.[0];
  return `
    <section class="analysis-section basic-traceability" aria-labelledby="basic-traceability-heading">
      <div class="section-title-row"><span class="number-badge">4</span><div><p class="mini-label">Traceability</p><h3 id="basic-traceability-heading">Evidence behind the answer</h3></div></div>
      ${item ? `<div class="basic-source-card"><span class="origin-tag">${escapeHtml(humanize(item.evidence_origin))}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.source_name)} · ${escapeHtml(formatDate(item.published_at))}</p>${renderSourceLink(item)}</div>` : `<div class="neutral-callout"><strong>No evidence established this claim.</strong><p>Switch to Expert mode to inspect the related records and limitations.</p></div>`}
    </section>
  `;
}

function renderUnderstanding(understanding, claim) {
  const fields = understanding?.fields;
  if (!fields) return `<p><strong>Extracted claim:</strong> ${escapeHtml(claim.text)}</p>`;
  return `
    <section class="analysis-section" aria-labelledby="understanding-heading">
      <div class="section-title-row">
        <span class="number-badge">1</span>
        <div><p class="mini-label">Local AI + structured extraction</p><h3 id="understanding-heading">What AEGIS understood</h3></div>
      </div>
      <blockquote>${escapeHtml(understanding.interpretation)}</blockquote>
      <div class="field-grid">
        ${renderField("Claim type", fields.claim_type)}
        ${renderField("Location", fields.location, fields.location_source)}
        ${renderField("Time", fields.time_label)}
        ${renderField("Requested action", humanize(fields.action_requested))}
        ${renderField("Risk category", humanize(fields.harm_category))}
        ${renderField("Language", fields.language.toUpperCase(), fields.language_source)}
      </div>
      ${renderExtractionSignals(understanding.extraction_signals)}
      ${understanding.missing_fields.length ? `
        <div class="clarification-callout">
          <strong>Could be clearer: ${escapeHtml(understanding.missing_fields.join(", "))}</strong>
          <p>${escapeHtml(understanding.clarification_prompt)}</p>
          ${renderClarificationDetails(understanding)}
        </div>` : `<p class="complete-line">✓ The claim has enough structure for an evidence search.</p>`}
    </section>
  `;
}

function renderClarificationDetails(understanding) {
  const details = understanding.missing_field_details || [];
  const options = understanding.clarification_options || [];
  return `
    ${details.length ? `<ul class="clarification-details">${details.map((detail) => `<li><strong>${escapeHtml(detail.label)}:</strong> ${escapeHtml(detail.explanation)}</li>`).join("")}</ul>` : ""}
    ${options.length ? `<div class="clarification-actions">${options.map((option) => `<button class="clarification-action" type="button" data-clarification-action="${escapeHtml(option.action)}" data-clarification-target="${escapeHtml(option.target)}">${escapeHtml(option.label)}</button>`).join("")}</div>` : ""}
  `;
}

function renderExtractionSignals(signals) {
  if (!signals) return "";
  const values = [
    signals.predicate_term ? `type cue: "${signals.predicate_term}"` : null,
    signals.location_text ? `location cue: "${signals.location_text}"` : null,
    signals.time_text ? `time cue: "${signals.time_text}"` : null,
    ...(signals.spelling_corrections || []).map((item) => `corrected "${item.from}" -> "${item.to}"`)
  ].filter(Boolean);
  return values.length ? `<p class="extraction-signals"><strong>Signals used:</strong> ${escapeHtml(values.join(" | "))}</p>` : "";
}

function renderEvidenceSearch(search, translation) {
  if (!search) return "";
  const visibleSources = (search.sources_checked || []).slice(0, 4);
  const hiddenSourceCount = Math.max(0, (search.sources_checked?.length ?? 0) - visibleSources.length);
  return `
    <section class="analysis-section" aria-labelledby="matches-heading">
      <div class="section-title-row">
        <span class="number-badge">2</span>
        <div><p class="mini-label">AI semantic retrieval</p><h3 id="matches-heading">Why evidence matched</h3></div>
      </div>
      <div class="search-stats">
        <span><strong>${search.records_checked}</strong> records checked</span>
        <span><strong>${search.sources_checked?.length ?? 0}</strong> evidence publishers</span>
        <span><strong>${search.candidate_count}</strong> candidates ranked</span>
        <span><strong>${search.fresh_direct_match_count}</strong> fresh direct matches</span>
      </div>
      <div class="source-chips">
        ${visibleSources.map((source) => `<span>${escapeHtml(source.name)} · ${escapeHtml(humanize(source.origin))}</span>`).join("")}
        ${hiddenSourceCount ? `<span>+${hiddenSourceCount} more represented</span>` : ""}
      </div>
      ${renderSourceConsensus(search.source_consensus)}
      ${renderTranslation(translation)}
      ${search.matches.length ? search.matches.slice(0, 3).map(renderMatch).join("") : `<div class="neutral-callout"><strong>No relevant candidate evidence was found.</strong></div>`}
      <p class="score-disclaimer">${escapeHtml(search.score_disclaimer)}</p>
    </section>
  `;
}

function renderSourceConsensus(consensus) {
  if (!consensus) return "";
  const labels = {
    agreement: "Fresh sources agree",
    conflict: "Fresh sources disagree",
    single_source: "One fresh source matched",
    no_fresh_direct_evidence: "No fresh direct source match"
  };
  const publishers = (consensus.publishers || []).join(", ");
  return `<p class="source-consensus ${escapeHtml(consensus.status)}"><strong>Source view:</strong> ${escapeHtml(labels[consensus.status] || "Source comparison available")} · ${consensus.publisher_count ?? 0} publisher${consensus.publisher_count === 1 ? "" : "s"}${publishers ? ` (${escapeHtml(publishers)})` : ""}</p>`;
}

function renderTranslation(translation) {
  if (!translation || translation.status === "not_needed") return "";
  const available = translation.status === "completed";
  return `
    <details class="translation-panel" ${available ? "open" : ""}>
      <summary>${available ? "English translation used for retrieval" : "English translation unavailable"}</summary>
      <p>${escapeHtml(available ? translation.text : (translation.reason || "The original language was retained for retrieval."))}</p>
      ${available ? `<small>Local model: ${escapeHtml(translation.model)} · Original language: ${escapeHtml(translation.source_language)}</small>` : ""}
    </details>
  `;
}

function renderMatch(match, index) {
  const item = match.evidence;
  return `
    <details class="match-card" ${index === 0 ? "open" : ""}>
      <summary>
        <span class="match-rank">${index + 1}</span>
        <span class="match-summary"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.scope)} · ${escapeHtml(humanize(item.evidence_origin))}</small></span>
        <span class="match-badge ${match.fresh_direct_match ? "direct" : "limited"}">${match.fresh_direct_match ? "Direct + fresh" : escapeHtml(humanize(match.match_strength))}</span>
      </summary>
      <div class="match-body">
        <p>${escapeHtml(match.explanation)}</p>
        <div class="signal-grid">
          ${renderSignal("Semantic", item.embedding_score)}
          ${renderSignal("Lexical", item.lexical_score)}
          ${renderBooleanSignal("Type", match.predicate_match)}
          ${renderBooleanSignal("Location", match.location_match)}
        </div>
        ${match.gaps.length ? `<p class="gap-line"><strong>Why it may not count:</strong> ${escapeHtml(match.gaps.join("; "))}.</p>` : ""}
        <p class="match-source">Source: ${renderSourceLink(item)} · Published ${escapeHtml(formatDate(item.published_at))}</p>
      </div>
    </details>
  `;
}

function renderEvidence(item) {
  const metadata = item.live_metadata;
  return `
    <article class="evidence-card">
      <div class="evidence-header">
        <div><span class="origin-tag">${escapeHtml(humanize(item.evidence_origin))}</span><h4>${escapeHtml(item.title)}</h4></div>
        <span class="freshness ${item.staleness?.is_stale ? "stale" : "fresh"}">${item.staleness?.is_stale ? "Stale" : "Current"}</span>
      </div>
      <p>${escapeHtml(item.body)}</p>
      ${metadata ? renderCapMetadata(metadata) : ""}
      <dl class="evidence-meta">
        <div><dt>Source</dt><dd>${renderSourceLink(item)}</dd></div>
        <div><dt>Published</dt><dd>${escapeHtml(formatDate(item.published_at))}</dd></div>
        <div><dt>Scope</dt><dd>${escapeHtml(item.scope)}</dd></div>
      </dl>
    </article>
  `;
}

function renderCapMetadata(metadata) {
  const values = [
    ["Event", metadata.event],
    ["Severity", metadata.severity],
    ["Urgency", metadata.urgency],
    ["Certainty", metadata.certainty],
    ["Effective", metadata.effective_at ? formatDate(metadata.effective_at) : null],
    ["Expires", metadata.expires_at ? formatDate(metadata.expires_at) : null]
  ].filter(([, value]) => value);
  return `
    <div class="cap-grid">${values.map(([label, value]) => `<span><small>${escapeHtml(label)}</small>${escapeHtml(humanize(value))}</span>`).join("")}</div>
    ${metadata.instruction ? `<p class="instruction"><strong>Official instruction:</strong> ${escapeHtml(metadata.instruction)}</p>` : ""}
  `;
}

function renderSourceFetch(sourceFetch) {
  const statuses = sourceFetch?.statuses || [];
  if (!statuses.length) return "";
  return `
    <details class="source-status">
      <summary>Trusted-source refresh details</summary>
      ${statuses.map((status) => `
        <p><span class="status-dot ${["ok", "cache_fallback"].includes(status.status) ? "ok" : "error"}"></span><strong>${escapeHtml(status.source_name)}</strong>: ${escapeHtml(humanize(status.status))}${status.record_count !== undefined ? ` · ${status.record_count} records` : ""}${status.cache_age_seconds !== undefined ? ` · cache age ${status.cache_age_seconds}s` : ""}${status.error ? ` · ${escapeHtml(status.error)}` : ""}</p>
      `).join("")}
      <p><a class="source-history-link" href="${escapeHtml(`${apiBase}/sources/history`)}" target="_blank" rel="noopener noreferrer">Open source fetch history</a></p>
    </details>
  `;
}

function renderField(label, value, source = null) {
  return `<div class="extracted-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(humanize(value))}</strong>${source ? `<small>${escapeHtml(humanize(source))}</small>` : ""}</div>`;
}

function renderSignal(label, value) {
  if (value === null || value === undefined) return `<span><small>${label}</small><strong>Not used</strong></span>`;
  return `<span><small>${label}</small><strong>${Math.round(Math.max(0, Math.min(1, value)) * 100)}%</strong></span>`;
}

function renderBooleanSignal(label, value) {
  return `<span><small>${label}</small><strong class="${value ? "signal-yes" : "signal-no"}">${value ? "Match" : "No match"}</strong></span>`;
}

function renderSourceLink(item) {
  const url = safeUrl(item.source_url);
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.source_name)}</a>` : escapeHtml(item.source_name);
}

function humanize(value) {
  return String(value ?? "unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "Unknown");
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ data: reader.result, mime_type: file.type });
    reader.onerror = () => reject(new Error("Could not read the selected image"));
    reader.readAsDataURL(file);
  });
}

function readAudio(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ data: reader.result, mime_type: file.type || "audio/wav", filename: file.name, size: file.size });
    reader.onerror = () => reject(new Error("Could not read the selected voice note"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
