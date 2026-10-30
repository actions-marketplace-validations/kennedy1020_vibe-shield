import fs from 'node:fs';
import path from 'node:path';
const REQUEST_TIMEOUT_MS = 3000;
const CONCURRENT_BATCH_SIZE = 10;
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
 * Filters non-registry protocols and unpacks npm aliases (npm:pkg@version).
 */
export function resolvePackageTarget(name, rawVersion) {
    if (typeof rawVersion !== 'string') {
        return { shouldProbe: false, probeName: name };
    }
    const version = rawVersion.trim();
    // 1. Skip local files, monorepo workspaces, and git repos
    const isNonRegistry = NON_REGISTRY_PROTOCOLS.some((proto) => version.startsWith(proto));
    if (isNonRegistry) {
        return { shouldProbe: false, probeName: name };
    }
    // 2. Resolve npm aliases (e.g. "old-react": "npm:react@^17.0.0")
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
 * Executes async tasks in bounded batches to prevent socket exhaustion
 * and OS-level network deadlocks on Windows/macOS/Linux.
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
 * Checks npm dependencies against registry.npmjs.org.
 * Returns an array of package names returning HTTP 404 (hallucinations).
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
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const encodedPkg = probeName.startsWith('@')
                ? `@${encodeURIComponent(probeName.slice(1))}`
                : encodeURIComponent(probeName);
            const res = await fetch(`https://registry.npmjs.org/${encodedPkg}`, {
                method: 'HEAD',
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'SafeKen-VibeShield/1.1.4',
                },
            });
            if (res.status === 404) {
                missing.push(reportedName);
            }
        }
        catch {
            // Timeouts, AbortErrors, or transient DNS drops fail open rather than hanging
        }
        finally {
            clearTimeout(timer);
        }
    });
    return missing;
}
/**
 * Checks Python package names against pypi.org.
 * Returns an array of package names returning HTTP 404.
 */
export async function auditPyPiDependencies(deps) {
    const missing = [];
    await runInBatches(deps, CONCURRENT_BATCH_SIZE, async (pkg) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {
                method: 'HEAD',
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'SafeKen-VibeShield/1.1.4',
                },
            });
            if (res.status === 404) {
                missing.push(pkg);
            }
        }
        catch {
            // Timeouts or transient network errors fail open
        }
        finally {
            clearTimeout(timer);
        }
    });
    return missing;
}
/**
 * Extracts clean package names from requirements.txt,
 * stripping inline comments, version constraints, extras, and environment markers.
 */
export function parseRequirementsTxt(content) {
    return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
        .map((line) => {
        const cleanLine = line.split('#')[0].split(';')[0].trim();
        const match = cleanLine.match(/^([a-zA-Z0-9_\-\.]+)/);
        if (!match)
            return '';
        // PEP 503 normalization: lowercase and canonicalize runs of [._-]
        return match[1].toLowerCase().replace(/[-_.]+/g, '-');
    })
        .filter((pkg) => Boolean(pkg));
}
/**
 * Discovers and audits package.json (npm) and requirements.txt (PyPI).
 * Automatically resolves files in targetDir or falls back to process.cwd().
 */
export async function verifyDependencies(targetDir, allowPackages = []) {
    const allowSet = new Set(allowPackages.map((p) => p.toLowerCase()));
    const missingPackages = [];
    // 1. Audit npm dependencies (locate in targetDir or fallback to cwd)
    let pkgPath = path.resolve(targetDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        const cwdPkg = path.resolve(process.cwd(), 'package.json');
        if (fs.existsSync(cwdPkg)) {
            pkgPath = cwdPkg;
        }
    }
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
            // Ignore read or JSON parse errors
        }
    }
    // 2. Audit Python dependencies (locate in targetDir or fallback to cwd)
    let reqPath = path.resolve(targetDir, 'requirements.txt');
    if (!fs.existsSync(reqPath)) {
        const cwdReq = path.resolve(process.cwd(), 'requirements.txt');
        if (fs.existsSync(cwdReq)) {
            reqPath = cwdReq;
        }
    }
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
