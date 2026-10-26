import fs from 'fs';
import path from 'path';

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  defaultConfiguration: {
    level: 'error' | 'warning' | 'note';
  };
  helpUri?: string;
}

export interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: {
        startLine: number;
        startColumn?: number;
      };
    };
  }>;
}

export interface SarifLog {
  $schema: string;
  version: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }>;
}

const SLOPSQUATTING_RULE_ID = 'slopsquatting-hallucination';

export const SLOPSQUATTING_SARIF_RULE: SarifRule = {
  id: SLOPSQUATTING_RULE_ID,
  name: 'SlopsquattingHallucinatedPackage',
  shortDescription: {
    text: 'AI-hallucinated or unregistered npm dependency detected',
  },
  fullDescription: {
    text: 'The dependency is declared in package.json but returned 404 on registry.npmjs.org. It may be an AI hallucination susceptible to supply-chain package takeover.',
  },
  defaultConfiguration: {
    level: 'error',
  },
  helpUri: 'https://github.com/kennedy1020/vibe-shield#the-problem',
};

export function mergeFindingsToSarif(
  baseSarifJson: string,
  hallucinatedPackages: string[],
  targetDir: string
): SarifLog {
  let sarif: SarifLog;

  try {
    sarif = JSON.parse(baseSarifJson);
  } catch {
    sarif = {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'vibe-shield',
              version: '1.0.2',
              informationUri: 'https://github.com/kennedy1020/vibe-shield',
              rules: [],
            },
          },
          results: [],
        },
      ],
    };
  }

  const run = sarif.runs[0];
  if (!run) return sarif;

  // Rebrand driver metadata
  run.tool.driver.name = 'vibe-shield';
  run.tool.driver.informationUri = 'https://github.com/kennedy1020/vibe-shield';

  if (hallucinatedPackages.length > 0) {
    const ruleExists = run.tool.driver.rules.some(r => r.id === SLOPSQUATTING_RULE_ID);
    if (!ruleExists) {
      run.tool.driver.rules.push(SLOPSQUATTING_SARIF_RULE);
    }

    const packageJsonPath = path.relative(process.cwd(), path.join(targetDir, 'package.json'));

    for (const pkg of hallucinatedPackages) {
      run.results.push({
        ruleId: SLOPSQUATTING_RULE_ID,
        level: 'error',
        message: {
          text: `Package '${pkg}' does not exist on the public npm registry (404). Possible AI hallucination/slopsquatting target.`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: packageJsonPath.replace(/\\/g, '/') },
              region: { startLine: 1 },
            },
          },
        ],
      });
    }
  }

  return sarif;
}