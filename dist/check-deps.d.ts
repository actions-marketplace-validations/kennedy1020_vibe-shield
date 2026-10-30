/**
 * Resolves the real registry target for a dependency entry.
 * Filters non-registry protocols and unpacks npm aliases (npm:pkg@version).
 */
export declare function resolvePackageTarget(name: string, rawVersion: unknown): {
    shouldProbe: boolean;
    probeName: string;
};
/**
 * Checks npm dependencies against registry.npmjs.org.
 * Returns an array of package names returning HTTP 404 (hallucinations).
 */
export declare function auditDependencies(deps: Record<string, string>): Promise<string[]>;
/**
 * Checks Python package names against pypi.org.
 * Returns an array of package names returning HTTP 404.
 */
export declare function auditPyPiDependencies(deps: string[]): Promise<string[]>;
/**
 * Extracts clean package names from requirements.txt,
 * stripping inline comments, version constraints, extras, and environment markers.
 */
export declare function parseRequirementsTxt(content: string): string[];
/**
 * Discovers and audits package.json (npm) and requirements.txt (PyPI).
 * Automatically resolves files in targetDir or falls back to process.cwd().
 */
export declare function verifyDependencies(targetDir: string, allowPackages?: string[]): Promise<string[]>;
