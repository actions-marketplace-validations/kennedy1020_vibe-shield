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
export declare function mergeFindingsToSarif(semgrepOutput: string, hallucinatedPackages: string[], targetDir: string): SarifReport;
