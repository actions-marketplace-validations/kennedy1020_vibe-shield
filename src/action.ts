import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { verifyDependencies } from './check-deps.js';
import { mergeFindingsToSarif } from './sarif.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function postOrUpdatePrComment(
  token: string,
  commentBody: string
): Promise<void> {
  const context = github.context;
  if (!context.payload.pull_request) {
    core.info('Not a pull request; skipping PR comment.');
    return;
  }

  const octokit = github.getOctokit(token);
  const prNumber = context.payload.pull_request.number;
  const { owner, repo } = context.repo;
  const headerMarker = '<!-- vibe-shield-scan-summary -->';
  const fullBody = `${headerMarker}\n${commentBody}`;

  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    const existingComment = comments.find((c) =>
      c.body?.includes(headerMarker)
    );

    if (existingComment) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingComment.id,
        body: fullBody,
      });
      core.info(`Updated existing vibe-shield comment on PR #${prNumber}`);
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: fullBody,
      });
      core.info(`Created vibe-shield comment on PR #${prNumber}`);
    }
  } catch (err: any) {
    core.warning(`Failed to post/update PR comment: ${err.message}`);
  }
}

async function run(): Promise<void> {
  try {
    const targetDir = path.resolve(
      process.cwd(),
      core.getInput('target-dir') || '.'
    );
    const token = core.getInput('github-token');
    const generateSarif = core.getBooleanInput('sarif');
    const sarifOutputFilename = 'vibe-shield.sarif';

    core.info(`🛡️ Starting vibe-shield scan on ${targetDir}`);

    // 1. Dependency Slopsquatting Audit
    core.info('🔍 Auditing dependencies for hallucinated packages...');
    const hallucinated = await verifyDependencies(targetDir);

    // 2. Semgrep AST Engine Analysis
    const ruleFile = path.resolve(__dirname, '../rules/nextjs-stack.yml');
    if (!fs.existsSync(ruleFile)) {
      throw new Error(`Ruleset not found at path: ${ruleFile}`);
    }

    let semgrepOutput = '';
    let semgrepExitCode = 0;

    // Run Semgrep with --sarif output mode
    const semgrepCmd = `semgrep --config "${ruleFile}" --sarif "${targetDir}"`;

    try {
      semgrepOutput = execSync(semgrepCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      semgrepExitCode = err.status ?? 1;
      semgrepOutput = err.stdout?.toString() || '';
    }

    // 3. Merge Semgrep AST results with slopsquatted dependencies
    const mergedSarif = mergeFindingsToSarif(
      semgrepOutput,
      hallucinated,
      targetDir
    );
    const results = mergedSarif.runs[0]?.results || [];
    const totalViolations = results.length;

    // 4. Emit SARIF artifact if requested
    if (generateSarif) {
      const sarifPath = path.resolve(process.cwd(), sarifOutputFilename);
      fs.writeFileSync(
        sarifPath,
        JSON.stringify(mergedSarif, null, 2),
        'utf-8'
      );
      core.setOutput('sarif-file', sarifPath);
      core.info(`📄 SARIF report generated at ${sarifPath}`);
    }

    // 5. Construct Markdown Summary Table
    let summaryMarkdown = `## 🛡️ vibe-shield Security Audit\n\n`;

    if (totalViolations === 0) {
      summaryMarkdown += `✅ **All checks passed.** No slopsquatted packages or AST vulnerabilities detected.\n`;
    } else {
      summaryMarkdown += `🚨 **Detected ${totalViolations} security issue(s) requiring attention:**\n\n`;
      summaryMarkdown += `| Severity | Rule ID | Location | Details |\n`;
      summaryMarkdown += `| :--- | :--- | :--- | :--- |\n`;

      for (const item of results) {
        const levelIcon =
          item.level === 'error'
            ? '🔴 ERROR'
            : item.level === 'warning'
            ? '🟡 WARN'
            : '🔵 NOTE';
        const fileLoc = item.locations[0]?.physicalLocation;
        const uri = fileLoc?.artifactLocation?.uri || 'unknown';
        const line = fileLoc?.region?.startLine ?? 1;
        const locationStr = `\`${uri}:${line}\``;
        const message = item.message?.text?.replace(/\n/g, ' ') || '';

        summaryMarkdown += `| ${levelIcon} | \`${item.ruleId}\` | ${locationStr} | ${message} |\n`;

        // Emit native GitHub workflow annotations in diff
        core.error(message, {
          file: uri,
          startLine: line,
          title: item.ruleId,
        });
      }
    }

    // Write to GitHub Job Summary tab
    await core.summary.addRaw(summaryMarkdown).write();

    // 6. Post/Update Pull Request Comment if token provided
    if (token) {
      await postOrUpdatePrComment(token, summaryMarkdown);
    }

    // 7. Fail Action if violations were found
    if (totalViolations > 0 || semgrepExitCode !== 0) {
      core.setFailed(
        `vibe-shield scan failed with ${totalViolations} security violation(s).`
      );
    } else {
      core.info('✅ vibe-shield completed successfully with zero violations.');
    }
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

run();
