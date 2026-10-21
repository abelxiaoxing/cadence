export declare const CONFIG_TEMPLATE: string;

export declare function ensureUserConfig(home?: string): {
  created: boolean;
  path: string;
};

export declare function refreshAutostart(
  run?: (
    command: string,
    args: string[],
    options: { stdio: ["ignore", "ignore", "inherit"] },
  ) => unknown,
): void;
