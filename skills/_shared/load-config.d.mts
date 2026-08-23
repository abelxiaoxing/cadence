export declare function parseEnvFile(content: string): Record<string, string>;

export declare function loadConfig(options: {
  cwd: string;
  home: string;
  required?: readonly string[];
}): { path: string; values: Record<string, string> };
