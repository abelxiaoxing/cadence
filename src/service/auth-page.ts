import { createHash } from "node:crypto";

// Only these exact stylesheet bytes are allowed on the unauthenticated page.
// No scripts, remote assets, inline attributes or credential-bearing URLs.
const styles = `
:root {
  color-scheme: light dark;
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-synthesis: none;
  --page: light-dark(#f4f5f7, #090a0d);
  --text: light-dark(#111318, #f2f4f8);
  --muted: light-dark(#5e6675, #8a93a2);
  --glass: light-dark(rgba(255,255,255,.72), rgba(22,23,27,.9));
  --glass-line: light-dark(rgba(56,59,70,.16), rgba(208,214,227,.14));
  --rim: light-dark(#ffffff, #45464c);
  --field: light-dark(#f4f5f7, #101115);
  --field-line: light-dark(#777e89, #69707d);
  --primary-a: light-dark(#445065, #c0ccde);
  --primary-b: light-dark(#5c5069, #d1c6dc);
  --on-primary: light-dark(#ffffff, #141519);
  --focus: light-dark(#525964, #adb6c5);
  --glow: light-dark(rgba(62,65,80,.09), rgba(194,188,220,.05));
  --shadow: light-dark(rgba(31,32,39,.12), rgba(0,0,0,.46));
  --error: light-dark(#843f50, #e3a6ae);
  --error-bg: light-dark(#f8eaeb, #302125);
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  place-items: center;
  padding: 28px 20px;
  color: var(--text);
  background: radial-gradient(ellipse at 50% 36%, var(--glow), transparent 46%), var(--page);
}
main {
  position: relative;
  z-index: 1;
  width: min(400px, 100%);
  padding: 40px;
  overflow: hidden;
  border: 1px solid var(--glass-line);
  border-top-color: var(--rim);
  border-radius: 24px;
  background: var(--glass);
  box-shadow:
    0 28px 80px var(--shadow),
    0 0 48px var(--glow),
    inset 0 1px 0 var(--glass-line);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  text-align: center;

}
main::before {
  content: "";
  position: absolute;
  inset: 0 18% auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--primary-a), transparent);
  opacity: 0.75;
}
.brand {
  display: grid;
  justify-items: center;
  gap: 16px;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border: 1px solid var(--glass-line);
  border-radius: 16px;
  color: var(--on-primary);
  background: linear-gradient(135deg, var(--primary-a), var(--primary-b));
  box-shadow: 0 10px 32px var(--glow);
}
.brand-mark svg {
  width: 30px;
  height: 30px;
}
h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.7px;
}
form {
  margin-top: 34px;
}
.field {
  position: relative;
  margin-bottom: 14px;
}
.field > svg {
  position: absolute;
  top: 17px;
  left: 16px;
  width: 18px;
  height: 18px;
  color: var(--muted);
  pointer-events: none;
}
input[type="password"] {
  display: block;
  width: 100%;
  height: 52px;
  padding: 0 16px 0 46px;
  border: 1px solid var(--field-line);
  border-radius: 14px;
  outline: none;
  background: var(--field);
  color: var(--text);
  font: 15px ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: 0.5px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    background 0.2s;
}
input::placeholder {
  color: var(--muted);
  font-family: ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0;
}
input:hover {
  border-color: var(--focus);
}
input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-color: var(--focus);
  box-shadow: 0 0 0 4px var(--glow);
}
input[aria-invalid="true"] {
  border-color: var(--error);
}
button {
  width: 100%;
  min-height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid var(--glass-line);
  border-radius: 14px;
  background: linear-gradient(135deg, var(--primary-a), var(--primary-b));
  color: var(--on-primary);
  font: 600 14px ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 10px 28px var(--glow);
  transition:
    transform 0.2s,
    box-shadow 0.2s,
    filter 0.2s;
}
button svg {
  width: 17px;
  height: 17px;
  transition: transform 0.2s;
}
button:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
  box-shadow: 0 14px 34px var(--glow);
}
button:hover svg {
  transform: translateX(3px);
}
button:active {
  transform: translateY(0);
}
button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 4px;
}
.notice {
  margin: 16px 0;
  padding: 10px 12px;
  border: 1px solid var(--error);
  border-radius: 12px;
  background: var(--error-bg);
  color: var(--error);
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 420px) {
  body {
    padding: 18px 14px;
  }
  main {
    padding: 32px 24px;
    border-radius: 24px;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
@media (forced-colors: active) {
  main::before {
    display: none;
  }
  body, main, .brand-mark, .notice { background:Canvas; color:CanvasText; box-shadow:none; backdrop-filter:none; }
  button { background:ButtonFace; color:ButtonText; }
  input[type="password"] { background:Field; color:FieldText; }
  main,
  input[type="password"],
  button,
  .brand-mark,
  .notice {
    border: 1px solid CanvasText;
  }
  :focus-visible { outline: 2px solid Highlight !important; outline-offset: 2px; }
}
`;

export const AUTH_PAGE_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(styles).digest("base64")}'; img-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
export interface AuthPageOptions {
  authError: boolean;
  /** Already passed through sanitizeNextPath. Never contains the submitted key. */
  nextPath: string;
}

/** A native form: same-origin referrer policy preserves Origin on Firefox POSTs. */
export function renderAuthPage(options: AuthPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f9fc">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#080a0f">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Cadence">
<link rel="manifest" href="/assets/app.webmanifest">
<link rel="icon" type="image/svg+xml" href="/assets/icon.svg">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<title>Cadence</title>
<style>${styles}</style>
</head>
<body>
<main aria-labelledby="welcome">
<div class="brand">
<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="m18 2 13 9-4 16-9 7-9-7-4-16Zm-13 9 13 5 13-5M18 2v14l-9 11m9-11 9 11m-9-11v18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
<h1 id="welcome">Cadence</h1>
</div>
${options.authError ? '<p id="auth-notice" class="notice" role="alert">Invalid access token.</p>' : ""}
<form method="post" action="/auth">
<input type="hidden" name="next" value="${escapeAttr(options.nextPath)}">
<label class="sr-only" for="key">Access token</label>
<div class="field">
<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="8" cy="9" r="4" stroke="currentColor" stroke-width="1.6"/><path d="m11 12 8 8m-3-3 2-2m-5-1 2-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
<input id="key" name="password" type="password" placeholder="Access token" autocomplete="current-password" required autofocus aria-describedby="key-hint${options.authError ? " auth-notice" : ""}"${options.authError ? ' aria-invalid="true"' : ""}>
</div>
<p id="key-hint" class="sr-only">Use the token provided by your Cadence server.</p>
<button type="submit">Enter<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
</form>
</main>
</body>
</html>
`;
}
