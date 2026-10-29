/**
 * Resolves the real registry target for a dependency entry.
 * Handles protocol filtering (workspace:, file:, git:) and npm aliases (npm:pkg@version).
 */
export declare function resolvePackageTarget(name: string, rawVersion: unknown): {
    shouldProbe: boolean;
    probeName: string;
};
/**
 * Checks an object of npm package dependencies against the npm registry.
 * Returns an array of package names that return 404 (hallucinated / slopsquatted).
 */
export declare function auditDependencies(deps: Record<string, string>): Promise<string[]>;
/**
 * Checks an array of Python package names against the official PyPI registry.
 * Returns an array of package names that return 404 (hallucinated / unregistered).
 */
export declare function auditPyPiDependencies(deps: string[]): Promise<string[]>;
/**
 * Extracts clean package names from a requirements.txt file,
 * stripping version specifiers, comments, extras, and environment markers.
 */
export declare function parseRequirementsTxt(content: string): string[];
/**
 * Discovers and verifies both package.json (npm) and requirements.txt (PyPI)
 * in the target directory, excluding any package specified in allowPackages.
 */
export declare function verifyDependencies(targetDir: string, allowPackages?: string[]): Promise<string[]>;
