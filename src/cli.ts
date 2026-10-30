#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { Command } from 'commander';
import { verifyDependencies } from './check-deps.js';
import { mergeFindingsToSarif } from './sarif.js';
import { loadConfig } from './config.js';
import { isFindingSuppressed } from './suppress.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_STDOUT_BUFFER = 50 * 1024 * 1024;

// Globs formatted specifically to match both Windows (\) and POSIX (/) path separators
const DEFAULT_EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/.next/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/venv/**',
  '**/.venv/**',
  '**/__pycache__/**',
  '**/*.min.js',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
];

const program = new Command();

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
  console.error('  • Windows:          python -m pip install semgrep');
  console.error('  • Linux / WSL:      pip install semgrep');
  console.error('  • macOS (Homebrew): brew install semgrep\n');
}

program
  .name('vibe-shield')
  .description('Zero-config security auditor and slopsquatting detector for Next.js, Prisma, and Stripe stacks')
  .version('1.1.6');

program
  .command('scan [target]')
  .description('Audit target directory for slopsquatting and AST security flaws')
  .option('-f, --format <type>', 'Output format: text | sarif', 'text')
  .option('-o, --output <file>', 'Path to write report (default: stdout for text, vibe-shield.sarif for sarif)')
  .option('--skip-deps', 'Skip dependency registry checks and run AST audit only', false)
  .action(async (target = '.', options) => {
    const targetDir = path.resolve(process.cwd(), target);
    const isSarif = options.format.toLowerCase() === 'sarif';

    // 1. Verify target directory
    if (!fs.existsSync(targetDir)) {
      console.error(`\n❌ Error: Target path does not exist: ${targetDir}`);
      process.exit(1);
    }

    // 2. Pre-flight check: Semgrep availability
    if (!isSemgrepInstalled()) {
      printSemgrepMissingMessage();
      process.exit(1);
    }

    // 3. Load config (.vibeshieldrc.json)
    const config = loadConfig(targetDir);

    if (!isSarif) {
      console.log(`\n🛡️  vibe-shield: Auditing ${targetDir}\n`);
    }

    // 4. Stage 1: Dependency Registry Audit
    let hallucinated: string[] = [];
    if (!options.skipDeps) {
      if (!isSarif) {
        process.stdout.write('  [1/2] 🔍 Probing dependencies against npm & PyPI registries... ');
      }

      const depStartTime = performance.now();
      try {
        hallucinated = await verifyDependencies(targetDir, config.allowPackages);
        const depDuration = Math.round(performance.now() - depStartTime);

        if (!isSarif) {
          if (hallucinated.length === 0) {
            console.log(`✔ clean (${depDuration}ms)`);
          } else {
            console.log(`✖ ${hallucinated.length} hallucination(s) detected (${depDuration}ms)`);
          }
        }
      } catch (err: any) {
        if (!isSarif) {
          console.log(`⚠️  skipped (${err.message})`);
        }
      }
    } else if (!isSarif) {
      console.log('  [1/2] ⏩ Dependency audit skipped (--skip-deps)');
    }

    // 5. Stage 2: Semgrep AST Rule Engine
    const ruleFile = path.resolve(__dirname, '../rules/nextjs-stack.yml');
    if (!fs.existsSync(ruleFile)) {
      console.error(`\n❌ Error: Ruleset not found at ${ruleFile}`);
      process.exit(1);
    }

    if (!isSarif) {
      process.stdout.write('  [2/2] ⚡ Running Semgrep AST rules against source files... ');
    }

    const astStartTime = performance.now();

    // Critical flags to prevent hangs on Windows:
    // - `--metrics=off` & `--disable-version-check`: Prevents interactive prompt / network blocking
    // - `--max-target-bytes`: Skips minified files larger than 1MB
    // - `--timeout 5`: Per-file timeout to abort catastrophic regex/AST backtracking
    const semgrepArgs: string[] = [
      'scan',
      '--config', ruleFile,
      '--metrics=off',
      '--disable-version-check',
      '--max-target-bytes', '1000000',
      '--timeout', '5',
    ];

    // Merge default exclude globs with user custom excludes
    const userExcludes = Array.isArray(config.excludePaths) ? config.excludePaths : [];
    const allExcludes = Array.from(new Set([...DEFAULT_EXCLUDE_GLOBS, ...userExcludes]));

    for (const glob of allExcludes) {
      if (glob) {
        semgrepArgs.push('--exclude', glob);
      }
    }

    semgrepArgs.push('--sarif', targetDir);

    let semgrepOutput = '';
    try {
      semgrepOutput = execFileSync('semgrep', semgrepArgs, {
        encoding: 'utf-8',
        maxBuffer: MAX_STDOUT_BUFFER,
        stdio: ['ignore', 'pipe', 'pipe'], // 'ignore' on stdin is mandatory so it never awaits prompts
        shell: process.platform === 'win32',
        timeout: 30000, // Hard 30s child-process cutoff to guarantee it never freezes
      });
    } catch (err: any) {
      semgrepOutput = err.stdout?.toString() || '';
      if (!semgrepOutput && err.stderr) {
        const errorText = err.stderr.toString();
        // Ignore benign telemetry/experimental warnings
        if (!errorText.includes('Rules:') && !errorText.includes('warning')) {
          console.error(`\n⚠️  Semgrep engine warning:\n${errorText}`);
        }
      }
    }

    const astDuration = Math.round(performance.now() - astStartTime);
    if (!isSarif) {
      console.log(`✔ done (${astDuration}ms)\n`);
    }

    // 6. Stage 3: Merge & Filter Findings
    const mergedSarif = mergeFindingsToSarif(semgrepOutput, hallucinated, targetDir);

    if (mergedSarif.runs[0]) {
      mergedSarif.runs[0].results = (mergedSarif.runs[0].results || []).filter((finding) => {
        const ruleId = finding.ruleId;
        const ruleConfig = config.rules?.[ruleId];

        if (ruleConfig === 'off') {
          return false;
        }

        const fileLoc = finding.locations?.[0]?.physicalLocation;
        const uri = fileLoc?.artifactLocation?.uri || '';
        const line = fileLoc?.region?.startLine ?? 1;

        if (isFindingSuppressed(targetDir, uri, line, ruleId)) {
          return false;
        }

        if (ruleConfig === 'warning') {
          finding.level = 'warning';
        } else if (ruleConfig === 'error') {
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

      try {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(mergedSarif, null, 2), 'utf-8');
        console.log(`🛡️  vibe-shield: SARIF report written to ${outputFile}`);
      } catch (writeErr: any) {
        console.error(`\n❌ Error writing SARIF report to ${outputPath}: ${writeErr.message}`);
        process.exit(1);
      }

      process.exit(totalViolations > 0 ? 1 : 0);
    } else {
      if (totalViolations === 0) {
        console.log('✅ Dependencies verified against public registry.');
        console.log('✨ No security violations or unsuppressed flaws detected.\n');
        process.exit(0);
      }

      console.error(`🚨 Detected ${totalViolations} security issue(s):\n`);
      for (const item of activeResults) {
        const fileLoc = item.locations?.[0]?.physicalLocation;
        const uri = fileLoc?.artifactLocation?.uri || 'unknown';
        const line = fileLoc?.region?.startLine ?? 1;
        const levelTag = item.level === 'error' ? 'CRITICAL' : 'WARNING';

        console.error(`  • ${uri}:${line}`);
        console.error(`    ${levelTag} [${item.ruleId}]: ${item.message?.text || 'Security finding'}\n`);
      }

      process.exit(1);
    }
  });

program.parse(process.argv);