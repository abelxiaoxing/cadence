/** Node 22 marks its built-in env-proxy agent experimental on stderr when
 * NODE_USE_ENV_PROXY/--use-env-proxy is active. That runtime notice is not
 * Cadence output; strip exactly it so any other stderr still fails. */
const notice =
  /^\(node:\d+\) \[UNDICI-EHPA\] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time\.\r?\n(?:\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n)?/gm;

export function withoutNodeProxyNotice(stderr: string): string {
  return stderr.replace(notice, "");
}
