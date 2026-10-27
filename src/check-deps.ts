import fs from 'node:fs';
import path from 'node:path';

/**
 * Checks an object of npm package dependencies against the npm registry.
 * Returns an array of package names that return 404 (hallucinated / slopsquatted).
 */
export async function auditDependencies(
    deps: Record<string, string>
): Promise<string[]> {
    const missing: string[] = [];
    const packageNames = Object.keys(deps || {});

    await Promise.all(
        packageNames.map(async (pkg) => {
            try {
                const encodedPkg = pkg.startsWith('@')
                    ? `@${encodeURIComponent(pkg.slice(1))}`
                    : encodeURIComponent(pkg);

                const res = await fetch(`https://registry.npmjs.org/${encodedPkg}`, {
                    method: 'HEAD',
                });

                if (res.status === 404) {
                    missing.push(pkg);
                }
            } catch {
                // Network timeout / DNS errors don't count as 404s
            }
        })
    );

    return missing;
}

/**
 * Checks an array of Python package names against the official PyPI registry.
 * Returns an array of package names that return 404 (hallucinated / unregistered).
 */
export async function auditPyPiDependencies(deps: string[]): Promise<string[]> {
    const missing: string[] = [];

    await Promise.all(
        deps.map(async (pkg) => {
            try {
                const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {
                    method: 'HEAD',
                });

                if (res.status === 404) {
                    missing.push(pkg);
                }
            } catch {
                // Network timeout / DNS errors don't count as 404s
            }
        })
    );

    return missing;
}

/**
 * Extracts clean package names from a requirements.txt file,
 * stripping version specifiers, comments, and environment markers.
 */
export function parseRequirementsTxt(content: string): string[] {
    return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
        .map((line) => {
            const withoutInlineComment = line.split('#')[0].trim();
            const match = withoutInlineComment.match(/^([a-zA-Z0-9_\-\.]+)/);
            return match ? match[1].toLowerCase() : '';
        })
        .filter((pkg): pkg is string => Boolean(pkg));
}

/**
 * Discovers and verifies both package.json (npm) and requirements.txt (PyPI)
 * in the target directory, excluding any package specified in allowPackages.
 */
export async function verifyDependencies(
    targetDir: string,
    allowPackages: string[] = []
): Promise<string[]> {
    const allowSet = new Set(allowPackages.map((p) => p.toLowerCase()));
    const missingPackages: string[] = [];

    // 1. Audit npm dependencies (package.json)
    const pkgPath = path.resolve(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const raw = fs.readFileSync(pkgPath, 'utf8');
            const pkg = JSON.parse(raw);
            const allDeps: Record<string, string> = {
                ...pkg.dependencies,
                ...pkg.devDependencies,
            };

            const filteredDeps: Record<string, string> = {};
            for (const [name, version] of Object.entries(allDeps)) {
                if (!allowSet.has(name.toLowerCase())) {
                    filteredDeps[name] = version;
                }
            }

            const npmMissing = await auditDependencies(filteredDeps);
            missingPackages.push(...npmMissing);
        } catch {
            // Ignore read / malformed JSON errors
        }
    }

    // 2. Audit Python dependencies (requirements.txt)
    const reqPath = path.resolve(targetDir, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
        try {
            const rawReq = fs.readFileSync(reqPath, 'utf8');
            const parsedPyDeps = parseRequirementsTxt(rawReq);
            const filteredPyDeps = parsedPyDeps.filter(
                (pkg) => !allowSet.has(pkg.toLowerCase())
            );

            const pypiMissing = await auditPyPiDependencies(filteredPyDeps);
            missingPackages.push(...pypiMissing);
        } catch {
            // Ignore read errors
        }
    }

    return missingPackages;
}