import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { GeodesicConfig } from '@geodesic/types';

const CONFIG_RELATIVE = path.join('.geodesic', 'config.json');

function readConfig(filePath: string): GeodesicConfig | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as GeodesicConfig;
  } catch {
    return null;
  }
}

/**
 * Loads Geodesic config from (in order):
 *   1. explicitPath (from --config CLI flag)
 *   2. .geodesic/config.json in CWD
 *   3. ~/.geodesic/config.json
 *
 * Throws a descriptive error if none found.
 */
export function loadConfig(explicitPath?: string, homeDir?: string): GeodesicConfig {
  if (explicitPath) {
    const cfg = readConfig(explicitPath);
    if (!cfg) {
      throw new Error(`Config file not found or invalid JSON: ${explicitPath}`);
    }
    return cfg;
  }

  const cwdConfig = readConfig(path.join(process.cwd(), CONFIG_RELATIVE));
  if (cwdConfig) return cwdConfig;

  const homeConfig = readConfig(path.join(homeDir ?? os.homedir(), CONFIG_RELATIVE));
  if (homeConfig) return homeConfig;

  throw new Error(
    'No Geodesic config found. Run: geodesic config set provider <anthropic|openai|gemini|azure|ollama>\n' +
    'Config is looked up in .geodesic/config.json (project) then ~/.geodesic/config.json (home).',
  );
}
