import * as fs from 'fs';
import * as path from 'path';
import type { FileTreeNode, PiiCandidateLocation } from '@geodesic/types';

/**
 * Static heuristics only — no AI, no network, no values stored.
 * Each entry records file + line range + a human-readable hint.
 * Values are never captured; only coordinates are stored.
 */

interface PiiSignal {
  pattern: RegExp;
  hint: string;
}

// Patterns that suggest a field/variable HOLDS or PROCESSES PII
const PII_SIGNALS: PiiSignal[] = [
  // HIPAA direct identifiers
  { pattern: /\b(?:first_name|last_name|full_name|patient_name|member_name)\b/i, hint: 'PHI: person name field' },
  { pattern: /\b(?:ssn|social_security|social_security_number|tin)\b/i, hint: 'PHI: SSN / TIN field' },
  { pattern: /\b(?:dob|date_of_birth|birth_date|birthdate)\b/i, hint: 'PHI: date of birth field' },
  { pattern: /\b(?:phone_number|phone|mobile|cell|fax)\b/i, hint: 'PHI: phone number field' },
  { pattern: /\b(?:email|email_address)\b/i, hint: 'PII: email address field' },
  { pattern: /\b(?:address|street|zip_code|zipcode|postal_code|city|state)\b/i, hint: 'PII: physical address field' },
  { pattern: /\b(?:ip_address|ipaddr|client_ip|remote_addr)\b/i, hint: 'PII: IP address field' },
  { pattern: /\b(?:mrn|medical_record|patient_id|member_id|insurance_id)\b/i, hint: 'PHI: medical record identifier' },
  { pattern: /\b(?:diagnosis|icd_code|cpt_code|procedure_code|condition)\b/i, hint: 'PHI: medical condition / code' },
  { pattern: /\b(?:prescription|medication|drug_name|rx_number)\b/i, hint: 'PHI: prescription / medication' },
  { pattern: /\b(?:health_plan|insurance_plan|payer_id|policy_number)\b/i, hint: 'PHI: health plan identifier' },
  { pattern: /\b(?:biometric|fingerprint|retinal|dna_sequence)\b/i, hint: 'PHI: biometric identifier' },
  { pattern: /\b(?:account_number|bank_account|routing_number|iban)\b/i, hint: 'PII: financial account number' },
  { pattern: /\b(?:credit_card|card_number|cvv|card_expiry)\b/i, hint: 'PII: payment card data' },
  { pattern: /\b(?:passport_number|drivers_license|license_number|national_id)\b/i, hint: 'PII: government ID number' },
  { pattern: /\b(?:geo_location|latitude|longitude|coordinates|gps)\b/i, hint: 'PII: precise geolocation' },
  { pattern: /\b(?:device_id|device_fingerprint|mac_address|hardware_id)\b/i, hint: 'PII: device identifier' },
  { pattern: /\b(?:user_agent|browser_fingerprint)\b/i, hint: 'PII: user agent / fingerprint' },

  // Logging that may leak PII
  { pattern: /console\.log\s*\(.*(?:user|patient|member|email|phone|name)/i, hint: 'Possible PII in console.log()' },
  { pattern: /print\s*\(.*(?:user|patient|member|email|phone|name)/i, hint: 'Possible PII in print()' },
  { pattern: /logger\.\w+\s*\(.*(?:user|patient|member|email|phone|name)/i, hint: 'Possible PII in logger call' },

  // Raw SQL that selects PHI-named columns
  { pattern: /SELECT.*(?:ssn|dob|date_of_birth|first_name|last_name|email|phone|address)/i, hint: 'PHI column in raw SQL SELECT' },

  // File paths that suggest PHI storage
  { pattern: /[/\\]patient[s]?[/\\]/i, hint: 'Directory path suggests patient data' },
  { pattern: /[/\\](?:phi|pii|hipaa)[/\\]/i, hint: 'Directory path explicitly flagged as PHI/PII' },
];

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2',
  '.ttf', '.eot', '.mp4', '.mp3', '.zip', '.gz', '.tar', '.lock',
  '.map', '.min.js', '.min.css',
]);

const SKIP_PATH_PATTERNS = [
  'node_modules', 'dist/', 'build/', '.git/', '__pycache__',
  'vendor/', 'target/', 'coverage/',
];

function shouldSkipFile(file: FileTreeNode): boolean {
  const ext = path.extname(file.name).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return true;
  if (file.name.endsWith('.min.js') || file.name.endsWith('.min.css')) return true;
  if (SKIP_PATH_PATTERNS.some(p => file.path.includes(p))) return true;
  // Skip test fixtures — they often intentionally contain dummy PHI
  if (file.path.includes('fixtures/') || file.path.includes('__fixtures__')) return true;
  return false;
}

export function findPiiCandidates(
  repoPath: string,
  files: FileTreeNode[],
): PiiCandidateLocation[] {
  const candidates: PiiCandidateLocation[] = [];

  const codeFiles = files.filter(
    f => f.type === 'file' && !shouldSkipFile(f),
  );

  for (const file of codeFiles) {
    const fullPath = path.join(repoPath, file.path);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // Skip comment-only lines — they don't hold live data
      const stripped = line.trim();
      if (
        stripped.startsWith('//') ||
        stripped.startsWith('#') ||
        stripped.startsWith('*') ||
        stripped.startsWith('/*')
      ) continue;

      for (const signal of PII_SIGNALS) {
        if (signal.pattern.test(line)) {
          // Avoid duplicating if consecutive lines trigger the same signal
          const last = candidates[candidates.length - 1];
          if (
            last &&
            last.file === file.path &&
            last.hint === signal.hint &&
            i - last.lineEnd <= 2
          ) {
            last.lineEnd = i + 1;
          } else {
            candidates.push({
              file: file.path,
              lineStart: i + 1,
              lineEnd: i + 1,
              hint: signal.hint,
            });
          }
          break; // One signal per line is sufficient
        }
      }
    }
  }

  return candidates;
}
