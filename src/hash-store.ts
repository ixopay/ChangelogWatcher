import fs from "fs";
import path from "path";
import { DATA_DIR, ReleaseSource } from "./config";

export interface StoredData {
  date?: string; // For date-based sources (Gemini, ChatGPT)
  hash?: string; // For hash-based sources (Claude) or fallback
}

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readStoredData(source: ReleaseSource): StoredData | null {
  const filePath = path.join(DATA_DIR, source.hashFileName);
  try {
    const content = fs.readFileSync(filePath, "utf8").trim();

    // Try to parse as JSON (new format)
    if (content.startsWith("{")) {
      return JSON.parse(content) as StoredData;
    }

    // Legacy format: plain hash string
    return { hash: content };
  } catch {
    return null; // First run or file doesn't exist
  }
}

export function writeStoredData(source: ReleaseSource, data: StoredData): void {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, source.hashFileName);

  // For sources with dates, store as JSON
  if (data.date) {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } else {
    // For hash-only (Claude), store plain string for simplicity
    fs.writeFileSync(filePath, data.hash || "");
  }
}

// Legacy functions for backward compatibility
export function readHash(source: ReleaseSource): string | null {
  const data = readStoredData(source);
  return data?.hash || null;
}

export function writeHash(source: ReleaseSource, hash: string): void {
  writeStoredData(source, { hash });
}
