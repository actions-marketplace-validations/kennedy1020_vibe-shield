import fs from 'node:fs';
import path from 'node:path';

export interface VibeShieldConfig {
  allowPackages?: string[];
  excludePaths?: string[];
  rules?: Record<string, 'off' | 'warning' | 'error'>;
}

const DEFAULT_CONFIG: VibeShieldConfig = {
  allowPackages: [],
  excludePaths: ['node_modules/**', '.next/**', 'dist/**', 'coverage/**'],
  rules: {},
};

export function loadConfig(targetDir: string): VibeShieldConfig {
  const configPath = path.resolve(targetDir, '.vibeshieldrc.json');

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    return {
      allowPackages: Array.isArray(parsed.allowPackages) ? parsed.allowPackages : [],
      excludePaths: Array.isArray(parsed.excludePaths)
        ? [...DEFAULT_CONFIG.excludePaths!, ...parsed.excludePaths]
        : DEFAULT_CONFIG.excludePaths,
      rules: typeof parsed.rules === 'object' && parsed.rules !== null ? parsed.rules : {},
    };
  } catch (err: any) {
    console.warn(`⚠️ Warning: Failed to parse .vibeshieldrc.json: ${err.message}. Using defaults.`);
    return DEFAULT_CONFIG;
  }
}