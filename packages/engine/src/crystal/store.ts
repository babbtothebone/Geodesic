import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Crystal } from '@geodesic/types';

const DEFAULT_CRYSTALS_DIR = path.join(os.homedir(), '.geodesic', 'crystals');

export function getCrystalsDir(configuredDir?: string): string {
  return configuredDir ?? DEFAULT_CRYSTALS_DIR;
}

// Fingerprints must be hex/alphanumeric-with-dashes — reject anything that could escape the directory
function validateFingerprint(fp: string): void {
  if (!/^[a-zA-Z0-9_+\-.]{1,256}$/.test(fp)) {
    throw new Error(`Invalid crystal fingerprint (contains unsafe characters): ${fp}`);
  }
}

export class CrystalStore {
  readonly dirPath: string;

  constructor(dirPath: string = DEFAULT_CRYSTALS_DIR) {
    this.dirPath = dirPath;
  }

  getAll(): Crystal[] {
    if (!fs.existsSync(this.dirPath)) return [];
    const crystals: Crystal[] = [];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.dirPath, { withFileTypes: true });
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const crystalPath = path.join(this.dirPath, entry.name, 'crystal.json');
      if (!fs.existsSync(crystalPath)) continue;
      try {
        const raw = fs.readFileSync(crystalPath, 'utf8');
        crystals.push(JSON.parse(raw) as Crystal);
      } catch {
        // Corrupted file — skip
      }
    }

    return crystals;
  }

  get(stackFingerprint: string): Crystal | null {
    validateFingerprint(stackFingerprint);
    const crystalPath = path.join(this.dirPath, stackFingerprint, 'crystal.json');
    if (!fs.existsSync(crystalPath)) return null;
    try {
      const raw = fs.readFileSync(crystalPath, 'utf8');
      return JSON.parse(raw) as Crystal;
    } catch {
      return null;
    }
  }

  write(crystal: Crystal): void {
    validateFingerprint(crystal.stackFingerprint);
    const dir = path.join(this.dirPath, crystal.stackFingerprint);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = path.join(dir, 'crystal.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify(crystal, null, 2), 'utf8');
      fs.renameSync(tmpPath, path.join(dir, 'crystal.json'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[geodesic] crystal write failed (non-fatal): ${msg}\n`);
    }
  }
}
