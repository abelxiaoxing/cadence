export declare function parseEnvFile(content: string): Record<string, string>;

export declare function selectConfigPath(options: {
  cwd: string;
  home: string;
}): string | null;

export declare function loadConfig(options: {
  cwd: string;
  home: string;
  required?: readonly string[];
  allowMissing?: boolean;
}): { path: string | null; values: Record<string, string> };
