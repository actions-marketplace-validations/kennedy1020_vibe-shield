import fs from 'node:fs';
import path from 'node:path';
export async function verifyDependencies(targetDir) {
    const pkgPath = path.join(targetDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return [];
    }
    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    }
    catch (err) {
        throw new Error(`Failed to parse ${pkgPath}: ${err.message}`);
    }
    const combined = {
        ...pkg.dependencies,
        ...pkg.devDependencies
    };
    const candidatePackages = Object.keys(combined).filter((dep) => {
        // Exclude scoped TypeScript definitions, relative paths, and workspace aliases
        return (!dep.startsWith('@types/') &&
            !dep.startsWith('.') &&
            !dep.startsWith('workspace:') &&
            !dep.startsWith('file:'));
    });
    const hallucinated = [];
    // Concurrently inspect npm registry for package existence
    await Promise.all(candidatePackages.map(async (dep) => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(dep)}`, {
                method: 'HEAD',
                signal: controller.signal
            });
            clearTimeout(timeout);
            if (res.status === 404) {
                hallucinated.push(dep);
            }
        }
        catch {
            // Network timeout / offline fallback: do not trigger false positive on connectivity issues
        }
    }));
    return hallucinated;
}
