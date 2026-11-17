import { createHash } from "node:crypto";

// Only these exact stylesheet bytes are allowed on the unauthenticated page.
// No scripts, remote assets, inline attributes or credential-bearing URLs.
const styles = `
:root {
  color-scheme: light dark;
  font-family:
    Inter, Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-synthesis: none;
  --page: light-dark(#f5f7ff, #020617);
  --text: light-dark(#0f172a, #e6edf7);
  --muted: light-dark(#536176, #94a3b8);
  --glass: light-dark(rgba(255, 255, 255, 0.62), rgba(15, 23, 42, 0.62));
  --glass-line: light-dark(rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.1));
  --field: light-dark(rgba(255, 255, 255, 0.5), rgba(2, 6, 23, 0.48));
  --field-line: light-dark(rgba(100, 116, 139, 0.28), rgba(255, 255, 255, 0.12));
  --primary-a: light-dark(#0e7490, #22d3ee);
  --primary-b: light-dark(#1d4ed8, #60a5fa);
  --on-primary: light-dark(#ffffff, #082f49);
  --focus: light-dark(#2563eb, #22d3ee);
  --glow: light-dark(rgba(37, 99, 235, 0.22), rgba(34, 211, 238, 0.2));
  --shadow: light-dark(rgba(30, 64, 175, 0.14), rgba(0, 0, 0, 0.42));
  --mesh-a: light-dark(rgba(147, 197, 253, 0.64), rgba(34, 211, 238, 0.1));
  --mesh-b: light-dark(rgba(196, 181, 253, 0.58), rgba(37, 99, 235, 0.16));
  --mesh-c: light-dark(rgba(165, 243, 252, 0.52), rgba(99, 102, 241, 0.1));
  --grid: light-dark(rgba(37, 99, 235, 0.04), rgba(56, 189, 248, 0.055));
  --error: light-dark(#b91c1c, #fda4af);
  --error-bg: light-dark(rgba(254, 226, 226, 0.7), rgba(159, 18, 57, 0.12));
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
  background: var(--page);
}
body::before,
body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
body::before {
  background:
    radial-gradient(circle at 12% 10%, var(--mesh-a), transparent 42%),
    radial-gradient(circle at 90% 16%, var(--mesh-b), transparent 44%),
    radial-gradient(circle at 52% 100%, var(--mesh-c), transparent 48%);
}
body::after {
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at center, #000, transparent 78%);
}
main {
  position: relative;
  z-index: 1;
  width: min(400px, 100%);
  padding: 40px;
  overflow: hidden;
  border: 1px solid var(--glass-line);
  border-radius: 28px;
  background: var(--glass);
  box-shadow:
    0 28px 80px var(--shadow),
    0 0 48px var(--glow),
    inset 0 1px 0 var(--glass-line);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  text-align: center;
  animation: arrive 0.45s ease-out both;
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
  font-family: Inter, Geist, ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0;
}
input:hover {
  border-color: var(--focus);
}
input:focus-visible {
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
  font: 600 14px Inter, Geist, ui-sans-serif, system-ui, sans-serif;
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
  margin: 0 0 16px;
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
@keyframes arrive {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
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
  body::before,
  body::after,
  main::before {
    display: none;
  }
  main,
  input[type="password"],
  button,
  .brand-mark,
  .notice {
    border: 1px solid CanvasText;
  }
}
`;

export const AUTH_PAGE_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(styles).digest("base64")}'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;

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
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Cadence</title>
<style>${styles}</style>
</head>
<body>
<main aria-labelledby="welcome">
<div class="brand">
<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M25 11a9 9 0 1 0 0 14M12 18h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
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
