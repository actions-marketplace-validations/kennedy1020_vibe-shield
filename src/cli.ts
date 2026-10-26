#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import { verifyDependencies } from './check-deps.js';
import { mergeFindingsToSarif } from './sarif.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();
// ... rest of src/cli.ts remains identical

function isSemgrepInstalled(): boolean {
    try {
        execSync('semgrep --version', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function printSemgrepMissingMessage(): void {
    console.error('\n❌ Error: Semgrep CLI is not installed or not found on PATH.');
    console.error('vibe-shield requires Semgrep to perform AST security analysis.\n');
    console.error('Install Semgrep for your platform:');
    console.error('  • macOS (Homebrew): brew install semgrep');
    console.error('  • Linux / WSL:      pip install semgrep');
    console.error('  • Windows:          python -m pip install semgrep\n');
}

program
    .name('vibe-shield')
    .description('Zero-config security auditor and slopsquatting detector for Next.js, Prisma, and Stripe stacks')
    .version('1.0.2');

program
    .command('scan [target]')
    .description('Audit target directory for slopsquatting and AST security flaws')
    .option('-f, --format <type>', 'Output format: text | sarif', 'text')
    .option('-o, --output <file>', 'Path to write report (default: stdout for text, vibe-shield.sarif for sarif)')
    .action(async (target = '.', options) => {
        const targetDir = path.resolve(process.cwd(), target);
        const isSarif = options.format.toLowerCase() === 'sarif';

        // 1. Verify target directory exists
        if (!fs.existsSync(targetDir)) {
            console.error(`\n❌ Error: Target path does not exist: ${targetDir}`);
            process.exit(1);
        }

        // 2. Pre-flight Check: Ensure Semgrep is accessible
        if (!isSemgrepInstalled()) {
            printSemgrepMissingMessage();
            process.exit(1);
        }

        if (!isSarif) {
            console.log(`\n🛡️  vibe-shield: Auditing ${targetDir}`);
            console.log('🔍 Auditing dependencies for AI package hallucinations (slopsquatting)...');
        }

        // 3. Stage 1: Dependency Slopsquatting Audit
        let hallucinated: string[] = [];
        try {
            hallucinated = await verifyDependencies(targetDir);
        } catch (err: any) {
            if (!isSarif) {
                console.warn(`⚠️  Warning: Could not audit package.json dependencies: ${err.message}`);
            }
        }

        if (!isSarif && hallucinated.length > 0) {
            console.error('\n❌ CRITICAL: Unregistered / Hallucinated Dependencies Detected:');
            hallucinated.forEach((pkg) => console.error(`   - ${pkg} (404 on npm registry)`));
            console.error('\nAborting scan. Verify dependencies before proceeding.');
            process.exit(1);
        }

        if (!isSarif) {
            console.log('✅ Dependencies verified against public registry.');
            console.log('🚀 Executing AST pattern analysis...');
        }

        // 4. Stage 2: Semgrep AST Rule Engine
        const ruleFile = path.resolve(__dirname, '../rules/nextjs-stack.yml');
        if (!fs.existsSync(ruleFile)) {
            console.error(`\n❌ Error: Ruleset not found at ${ruleFile}`);
            process.exit(1);
        }

        let semgrepOutput = '';
        let semgrepExitCode = 0;

        const semgrepArgs = isSarif
            ? `semgrep --config "${ruleFile}" --sarif "${targetDir}"`
            : `semgrep --config "${ruleFile}" "${targetDir}"`;

        try {
            semgrepOutput = execSync(semgrepArgs, {
                encoding: 'utf-8',
                stdio: isSarif ? ['pipe', 'pipe', 'pipe'] : 'inherit',
            });
        } catch (err: any) {
            semgrepExitCode = err.status ?? 1;
            semgrepOutput = err.stdout?.toString() || '';
        }

        // 5. Stage 3: Emit Formatted Results
        if (isSarif) {
            const mergedSarif = mergeFindingsToSarif(semgrepOutput, hallucinated, targetDir);
            const sarifJson = JSON.stringify(mergedSarif, null, 2);
            const outputFile = options.output || 'vibe-shield.sarif';
            const outputPath = path.resolve(process.cwd(), outputFile);

            fs.writeFileSync(outputPath, sarifJson, 'utf-8');
            console.log(`🛡️  vibe-shield: SARIF report written to ${outputFile}`);

            const totalFindings = mergedSarif.runs[0]?.results?.length || 0;
            process.exit(totalFindings > 0 ? 1 : 0);
        } else {
            if (semgrepExitCode !== 0) {
                console.error('\n🚨 vibe-shield detected security violations requiring resolution.\n');
                process.exit(semgrepExitCode);
            }
            console.log('\n✨ No security violations or slopsquatted packages detected.\n');
            process.exit(0);
        }
    });

program.parse(process.argv);