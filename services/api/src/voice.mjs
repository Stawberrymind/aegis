import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicError } from "./httpRequest.mjs";

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MODEL_SAMPLE_RATE = 16_000;
const MODEL = process.env.AEGIS_TRANSCRIPTION_MODEL ?? "Xenova/whisper-tiny";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let transcriberPromise = null;

export async function transcribeAudio({ data, mime_type, language = "" }, options = {}) {
  const buffer = decodeAudioData(data, mime_type);
  const startedAt = Date.now();
  const waveform = decodePcmWav(buffer);
  if (!waveform) {
    return unavailable("Only PCM WAV audio is supported by the local adapter in this release.", startedAt, mime_type);
  }

  const samples = resamplePcm(waveform.samples, waveform.sampleRate, MODEL_SAMPLE_RATE);
  if (!options.provider && samples.every((sample) => Math.abs(sample) < 0.000001)) {
    return {
      status: "no_speech_found",
      text: "",
      language: language || "auto",
      engine: "transformers.js",
      model: MODEL,
      sample_rate: MODEL_SAMPLE_RATE,
      original_sample_rate: waveform.sampleRate,
      duration_seconds: Number((samples.length / MODEL_SAMPLE_RATE).toFixed(2)),
      duration_ms: Date.now() - startedAt,
      reason: "The WAV contains no audible signal."
    };
  }

  try {
    const transcriber = options.provider ?? await withTimeout(
      getTranscriber(),
      Number(process.env.AEGIS_TRANSCRIPTION_MODEL_TIMEOUT_MS ?? 30_000),
      "voice model loading"
    );
    const output = await withTimeout(
      transcriber(samples, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: whisperLanguage(language),
        task: "transcribe"
      }),
      Number(process.env.AEGIS_TRANSCRIPTION_TIMEOUT_MS ?? 120_000),
      "voice transcription"
    );
    const text = String(output?.text ?? "").replace(/\s+/g, " ").trim();
    return {
      status: text ? "completed" : "no_speech_found",
      text,
      language: language || "auto",
      engine: "transformers.js",
      model: options.provider ? "injected-test-provider" : MODEL,
      sample_rate: MODEL_SAMPLE_RATE,
      original_sample_rate: waveform.sampleRate,
      duration_seconds: Number((samples.length / MODEL_SAMPLE_RATE).toFixed(2)),
      duration_ms: Date.now() - startedAt
    };
  } catch (error) {
    transcriberPromise = null;
    return unavailable(error.message, startedAt, mime_type);
  }
}

export function audioLimits() {
  return {
    max_audio_bytes: MAX_AUDIO_BYTES,
    supported_mime_types: ["audio/wav", "audio/x-wav", "audio/wave"],
    model: MODEL,
    local_only: true
  };
}

function decodeAudioData(data, mimeType) {
  if (!["audio/wav", "audio/x-wav", "audio/wave"].includes(String(mimeType ?? "").toLowerCase())) {
    throw publicError(400, "invalid_media", "Only PCM WAV audio is supported");
  }
  const encoded = String(data ?? "").replace(/^data:audio\/(?:wav|x-wav|wave);base64,/i, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || !encoded) throw publicError(400, "invalid_media", "Invalid audio data");
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) throw publicError(400, "invalid_media", "Audio must be smaller than 16 MB");
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw publicError(400, "invalid_media", "Audio content does not match PCM WAV format");
  }
  return buffer;
}

function decodePcmWav(buffer) {
  let offset = 12;
  let format = null;
  let dataChunk = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") format = parseWavFormat(buffer, start, size);
    if (id === "data") dataChunk = { start, size: Math.min(size, buffer.length - start) };
    offset = start + size + (size % 2);
  }
  if (!format || !dataChunk || format.audioFormat !== 1 || ![1, 2].includes(format.channels) || format.bitsPerSample !== 16 || !format.sampleRate) {
    return null;
  }
  const frameBytes = format.channels * 2;
  const frames = Math.floor(dataChunk.size / frameBytes);
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      const position = dataChunk.start + frame * frameBytes + channel * 2;
      sum += buffer.readInt16LE(position) / 32768;
    }
    samples[frame] = sum / format.channels;
  }
  return { samples, sampleRate: format.sampleRate };
}

function resamplePcm(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) return samples;
  const targetLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(targetLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = sourcePosition - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

function parseWavFormat(buffer, start, size) {
  if (size < 16 || start + 16 > buffer.length) return null;
  return {
    audioFormat: buffer.readUInt16LE(start),
    channels: buffer.readUInt16LE(start + 2),
    sampleRate: buffer.readUInt32LE(start + 4),
    bitsPerSample: buffer.readUInt16LE(start + 14)
  };
}

async function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = import("@huggingface/transformers").then(async ({ env, pipeline }) => {
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      env.cacheDir = path.join(repoRoot, "data", "transcription-cache");
      return pipeline("automatic-speech-recognition", MODEL);
    });
  }
  return transcriberPromise;
}

function whisperLanguage(language) {
  const languages = { en: "english", hi: "hindi", bn: "bengali", gu: "gujarati", mr: "marathi", ta: "tamil", te: "telugu", kn: "kannada", ml: "malayalam" };
  return languages[language] ?? undefined;
}

async function withTimeout(promise, timeoutMs, operation) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs} ms`)), timeoutMs); })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function unavailable(reason, startedAt, mimeType) {
  return {
    status: "unavailable",
    text: "",
    language: "auto",
    engine: "transformers.js",
    model: MODEL,
    mime_type: mimeType,
    local_only: true,
    reason,
    duration_ms: Date.now() - startedAt
  };
}
