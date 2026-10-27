import fs from 'node:fs';
import path from 'node:path';
// Matches: // vibe-shield-ignore: rule-name, other-rule
// or:      // vibe-shield-ignore-next-line: rule-name
const IGNORE_REGEX = /\/\/\s*vibe-shield-ignore(?:-next-line)?:\s*([a-zA-Z0-9_,\-\s*]+)/;
const fileCache = new Map();
function getFileLines(filePath) {
    if (!fileCache.has(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            fileCache.set(filePath, content.split(/\r?\n/));
        }
        catch {
            fileCache.set(filePath, []);
        }
    }
    return fileCache.get(filePath);
}
export function isFindingSuppressed(targetDir, relativeFilePath, startLine, ruleId) {
    const absolutePath = path.resolve(targetDir, relativeFilePath);
    const lines = getFileLines(absolutePath);
    if (lines.length === 0 || startLine < 1 || startLine > lines.length) {
        return false;
    }
    // Check the line itself (line index = startLine - 1)
    const currentLine = lines[startLine - 1] || '';
    // Check the previous line (line index = startLine - 2)
    const previousLine = startLine > 1 ? lines[startLine - 2] || '' : '';
    for (const line of [currentLine, previousLine]) {
        const match = line.match(IGNORE_REGEX);
        if (match && match[1]) {
            const rules = match[1].split(',').map((r) => r.trim());
            if (rules.includes('*') || rules.includes(ruleId)) {
                return true;
            }
        }
    }
    return false;
}
