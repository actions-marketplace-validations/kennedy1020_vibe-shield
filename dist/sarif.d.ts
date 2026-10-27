export interface SarifRule {
    id: string;
    name: string;
    shortDescription: {
        text: string;
    };
    fullDescription?: {
        text: string;
    };
    defaultConfiguration: {
        level: 'error' | 'warning' | 'note';
    };
    helpUri?: string;
}
export interface SarifResult {
    ruleId: string;
    level: 'error' | 'warning' | 'note';
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
export declare const SLOPSQUATTING_SARIF_RULE: SarifRule;
export declare function mergeFindingsToSarif(baseSarifJson: string, hallucinatedPackages: string[], targetDir: string): SarifLog;
