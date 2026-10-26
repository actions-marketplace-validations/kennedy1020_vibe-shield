#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDependencies } from './check-deps.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
    .name('vibe-shield')
    .description('Opinionated static security analysis for Next.js, Prisma, and Stripe')
    .version('0.1.0');

program
    .command('scan')
    .argument('[dir]', 'Target directory to scan', '.')
    .action(async (dir: string) => {
        const targetDir = path.resolve(process.cwd(), dir);
        console.log(`\n🛡️  vibe-shield: Auditing ${targetDir}\n`);

        // 1. Dependency Hallucination Check
        console.log('🔍 Auditing dependencies for AI package hallucinations (slopsquatting)...');
        try {
            const phantomDeps = await verifyDependencies(targetDir);
            if (phantomDeps.length > 0) {
                console.error('\n❌ CRITICAL: Unregistered / Hallucinated Dependencies Detected:');
                phantomDeps.forEach((dep) => console.error(`   - ${dep} (404 on npm registry)`));
                console.error('\nAborting. Unregistered packages pose an immediate supply-chain threat.\n');
                process.exit(1);
            }
            console.log('✅ Dependencies verified against public registry.\n');
        } catch (err) {
            console.warn(`⚠️ Dependency verification skipped: ${(err as Error).message}\n`);
        }

        // 2. Semgrep Static Analysis
        const rulesPath = path.resolve(__dirname, '../rules/nextjs-stack.yml');
        console.log(`🚀 Executing AST pattern analysis using rules: ${rulesPath}`);

        const semgrep = spawn('semgrep', ['scan', '--config', rulesPath, '--error', '--no-git-ignore', targetDir], {
            stdio: 'inherit'
        });

        semgrep.on('close', (code) => {
            if (code === 0) {
                console.log('\n✨ Audit clean: Zero high-severity anti-patterns detected.\n');
            } else {
                console.error('\n🚨 vibe-shield detected security violations requiring resolution.\n');
            }
            process.exit(code ?? 0);
        });

        semgrep.on('error', (err) => {
            console.error('\n❌ Failed to spawn Semgrep binary:');
            console.error(err.message);
            console.error('Ensure semgrep is installed and available in PATH (pip install semgrep).\n');
            process.exit(1);
        });
    });

program.parse();