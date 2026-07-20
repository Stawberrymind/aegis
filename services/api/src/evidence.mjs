import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const evidencePath = path.join(repoRoot, "data", "evidence", "records.json");

export async function loadEvidenceRecords() {
  const raw = await readFile(evidencePath, "utf8");
  const records = JSON.parse(raw);
  return records.map(validateEvidenceRecord);
}

export function validateEvidenceRecord(record) {
  const required = [
    "id",
    "title",
    "body",
    "language",
    "published_at",
    "source_name",
    "source_url",
    "source_type",
    "scope",
    "assertions"
  ];

  for (const field of required) {
    if (record[field] === undefined || record[field] === null || record[field] === "") {
      throw new Error(`Evidence record ${record.id ?? "<unknown>"} is missing ${field}`);
    }
  }

  if (!Array.isArray(record.assertions) || record.assertions.length === 0) {
    throw new Error(`Evidence record ${record.id} must include at least one assertion`);
  }

  for (const assertion of record.assertions) {
    for (const field of ["predicate", "location", "polarity", "time_scope"]) {
      if (!assertion[field]) {
        throw new Error(`Evidence record ${record.id} has invalid assertion missing ${field}`);
      }
    }
    if (!["asserted", "negated", "unknown"].includes(assertion.polarity)) {
      throw new Error(`Evidence record ${record.id} has invalid assertion polarity ${assertion.polarity}`);
    }
  }

  const date = new Date(record.published_at);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Evidence record ${record.id} has invalid published_at`);
  }

  return {
    ...record,
    fixture_type: record.fixture_type ?? "fixture"
  };
}
