import { execSync } from 'node:child_process';

console.log('🧪 Running vibe-shield fixture verification test...');

try {
    const stdout = execSync('node dist/cli.js scan test/fixtures', {
        encoding: 'utf-8',
        stdio: 'pipe',
    });

    console.error('❌ Test failed: Expected vibe-shield to detect vulnerabilities in test/fixtures, but none were flagged.');
    console.log('CLI output was:\n', stdout);
    process.exit(1);
} catch (err) {
    // Exit code 1 indicates vulnerabilities were successfully detected
    if (err.status === 1) {
        console.log('✅ Test passed: vibe-shield successfully detected fixture vulnerabilities with exit code 1.');
        process.exit(0);
    }

    console.error(`❌ Test encountered an unexpected execution error (status ${err.status}):`);
    if (err.stdout) console.error('STDOUT:\n', err.stdout.toString());
    if (err.stderr) console.error('STDERR:\n', err.stderr.toString());
    process.exit(err.status || 1);
}