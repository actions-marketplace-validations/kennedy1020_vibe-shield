import { execSync } from 'node:child_process';

console.log('🧪 Running vibe-shield fixture verification test...');

try {
  // We expect this command to exit with status 1 because test/fixtures contains intentional flaws
  execSync('node dist/cli.js scan test/fixtures', {
    stdio: 'pipe',
  });

  console.error('❌ Test failed: Expected vibe-shield to detect vulnerabilities in test/fixtures, but none were flagged.');
  process.exit(1);
} catch (err) {
  if (err.status === 1) {
    console.log('✅ Test passed: vibe-shield successfully detected fixture vulnerabilities with exit code 1.');
    process.exit(0);
  }

  console.error('❌ Test encountered an unexpected execution error:', err.message);
  process.exit(err.status || 1);
}