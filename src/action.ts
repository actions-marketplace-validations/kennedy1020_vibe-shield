import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { verifyDependencies } from './check-deps.js';
import { mergeFindingsToSarif } from './sarif.js';
import { loadConfig } from './config.js';
import { isFindingSuppressed } from './suppress.js';

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

    // 1. Load project configuration (.vibeshieldrc.json)
    const config = loadConfig(targetDir);

    // 2. Dependency Slopsquatting Audit (with allowPackages)
    core.info('🔍 Auditing dependencies for hallucinated packages...');
    const hallucinated = await verifyDependencies(targetDir, config.allowPackages);

    // 3. Semgrep AST Engine Analysis (with excludePaths and valid flags)
    const ruleFile = path.resolve(__dirname, '../rules/nextjs-stack.yml');
    if (!fs.existsSync(ruleFile)) {
      throw new Error(`Ruleset not found at path: ${ruleFile}`);
    }

    const excludeArgs = (config.excludePaths || [])
      .map((p) => `--exclude "${p}"`)
      .join(' ');

    const semgrepCmd = `semgrep --config "${ruleFile}" --no-git-ignore ${excludeArgs} --sarif "${targetDir}"`;

    let semgrepOutput = '';
    try {
      semgrepOutput = execSync(semgrepCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      semgrepOutput = err.stdout?.toString() || '';
    }

    // 4. Merge Semgrep findings with slopsquatted packages
    const mergedSarif = mergeFindingsToSarif(
      semgrepOutput,
      hallucinated,
      targetDir
    );

    // 5. Filter findings using inline comments & .vibeshieldrc.json rules
    if (mergedSarif.runs[0]) {
      mergedSarif.runs[0].results = (mergedSarif.runs[0].results || []).filter((finding) => {
        const ruleId = finding.ruleId;
        const ruleConfig = config.rules?.[ruleId];

        if (ruleConfig === 'off') {
          return false;
        }

        const fileLoc = finding.locations[0]?.physicalLocation;
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

    const results = mergedSarif.runs[0]?.results || [];
    const totalViolations = results.length;

    // 6. Emit SARIF artifact if requested
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

    // 7. Construct Markdown Summary Table
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

        core.error(message, {
          file: uri,
          startLine: line,
          title: item.ruleId,
        });
      }
    }

    await core.summary.addRaw(summaryMarkdown).write();

    if (token) {
      await postOrUpdatePrComment(token, summaryMarkdown);
    }

    if (totalViolations > 0) {
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
