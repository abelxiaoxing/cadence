/** Script-free 401 password page. The native form POSTs the key to /auth; no
 * script, inline event, value backfill, localStorage or sessionStorage. The
 * only Referrer-Policy: same-origin response, so a browser (Firefox) native
 * form submission carries a valid Origin. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
export interface AuthPageOptions {
  /** Show the neutral failure notice (?auth_error=1). */
  authError: boolean;
  /** Sanitized return target (already passed through sanitizeNextPath). */
  nextPath: string;
}
export function renderAuthPage(options: AuthPageOptions): string {
  const next = escapeAttr(options.nextPath);
  const notice = options.authError
    ? `<p class="notice">Access key was not accepted. Check the current key and try again.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cadence access</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0f1115;color:#e6e8ee}
.card{width:100%;max-width:420px;background:#171a21;border:1px solid #2a2f3a;border-radius:12px;padding:28px}
h1{font-size:18px;margin:0 0 6px}
.desc{font-size:14px;color:#9aa3b2;margin:0 0 18px;line-height:1.5}
.notice{font-size:13px;color:#fde68a;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:10px 12px;margin:0 0 16px}
label{display:block;font-size:13px;color:#9aa3b2;margin-bottom:6px}
input[type=password]{width:100%;box-sizing:border-box;background:#0f1115;border:1px solid #2a2f3a;border-radius:8px;color:#e6e8ee;padding:10px 12px;font-size:14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
button{width:100%;margin-top:16px;background:#3b82f6;border:0;border-radius:8px;color:#fff;padding:11px 16px;font-size:14px;font-weight:500;cursor:pointer}
button:hover{background:#2563eb}
</style>
</head>
<body>
<div class="card">
<h1>Cadence</h1>
<p class="desc">Enter the access key for this workspace to continue.</p>
${notice}
<form method="post" action="/auth">
<input type="hidden" name="next" value="${next}">
<label for="key">Access key</label>
<input id="key" name="password" type="password" autocomplete="current-password" autofocus>
<button type="submit">Continue</button>
</form>
</div>
</body>
</html>
`;
}
