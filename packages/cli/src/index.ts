#!/usr/bin/env node
import { Command } from 'commander';
import { GEODESIC_VERSION } from '@geodesic/engine';
import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerHarvestCommand } from './commands/harvest.js';
import { registerCrystalsCommand } from './commands/crystals.js';
import { registerConfigCommand } from './commands/config.js';
import { registerAttestCommand } from './commands/attest.js';
import { registerBaselineCommand } from './commands/baseline.js';

const program = new Command();

program
  .name('geodesic')
  .description('Auto-topology analysis for codebases')
  .version(GEODESIC_VERSION);

registerAnalyzeCommand(program);
registerHarvestCommand(program);
registerCrystalsCommand(program);
registerConfigCommand(program);
registerAttestCommand(program);
registerBaselineCommand(program);

program.parse(process.argv);
