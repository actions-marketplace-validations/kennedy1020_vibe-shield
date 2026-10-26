vibe-shield 🛡️
Zero-config security auditor and slopsquatting detector purpose-built for AI-generated Next.js, Prisma, and Stripe architectures.

The Problem
Modern AI pair programmers (Claude, Cursor, Copilot, ChatGPT) excel at scaffolding full-stack applications at blistering speed—colloquially known as "vibe coding." However, Large Language Models repeatedly generate subtle, severe structural anti-patterns that standard linters and TypeScript compilers miss entirely:

1. Slopsquatting & Hallucinated Packages: LLMs frequently invent non-existent npm dependencies (e.g., stripe-webhook-verifier, next-auth-middleware-helpers). Attackers monitor hallucination patterns and register these names on the public npm registry with malicious payloads.

2. Client-Side Secret Bleeding: Prefixing sensitive server credentials (STRIPE_SECRET_KEY, SERVICE_ROLE_KEY) with NEXT_PUBLIC_ exposes raw private API keys directly into public client JavaScript bundles.

3. Unsigned Stripe Webhook Handlers: Parsing webhook bodies via req.json() instead of verifying raw cryptographic HMAC signatures allows attackers to forge mock checkout.session.completed events and provision free services.

4. BOLA / IDOR Database Mutations: Executing Prisma updates or deletions scoped solely by record id without verifying tenant boundaries (userId, organizationId).

5. Unauthenticated Public Server Actions: Exposing Next.js 'use server' mutations that modify databases directly without session assertion guards at the function boundary.

vibe-shield combines an asynchronous npm registry verification engine with structural Abstract Syntax Tree (AST) pattern matching to block these vulnerabilities locally and inside CI/CD pull request gates.

Architecture: Dual-Engine Pipeline
                               Target Project Source
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         [ package.json ]                              [ app/ | pages/ | src/ ]
                 │                                               │
                 ▼                                               ▼
     Stage 1: Slopsquatting Audit                    Stage 2: Semgrep AST Parser
   Async HEAD queries against npm                    Structural pattern matching on
      Detects 404 dependencies                         Next.js, Prisma, and Stripe
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         ▼
                            Terminal / PR Annotations
                             Blocking Exit Status (0 | 1)

Prerequisites
- Node.js: >= 18.0.0

- Semgrep CLI: Required to execute AST rules.

- macOS: brew install semgrep

- Linux / WSL: pip install semgrep

- Windows: python -m pip install semgrep

(If Semgrep is missing, vibe-shield provides an automated pre-flight check with platform-specific instructions rather than failing unhandled).

Quick Start (CLI) 
Run vibe-shield on demand without local installation using npx:

Bash
npx @kennedy1020/vibe-shield scan .
To audit a specific subdirectory or monorepo workspace:

Bash
npx @kennedy1020/vibe-shield scan apps/web

Global Installation
Bash
npm install -g @kennedy1020/vibe-shield

# Run anywhere
vibe-shield scan .

Rules Matrix
        Rule ID                 Vector           Severity     Flawed Pattern             Hardened Standard
slopsquatting-hallucination    Supply-Chain      BLOCKING     Dependencies in package.json returning 404 on registry
Verified package presence on registry.npmjs.org
nextjs-public-secret-bleed     Info Disclosure    ERROR       process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY   Server-only env variables (STRIPE_SECRET_KEY)
nextjs-stripe-unsigned-webhook  Broken Auth      ERROR       const event = await req.json(); stripe.webhooks.constructEvent(rawBody, sig, secret)
nextjs-prisma-unscoped-mutation  BOLA / IDOR      ERROR        prisma.doc.delete({ where: { id } })  Multi-tenant compound clause: where: { id, userId }
nextjs-unprotected-server-action  Public RPC      WARNING       'use server' action calling DB without session check Immediate authentication guard: const session = await auth()

GitHub Actions Integration (CI/CD)
Enforce automated security reviews on incoming pull requests. When vulnerabilities are detected, vibe-shield posts inline line annotations under Files Changed and leaves a consolidated audit breakdown comment.

Create .github/workflows/security-audit.yml:
name: vibe-shield Security Audit

on:
  pull_request:
    branches: [main]

jobs:
  audit:
    name: Run vibe-shield Gate
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write # Required for inline reviews and PR comments
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Semgrep
        run: pip install semgrep

      - name: Run vibe-shield
        uses: kennedy1020/vibe-shield@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          target-dir: '.'

 Action Configuration Parameters
 Input         Required  Default  Description
 github-token   Yes        N/A      ${{ secrets.GITHUB_TOKEN }} for annotating PRs and leaving summary comments.
 target-dir      No         .      Target directory to evaluate (relative to repository root).

 Vulnerability Remediation Examples
1. Client-Side Secret Leak
❌ Vulnerable:

TypeScript
// Leaks secret key into client bundle
export const STRIPE_KEY = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;

✅ Secure:

TypeScript
// Strictly isolated to Node.js server runtime
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
}); 

2. Insecure Stripe Webhook Handling
❌ Vulnerable:

TypeScript
export async function POST(req: Request) {
  // Attacker can craft arbitrary payloads without signature verification
  const event = await req.json();
  if (event.type === 'checkout.session.completed') {
    await fulfillOrder(event.data.object);
  }
  return Response.json({ received: true });
} 

✅ Secure:

TypeScript
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature')!;
  
  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  if (event.type === 'checkout.session.completed') {
    await fulfillOrder(event.data.object);
  }
  return Response.json({ received: true });
} 

3. Unscoped Prisma Mutations (BOLA/IDOR)
❌ Vulnerable:

TypeScript
export async function deleteDocument(docId: string) {
  // Allows any authenticated user to delete another tenant's document
  return await prisma.document.delete({
    where: { id: docId }
  });
} 

✅ Secure:

TypeScript
export async function deleteDocument(docId: string, organizationId: string) {
  // Scoped strictly to the active tenant/organization
  return await prisma.document.delete({
    where: {
      id: docId,
      organizationId: organizationId
    }
  });
} 

Development & Contribution
Setup Local Environment
Bash
# Clone the repository
git clone https://github.com/kennedy1020/vibe-shield.git
cd vibe-shield

# Install dev dependencies
npm install

# Build the CLI (tsc) and standalone Action bundle (@vercel/ncc)
npm run build

# Run local test runner against test fixtures
npm run test:local 

Linking the CLI Globally for Local Testing
Bash
npm link
vibe-shield scan test/fixtures 

License
Distributed under the MIT License. Built by Kennedy Adongo. 
