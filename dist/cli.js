#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import { verifyDependencies } from './check-deps.js';
import { mergeFindingsToSarif } from './sarif.js';
import { loadConfig } from './config.js';
import { isFindingSuppressed } from './suppress.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const program = new Command();
function isSemgrepInstalled() {
    try {
        execSync('semgrep --version', { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
function printSemgrepMissingMessage() {
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
    .version('1.1.0');
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
    // 2. Pre-flight check: Semgrep availability
    if (!isSemgrepInstalled()) {
        printSemgrepMissingMessage();
        process.exit(1);
    }
    // 3. Load project configuration (.vibeshieldrc.json)
    const config = loadConfig(targetDir);
    if (!isSarif) {
        console.log(`\n🛡️  vibe-shield: Auditing ${targetDir}`);
        console.log('🔍 Auditing dependencies for AI package hallucinations (slopsquatting)...');
    }
    // 4. Stage 1: Dependency Slopsquatting Audit (with allowPackages filter)
    let hallucinated = [];
    try {
        hallucinated = await verifyDependencies(targetDir, config.allowPackages);
    }
    catch (err) {
        if (!isSarif) {
            console.warn(`⚠️  Warning: Could not audit package dependencies: ${err.message}`);
        }
    }
    // 5. Stage 2: Semgrep AST Rule Engine
    const ruleFile = path.resolve(__dirname, '../rules/nextjs-stack.yml');
    if (!fs.existsSync(ruleFile)) {
        console.error(`\n❌ Error: Ruleset not found at ${ruleFile}`);
        process.exit(1);
    }
    const excludeArgs = (config.excludePaths || [])
        .map((p) => `--exclude "${p}"`)
        .join(' ');
    const semgrepArgs = `semgrep --config "${ruleFile}" --no-git-ignore ${excludeArgs} --sarif "${targetDir}"`;
    let semgrepOutput = '';
    try {
        semgrepOutput = execSync(semgrepArgs, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    }
    catch (err) {
        semgrepOutput = err.stdout?.toString() || '';
        if (!semgrepOutput && err.stderr) {
            console.error(`\n⚠️  Semgrep engine error:\n${err.stderr.toString()}`);
        }
    }
    // 6. Merge & Filter Findings (Inline comments + Config rule overrides)
    const mergedSarif = mergeFindingsToSarif(semgrepOutput, hallucinated, targetDir);
    if (mergedSarif.runs[0]) {
        mergedSarif.runs[0].results = (mergedSarif.runs[0].results || []).filter((finding) => {
            const ruleId = finding.ruleId;
            const ruleConfig = config.rules?.[ruleId];
            // Rule disabled in .vibeshieldrc.json
            if (ruleConfig === 'off') {
                return false;
            }
            // Inline comment suppression (// vibe-shield-ignore: rule-id)
            const fileLoc = finding.locations[0]?.physicalLocation;
            const uri = fileLoc?.artifactLocation?.uri || '';
            const line = fileLoc?.region?.startLine ?? 1;
            if (isFindingSuppressed(targetDir, uri, line, ruleId)) {
                return false;
            }
            // Severity override
            if (ruleConfig === 'warning') {
                finding.level = 'warning';
            }
            else if (ruleConfig === 'error') {
                finding.level = 'error';
            }
            return true;
        });
    }
    const activeResults = mergedSarif.runs[0]?.results || [];
    const totalViolations = activeResults.length;
    // 7. Output Handling
    if (isSarif) {
        const outputFile = options.output || 'vibe-shield.sarif';
        const outputPath = path.resolve(process.cwd(), outputFile);
        fs.writeFileSync(outputPath, JSON.stringify(mergedSarif, null, 2), 'utf-8');
        console.log(`🛡️  vibe-shield: SARIF report written to ${outputFile}`);
        process.exit(totalViolations > 0 ? 1 : 0);
    }
    else {
        if (totalViolations === 0) {
            console.log('✅ Dependencies verified against public registry.');
            console.log('✨ No security violations or unsuppressed flaws detected.\n');
            process.exit(0);
        }
        console.error(`\n🚨 Detected ${totalViolations} security issue(s):\n`);
        for (const item of activeResults) {
            const fileLoc = item.locations[0]?.physicalLocation;
            const uri = fileLoc?.artifactLocation?.uri || 'unknown';
            const line = fileLoc?.region?.startLine ?? 1;
            const levelTag = item.level === 'error' ? 'CRITICAL' : 'WARNING';
            console.error(`  • ${uri}:${line}`);
            console.error(`    ${levelTag} [${item.ruleId}]: ${item.message.text}\n`);
        }
        process.exit(1);
    }
});
program.parse(process.argv);
