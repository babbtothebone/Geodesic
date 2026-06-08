import * as fs from 'fs';
import * as path from 'path';
import type { SynthesisResult } from '@geodesic/types';
import { renderArchitectureMap } from './arch-map-writer.js';
import { renderSkillFileJson, renderSkillFileMd } from './skill-file-writer.js';
import { renderGapReport } from './gap-report-writer.js';

export { renderArchitectureMap } from './arch-map-writer.js';
export { renderSkillFileJson, renderSkillFileMd } from './skill-file-writer.js';
export { renderGapReport, computeLetterGrade, computeDimensionScore, computeOverallScore } from './gap-report-writer.js';

export interface ArtifactPaths {
  architectureMap: string;
  skillFileJson: string;
  skillFileMd: string;
  gapReport: string;
}

/**
 * Renders all four output artifacts from a SynthesisResult and writes them
 * to the given output directory, creating it if necessary.
 *
 * Output directory must be outside the analyzed repo.
 * The caller is responsible for selecting a compliant output path.
 */
export function writeArtifacts(synthesis: SynthesisResult, outputDir: string): ArtifactPaths {
  fs.mkdirSync(outputDir, { recursive: true });

  const archMapPath  = path.join(outputDir, 'architecture-map.md');
  const skillJsonPath = path.join(outputDir, 'skill-file.geodesic.json');
  const skillMdPath  = path.join(outputDir, 'skill-file.geodesic.md');
  const gapPath      = path.join(outputDir, 'gap-report.md');

  const files: Array<readonly [string, string]> = [
    [archMapPath,  renderArchitectureMap(synthesis)],
    [skillJsonPath, renderSkillFileJson(synthesis.skillFile)],
    [skillMdPath,  renderSkillFileMd(synthesis.skillFile)],
    [gapPath,      renderGapReport(synthesis.gapReport)],
  ];

  // Write to .tmp siblings first; on success rename atomically so no partial state is visible
  const tmpPaths: string[] = [];
  try {
    for (const [finalPath, content] of files) {
      const tmpPath = `${finalPath}.tmp`;
      fs.writeFileSync(tmpPath, content, 'utf8');
      tmpPaths.push(tmpPath);
    }
    files.forEach(([finalPath], i) => {
      const tmp = tmpPaths[i];
      if (tmp !== undefined) fs.renameSync(tmp, finalPath);
    });
  } catch (err) {
    for (const tmpPath of tmpPaths) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    }
    throw err;
  }

  return {
    architectureMap: archMapPath,
    skillFileJson:   skillJsonPath,
    skillFileMd:     skillMdPath,
    gapReport:       gapPath,
  };
}
