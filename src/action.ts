import * as core from '@actions/core';
import * as github from '@actions/github';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDependencies } from './check-deps.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SemgrepMatch {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;
  };
}

interface SemgrepReport {
  results: SemgrepMatch[];
  errors: unknown[];
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token');
    const targetDir = core.getInput('target-dir') || '.';
    const octokit = github.getOctokit(token);
    const context = github.context;

    core.info(`Running vibe-shield against target: ${targetDir}`);

    // 1. Dependency Hallucination Check
    const phantomDeps = await verifyDependencies(targetDir);
    if (phantomDeps.length > 0) {
      const depMsg = `Supply-chain risk: Unregistered packages detected: ${phantomDeps.join(', ')}`;
      core.setFailed(depMsg);
      return;
    }

    // 2. Semgrep JSON Execution
    const rulesPath = path.resolve(__dirname, '../rules/nextjs-stack.yml');
    let stdout = '';
    try {
      const res = await execAsync(
        `semgrep scan --config "${rulesPath}" --no-git-ignore --json "${targetDir}"`
      );
      stdout = res.stdout;
    } catch (err: unknown) {
      // Semgrep returns exit status 1 when findings exist
      const execError = err as { stdout?: string };
      stdout = execError.stdout || '';
    }

    let report: SemgrepReport;
    try {
      report = JSON.parse(stdout || '{"results":[]}');
    } catch {
      core.setFailed(`Failed to parse Semgrep JSON output: ${stdout}`);
      return;
    }

    const matches = report.results || [];

    if (matches.length === 0) {
      core.info('✅ vibe-shield: No vulnerabilities detected.');
      return;
    }

    // 3. Line-level Annotations in the "Files Changed" tab
    for (const match of matches) {
      core.error(match.extra.message, {
        file: match.path,
        startLine: match.start.line,
        endLine: match.end.line,
        title: `vibe-shield: ${match.check_id}`
      });
    }

    // 4. Consolidated Pull Request Comment
    if (context.payload.pull_request) {
      const prNumber = context.payload.pull_request.number;
      let body = `## 🚨 vibe-shield Security Gate: Violations Found\n\n`;
      body += `Scanned target \`${targetDir}\` and found **${matches.length}** high-severity pattern(s):\n\n`;

      matches.forEach((m, idx) => {
        body += `### ${idx + 1}. \`${m.check_id}\`\n`;
        body += `* **File:** \`${m.path}#L${m.start.line}\`\n`;
        body += `* **Severity:** \`${m.extra.severity}\`\n\n`;
        body += `> ${m.extra.message.trim().replace(/\n/g, '\n> ')}\n\n`;
      });

      body += `\n*Action required: Remediate the issues listed above or check the inline annotations in **Files Changed** to unblock deployment.*`;

      await octokit.rest.issues.createComment({
        ...context.repo,
        issue_number: prNumber,
        body
      });
    }

    core.setFailed(`vibe-shield audit failed with ${matches.length} issue(s).`);
  } catch (error: unknown) {
    core.setFailed(`vibe-shield execution failure: ${(error as Error).message}`);
  }
}

run();