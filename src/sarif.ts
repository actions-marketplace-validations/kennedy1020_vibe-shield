export interface SarifResult {
  ruleId: string;
  level: string;
  message: {
    text: string;
  };
  locations: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string;
      };
      region?: {
        startLine: number;
        startColumn?: number;
      };
    };
  }>;
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri?: string;
      rules: any[];
    };
  };
  results: SarifResult[];
}

export interface SarifReport {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

export function mergeFindingsToSarif(
  semgrepOutput: string,
  hallucinatedPackages: string[],
  targetDir: string
): SarifReport {
  let sarif: SarifReport = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'vibe-shield',
            version: '1.1.0',
            informationUri: 'https://github.com/kennedy1020/vibe-shield',
            rules: [],
          },
        },
        results: [],
      },
    ],
  };

  // Safely parse Semgrep JSON output without throwing SyntaxError
  if (semgrepOutput && semgrepOutput.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(semgrepOutput);
      if (parsed.runs && Array.isArray(parsed.runs) && parsed.runs.length > 0) {
        sarif = parsed;
        if (sarif.runs[0]?.tool?.driver) {
          sarif.runs[0].tool.driver.name = 'vibe-shield';
          sarif.runs[0].tool.driver.version = '1.1.0';
        }
      }
    } catch {
      // Continue with empty base report if JSON parse fails
    }
  }

  // Inject Slopsquatted / Missing dependency findings
  if (hallucinatedPackages.length > 0 && sarif.runs[0]) {
    for (const pkg of hallucinatedPackages) {
      sarif.runs[0].results.push({
        ruleId: 'slopsquatting-missing-package',
        level: 'error',
        message: {
          text: `CRITICAL: Dependency '${pkg}' was not found in the public package registry (404). This is likely an AI-hallucinated package name vulnerable to slopsquatting attacks.`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: 'package.json',
              },
              region: {
                startLine: 1,
              },
            },
          },
        ],
      });
    }
  }

  return sarif;
}