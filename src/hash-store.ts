import fs from "fs";
import path from "path";
import { DATA_DIR, ReleaseSource } from "./config";

export interface StoredData {
  date?: string; // For date-based sources (Gemini, ChatGPT)
  version?: string; // For version-based sources (Claude Code)
}

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readStoredData(source: ReleaseSource): StoredData | null {
  const filePath = path.join(DATA_DIR, source.stateFile);
  try {
    const content = fs.readFileSync(filePath, "utf8").trim();
    return JSON.parse(content) as StoredData;
  } catch {
    return null; // First run or file doesn't exist
  }
}

export function writeStoredData(source: ReleaseSource, data: StoredData): void {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, source.stateFile);

  fs.writeFileSync(filePath, JSON.stringify(data));
}
