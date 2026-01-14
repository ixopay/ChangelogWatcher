import fs from "fs";
import path from "path";
import { DATA_DIR, ReleaseSource } from "./config";

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readHash(source: ReleaseSource): string | null {
  const hashPath = path.join(DATA_DIR, source.hashFileName);
  try {
    return fs.readFileSync(hashPath, "utf8").trim();
  } catch {
    return null; // First run or file doesn't exist
  }
}

export function writeHash(source: ReleaseSource, hash: string): void {
  ensureDataDir();
  const hashPath = path.join(DATA_DIR, source.hashFileName);
  fs.writeFileSync(hashPath, hash);
}
