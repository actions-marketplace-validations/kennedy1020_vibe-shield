import fs from 'node:fs';
import path from 'node:path';

/**
 * Checks an object of package dependencies against the npm registry.
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
 * Reads package.json in targetDir and audits all dependencies.
 */
export async function verifyDependencies(targetDir: string): Promise<string[]> {
  const pkgPath = path.resolve(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    return await auditDependencies(allDeps);
  } catch {
    return [];
  }
}