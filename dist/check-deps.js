import fs from 'node:fs';
import path from 'node:path';
const REQUEST_TIMEOUT_MS = 4000;
const CONCURRENT_BATCH_SIZE = 15;
const NON_REGISTRY_PROTOCOLS = [
    'workspace:',
    'file:',
    'link:',
    'portal:',
    'git:',
    'git+ssh:',
    'git+http:',
    'git+https:',
    'http:',
    'https:',
    'patch:',
];
/**
 * Resolves the real registry target for a dependency entry.
 * Handles protocol filtering (workspace:, file:, git:) and npm aliases (npm:pkg@version).
 */
export function resolvePackageTarget(name, rawVersion) {
    if (typeof rawVersion !== 'string') {
        return { shouldProbe: false, probeName: name };
    }
    const version = rawVersion.trim();
    // 1. Skip local files, monorepo workspaces, and direct git repositories
    const isNonRegistry = NON_REGISTRY_PROTOCOLS.some((proto) => version.startsWith(proto));
    if (isNonRegistry) {
        return { shouldProbe: false, probeName: name };
    }
    // 2. Resolve npm aliases (e.g. "old-react": "npm:react@^17.0.0" or "npm:@scope/pkg@1.0.0")
    if (version.startsWith('npm:')) {
        const spec = version.slice(4).trim();
        let targetName;
        if (spec.startsWith('@')) {
            const slashIdx = spec.indexOf('/');
            if (slashIdx === -1) {
                targetName = spec.split('@')[0];
            }
            else {
                const afterSlash = spec.slice(slashIdx + 1);
                const atIdx = afterSlash.indexOf('@');
                targetName = atIdx === -1 ? spec : spec.slice(0, slashIdx + 1 + atIdx);
            }
        }
        else {
            targetName = spec.split('@')[0];
        }
        return {
            shouldProbe: Boolean(targetName),
            probeName: targetName || name,
        };
    }
    return { shouldProbe: true, probeName: name };
}
/**
 * Executes async tasks in bounded batches to prevent 429 Rate Limits
 * and OS socket exhaustion when analyzing hundreds of dependencies.
 */
async function runInBatches(items, batchSize, task) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(task));
        results.push(...batchResults);
    }
    return results;
}
/**
 * Checks an object of npm package dependencies against the npm registry.
 * Returns an array of package names that return 404 (hallucinated / slopsquatted).
 */
export async function auditDependencies(deps) {
    const entries = Object.entries(deps || {});
    const toProbe = [];
    for (const [name, version] of entries) {
        const { shouldProbe, probeName } = resolvePackageTarget(name, version);
        if (shouldProbe) {
            toProbe.push({ reportedName: name, probeName });
        }
    }
    const missing = [];
    await runInBatches(toProbe, CONCURRENT_BATCH_SIZE, async ({ reportedName, probeName }) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const encodedPkg = probeName.startsWith('@')
                ? `@${encodeURIComponent(probeName.slice(1))}`
                : encodeURIComponent(probeName);
            const res = await fetch(`https://registry.npmjs.org/${encodedPkg}`, {
                method: 'HEAD',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8',
                    'User-Agent': 'SafeKen-VibeShield/1.1.2',
                },
            });
            if (res.status === 404) {
                missing.push(reportedName);
            }
        }
        catch {
            // Timeouts, AbortError, or DNS errors do not trigger false 404 alerts
        }
        finally {
            clearTimeout(timeout);
        }
    });
    return missing;
}
/**
 * Checks an array of Python package names against the official PyPI registry.
 * Returns an array of package names that return 404 (hallucinated / unregistered).
 */
export async function auditPyPiDependencies(deps) {
    const missing = [];
    await runInBatches(deps, CONCURRENT_BATCH_SIZE, async (pkg) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {
                method: 'HEAD',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'SafeKen-VibeShield/1.1.2',
                },
            });
            if (res.status === 404) {
                missing.push(pkg);
            }
        }
        catch {
            // Network drops / timeouts don't count as 404s
        }
        finally {
            clearTimeout(timeout);
        }
    });
    return missing;
}
/**
 * Extracts clean package names from a requirements.txt file,
 * stripping version specifiers, comments, extras, and environment markers.
 */
export function parseRequirementsTxt(content) {
    return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
        .map((line) => {
        // Strip inline comments (#) and environment markers (; sys_platform == 'win32')
        const cleanLine = line.split('#')[0].split(';')[0].trim();
        // Match base package name, stopping before extras [standard] or version operators (<, =, >, ~)
        const match = cleanLine.match(/^([a-zA-Z0-9_\-\.]+)/);
        return match ? match[1].toLowerCase() : '';
    })
        .filter((pkg) => Boolean(pkg));
}
/**
 * Discovers and verifies both package.json (npm) and requirements.txt (PyPI)
 * in the target directory, excluding any package specified in allowPackages.
 */
export async function verifyDependencies(targetDir, allowPackages = []) {
    const allowSet = new Set(allowPackages.map((p) => p.toLowerCase()));
    const missingPackages = [];
    // 1. Audit npm dependencies (package.json)
    const pkgPath = path.resolve(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const raw = fs.readFileSync(pkgPath, 'utf8');
            const pkg = JSON.parse(raw);
            const allDeps = {
                ...(pkg.dependencies || {}),
                ...(pkg.devDependencies || {}),
            };
            const filteredDeps = {};
            for (const [name, version] of Object.entries(allDeps)) {
                if (!allowSet.has(name.toLowerCase())) {
                    filteredDeps[name] = version;
                }
            }
            const npmMissing = await auditDependencies(filteredDeps);
            missingPackages.push(...npmMissing);
        }
        catch {
            // Ignore read / malformed JSON errors
        }
    }
    // 2. Audit Python dependencies (requirements.txt)
    const reqPath = path.resolve(targetDir, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
        try {
            const rawReq = fs.readFileSync(reqPath, 'utf8');
            const parsedPyDeps = parseRequirementsTxt(rawReq);
            const filteredPyDeps = parsedPyDeps.filter((pkg) => !allowSet.has(pkg.toLowerCase()));
            const pypiMissing = await auditPyPiDependencies(filteredPyDeps);
            missingPackages.push(...pypiMissing);
        }
        catch {
            // Ignore read errors
        }
    }
    return missingPackages;
}
