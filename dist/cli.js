#!/usr/bin/env node
import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { auditDependencies } from './check-deps.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function checkSemgrepInstalled() {
    try {
        execSync('semgrep --version', { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
const program = new Command();
program
    .name('vibe-shield')
    .description('Static analysis security scanner and slopsquatting detector for Next.js stacks')
    .version('1.0.1');
program
    .command('scan [target]')
    .description('Audit target directory for package hallucinations and code vulnerabilities')
    .action(async (target = '.') => {
    const targetDir = path.resolve(process.cwd(), target);
    console.log(`\n🛡️  vibe-shield: Auditing ${targetDir}\n`);
    // Pre-flight check: Verify Semgrep presence before starting the audit
    if (!checkSemgrepInstalled()) {
        console.error('❌ vibe-shield requires Semgrep CLI for AST pattern analysis.\n');
        console.error('Install it via your package manager:');
        console.error('  • macOS:   brew install semgrep');
        console.error('  • Windows: python -m pip install semgrep');
        console.error('  • Linux:   pip install semgrep\n');
        process.exit(1);
    }
    // 1. Dependency Slopsquatting Audit
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        console.log('🔍 Auditing dependencies for AI package hallucinations (slopsquatting)...');
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const missing = await auditDependencies(deps);
            if (missing.length > 0) {
                console.error('\n❌ CRITICAL: Unregistered / Hallucinated Dependencies Detected:');
                missing.forEach((pkgName) => console.error(`   - ${pkgName} (404 on npm registry)`));
                console.error('\nAborting scan. Verify dependencies before running AST analysis.\n');
                process.exit(1);
            }
            console.log('✅ Dependencies verified against public registry.\n');
        }
        catch (err) {
            const error = err;
            console.warn(`⚠️  Dependency verification skipped: Failed to parse ${pkgPath}: ${error.message}\n`);
        }
    }
    // 2. Semgrep Static Analysis
    const rulesPath = path.resolve(__dirname, '../rules/nextjs-stack.yml');
    console.log(`🚀 Executing AST pattern analysis using rules: ${rulesPath}\n`);
    const semgrep = spawn('semgrep', ['scan', '--config', rulesPath, '--error', targetDir], { stdio: 'inherit' });
    semgrep.on('close', (code) => {
        if (code === 0) {
            console.log('\n✨ Audit clean: Zero high-severity anti-patterns detected.\n');
        }
        else {
            console.log('\n🚨 vibe-shield detected security violations requiring resolution.\n');
        }
        process.exit(code ?? 0);
    });
    semgrep.on('error', (err) => {
        console.error(`\n❌ Execution error: ${err.message}\n`);
        process.exit(1);
    });
});
program.parse(process.argv);
