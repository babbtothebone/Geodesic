import type { Command } from 'commander';
import type { GeodesicConfig } from '@geodesic/types';
import { CrystalStore, getCrystalsDir, generateCrystalIndex, pullCrystals } from '@geodesic/engine';
import { loadConfig } from '@geodesic/engine';

/* eslint-disable no-console */

function getStore(): CrystalStore {
  try {
    const config = loadConfig();
    return new CrystalStore(getCrystalsDir(undefined));
    void config; // config loaded for validation only at this stage
  } catch {
    return new CrystalStore(getCrystalsDir(undefined));
  }
}

export function registerCrystalsCommand(program: Command): void {
  const crystals = program
    .command('crystals')
    .description('Manage the local Crystal Store');

  crystals
    .command('list')
    .description('List all available crystals from local cache')
    .action(() => {
      const store = getStore();
      const all = store.getAll();

      if (all.length === 0) {
        console.log('No crystals in local cache. Run an analysis to create the first crystal.');
        return;
      }

      const header = 'Stack                                    Status      Fitness  Uses  Last Used';
      const separator = '─'.repeat(80);
      console.log(header);
      console.log(separator);

      const sorted = [...all].sort((a, b) => b.fitness.fitnessScore - a.fitness.fitnessScore);
      for (const c of sorted) {
        const status = c.status.charAt(0).toUpperCase() + c.status.slice(1);
        const lastUsed = c.lastUsedAt ? c.lastUsedAt.slice(0, 10) : '—';
        const stack = c.stackFingerprint.padEnd(40);
        const statusCol = status.padEnd(11);
        const fitness = c.fitness.fitnessScore.toFixed(2).padEnd(8);
        const uses = String(c.fitness.useCount).padEnd(5);
        console.log(`${stack} ${statusCol} ${fitness} ${uses} ${lastUsed}`);
      }
    });

  crystals
    .command('sync')
    .description('Sync Crystal Store with your configured repository')
    .action(async () => {
      const store = getStore();
      let config: GeodesicConfig | undefined = undefined;
      try { config = loadConfig(); } catch { /* no config — sync will run local-only */ }
      const result = await pullCrystals(store.dirPath, config);
      if (result.success) {
        console.log('[geodesic] ' + result.message);
      } else {
        console.error('[geodesic] ' + result.message);
        if (result.requiresAction) process.exit(1);
      }
    });

  crystals
    .command('inspect <fingerprint>')
    .description('Show full crystal JSON for a given stack fingerprint')
    .action((fingerprint: string) => {
      const store = getStore();
      const crystal = store.get(fingerprint);
      if (!crystal) {
        console.error(`[geodesic] No crystal found for fingerprint: ${fingerprint}`);
        console.error('[geodesic] Run: geodesic crystals list  to see available crystals');
        process.exit(1);
        return;
      }
      console.log(JSON.stringify(crystal, null, 2));
    });

  crystals
    .command('index')
    .description('Regenerate CRYSTAL_INDEX.md from local cache')
    .action(() => {
      const store = getStore();
      const all = store.getAll();
      const now = new Date().toISOString();
      const index = generateCrystalIndex(all, now);
      process.stdout.write(index);
    });
}

/* eslint-enable no-console */
