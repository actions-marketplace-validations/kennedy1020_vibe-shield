# vibe-shield 🛡️

[![npm version](https://img.shields.io/npm/v/@kennedy1020/vibe-shield.svg?color=blue)](https://www.npmjs.com/package/@kennedy1020/vibe-shield)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-v1.1.0-blueviolet.svg)](https://github.com/marketplace/actions/vibe-shield)

> **The Zero-Config Security Auditor for Modern AI-Generated Stacks.**  
> Catch hallucinated packages (slopsquatting), client-side secret bleeds, unverified payment webhooks, and IDOR vulnerabilities before code reaches production.

---

## ⚡ What Does vibe-shield Solve?

AI coding assistants (LLMs) accelerate web development, but introduce distinct security failure modes:
1. **Dependency Hallucinations (Slopsquatting):** Models frequently recommend nonexistent packages in `package.json` or `requirements.txt`. Attackers register these hallucinated names on npm and PyPI to distribute malware.
2. **Client-Side Secret Bleeds:** Server tokens placed into `NEXT_PUBLIC_` environment variables or Supabase service-role keys imported into `'use client'` files expose database access directly to browser devtools.
3. **Unverified Payment Webhooks:** Developers frequently parse webhook event bodies (Stripe, Paystack, PayPal) without validating cryptographic signatures, allowing attackers to forge payment confirmations.
4. **Unscoped Database Mutations:** Deleting or updating records by primary key (`id`) without verifying user or tenant identity creates Insecure Direct Object References (IDOR).

`vibe-shield` is a dual-engine auditor that runs locally via CLI and automatically in CI/CD as a GitHub Action with native SARIF v2.1.0 code-scanning integration.

---

## 🚀 Quickstart

### Run via npx (Zero Installation)

```bash
npx @kennedy1020/vibe-shield scan .

Install Globally
Bash
npm install -g @kennedy1020/vibe-shield
vibe-shield scan ./my-project 

Pre-requisites
vibe-shield uses Semgrep under the hood for AST parsing:

macOS: brew install semgrep

Linux / WSL: pip install semgrep

Windows: pip install semgrep 


🤖 GitHub Action Setup
Add vibe-shield to your CI pipeline to scan pull requests, comment findings directly on code, and block vulnerable merges.

Create .github/workflows/security.yml: 
YAML
name: vibe-shield Security Gate

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      security-events: write

    steps:
      - name: Checkout Source
        uses: actions/checkout@v4

      - name: Install Semgrep Engine
        run: pip install semgrep

      - name: Run vibe-shield Audit
        uses: kennedy1020/vibe-shield@v1.1.0
        with:
          target-dir: '.'
          github-token: ${{ secrets.GITHUB_TOKEN }}
          sarif: 'true'

      - name: Upload SARIF to GitHub Security Tab
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: vibe-shield.sarif 


📋 Detection Engine Ruleset
RuleID | Severity  | Ecosystem  | Description
slopsquatting-missing-package  |🔴 CRITICAL  |npm/PyPI  |Flags packages in package.json or requirements.txt returning HTTP 404 on public registries.nextjs-public-secret-bleed  |🔴 CRITICAL  |Next.js/React  | Detects server secrets, API tokens, or credentials bound to NEXT_PUBLIC_ variables.nextjs-supabase-service-role-client  |🔴 CRITICAL | Supabase/Next.js  |Detects SUPABASE_SERVICE_ROLE_KEY or admin clients inside 'use client' components.hardcoded-payment-live-secret  | 🔴 CRITICAL  | Stripe/Paystack  | Flags hardcoded live secret keys (sk_live_...) in application files.nextjs-stripe-unsigned-webhook  |🔴 HIGH  | Stripe/Next.js  |Flags webhook routes processing payloads without stripe.webhooks.constructEvent.nextjs-paystack-unsigned-webhook  |🔴 HIGH  | Paystack/Next.js  | Flags webhook routes processing events without HMAC SHA-512 signature verification.nextjs-paypal-unsigned-webhook  |🔴 HIGH  | PayPal/Next.js  | Flags webhook routes evaluating event_type without payload signature checks.nextjs-prisma-unscoped-mutation   |🟡 WARNING  | Prisma ORM | Flags delete or update operations keyed only on id without userId or tenantId.

⚙️ Configuration (.vibeshieldrc.json)
Customize scanner behavior, bypass private company packages, exclude directories, or tune rule strictness by creating a .vibeshieldrc.json in your repository root: 


JSON
{
  "allowPackages": [
    "@company/internal-ui",
    "@company/private-auth"
  ],
  "excludePaths": [
    "cypress/**",
    "scripts/**",
    "**/*.spec.ts"
  ],
  "rules": {
    "nextjs-prisma-unscoped-mutation": "warning",
    "nextjs-stripe-unsigned-webhook": "error",
    "nextjs-paystack-unsigned-webhook": "off"
  }
} 


🔕 Inline Comment Suppressions
Suppress false positives on specific lines without disabling rules project-wide:

TypeScript
// Suppress check on this line
// vibe-shield-ignore: nextjs-public-secret-bleed
export const PUBLIC_KEY = process.env.NEXT_PUBLIC_ANALYTICS_KEY;

// Suppress check on the following line
// vibe-shield-ignore-next-line: nextjs-prisma-unscoped-mutation
await prisma.account.delete({ where: { id: accountId } }); 


🛠️ CLI Reference
Plaintext
Usage: vibe-shield scan [options] [target]

Audit target directory for slopsquatting and AST security flaws

Options:
  -f, --format <type>  Output format: text | sarif (default: "text")
  -o, --output <file>  Path to write report (default: stdout for text, vibe-shield.sarif for sarif)
  -h, --help           display help for command 

  📄 License
MIT © vibe-shield Contributors 