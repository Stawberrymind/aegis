const ANALYZE_FIELDS = new Set(["text", "image", "audio", "language", "location"]);
const LANGUAGES = new Set(["auto", "en", "hi", "bn", "gu", "mr", "ta", "te", "kn", "ml"]);
const MAX_TEXT_LENGTH = 20_000;
const MAX_LOCATION_LENGTH = 120;
const MAX_IMAGE_DATA_LENGTH = Math.ceil(8 * 1024 * 1024 * 4 / 3) + 128;
const MAX_AUDIO_DATA_LENGTH = Math.ceil(16 * 1024 * 1024 * 4 / 3) + 128;

export function validateAnalyzeRequest(value) {
  if (!isPlainObject(value)) throw publicError(400, "invalid_request", "request body must be a JSON object");
  const unexpected = Object.keys(value).filter((key) => !ANALYZE_FIELDS.has(key));
  if (unexpected.length) throw publicError(400, "invalid_request", `unsupported request field: ${unexpected[0]}`);

  const text = optionalString(value.text, "text", MAX_TEXT_LENGTH);
  const language = optionalString(value.language, "language", 8);
  if (language && !LANGUAGES.has(language)) throw publicError(400, "invalid_request", "unsupported language selection");
  const location = optionalString(value.location, "location", MAX_LOCATION_LENGTH);
  const image = validateMedia(value.image, "image", MAX_IMAGE_DATA_LENGTH);
  const audio = validateMedia(value.audio, "audio", MAX_AUDIO_DATA_LENGTH, true);

  if (!text.trim() && !image && !audio) {
    throw publicError(400, "missing_input", "text, image, or voice note is required");
  }
  return { text, image, audio, language: language || undefined, location: location || undefined };
}

export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";
    let settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    function onData(chunk) {
      size += chunk.length;
      if (size > maxBytes) {
        req.removeListener("data", onData);
        req.resume();
        fail(publicError(413, "request_too_large", "request body too large; upload a smaller text, image, or WAV voice note"));
        return;
      }
      data += chunk;
    }

    req.on("data", onData);
    req.on("end", () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(data || "{}");
        settled = true;
        resolve(parsed);
      } catch {
        fail(publicError(400, "invalid_json", "invalid JSON request body"));
      }
    });
    req.on("error", (error) => fail(publicError(400, "request_stream_error", "request body could not be read", error)));
  });
}

export function publicError(status, code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.status = status;
  error.code = code;
  error.isPublic = true;
  return error;
}

function validateMedia(value, kind, maxDataLength, includeFilename = false) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) throw publicError(400, "invalid_request", `${kind} must be an object`);
  const allowed = new Set(["data", "mime_type", ...(includeFilename ? ["filename", "size"] : [])]);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw publicError(400, "invalid_request", `unsupported ${kind} field: ${unexpected}`);
  const data = requiredString(value.data, `${kind}.data`, maxDataLength);
  const mimeType = requiredString(value.mime_type, `${kind}.mime_type`, 100);
  if (includeFilename && value.filename !== undefined) validateFilename(value.filename);
  return { data, mime_type: mimeType };
}

function validateFilename(value) {
  const filename = requiredString(value, "audio.filename", 255);
  if (/[\\/\0-\x1f\x7f]/.test(filename)) throw publicError(400, "invalid_request", "audio filename contains unsupported characters");
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw publicError(400, "invalid_request", `${field} must be a string`);
  if (value.length > maxLength) throw publicError(400, "invalid_request", `${field} is too long`);
  return value;
}

function requiredString(value, field, maxLength) {
  const result = optionalString(value, field, maxLength);
  if (!result) throw publicError(400, "invalid_request", `${field} is required`);
  return result;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
}
