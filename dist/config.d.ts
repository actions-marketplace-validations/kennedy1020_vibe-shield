export interface VibeShieldConfig {
    allowPackages?: string[];
    excludePaths?: string[];
    rules?: Record<string, 'off' | 'warning' | 'error'>;
}
export declare function loadConfig(targetDir: string): VibeShieldConfig;
