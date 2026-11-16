import { createHash } from "node:crypto";

// Only these exact stylesheet bytes are allowed on the unauthenticated page.
// No scripts, remote assets, inline attributes or credential-bearing URLs.
const styles = `
:root {
  color-scheme: dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #edf4f1;
  background: #0a100f;
  font-synthesis: none;
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
  padding: 40px 28px;
  background:
    radial-gradient(ellipse at 12% 5%, #183a302e, transparent 55%),
    radial-gradient(ellipse at 90% 95%, #253b492e, transparent 50%), #0a100f;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(#9bc6b605 1px, transparent 1px),
    linear-gradient(90deg, #9bc6b605 1px, transparent 1px);
  background-size: 64px 64px;
}
main {
  position: relative;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  width: min(1080px, 100%);
  min-height: 650px;
  border: 1px solid #b2d6c51c;
  border-radius: 28px;
  overflow: hidden;
  background: #101916;
  box-shadow: 0 40px 100px #0005;
}
.story {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 42px 48px;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse at 25% 80%, #2e6f4d40, transparent 65%),
    linear-gradient(145deg, #172922, #101c19);
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.7px;
}
.brand svg {
  width: 34px;
  height: 34px;
  color: #b8f3ce;
}
.intro {
  position: relative;
  z-index: 1;
  margin-top: 76px;
}
.eyebrow {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2.3px;
  text-transform: uppercase;
  color: #a4bdb1;
  margin: 0 0 19px;
}
.headline {
  font-size: clamp(42px, 4.4vw, 58px);
  font-weight: 450;
  line-height: 1.08;
  letter-spacing: -2.7px;
  margin: 0;
}
.headline em {
  font-style: normal;
  color: #bbf4cf;
}
.lede {
  max-width: 310px;
  margin: 24px 0 0;
  color: #a8beb2;
  font-size: 14px;
  line-height: 1.75;
}
.orbit {
  position: absolute;
  z-index: -1;
  width: 430px;
  height: 430px;
  right: -180px;
  bottom: -175px;
  border: 1px solid #b8f3ce30;
  border-radius: 50%;
  box-shadow:
    0 0 80px #8affac09,
    inset 0 0 80px #8affac09;
}
.orbit::before,
.orbit::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  border: 1px solid #b8f3ce1a;
  inset: 44px;
}
.orbit::after {
  inset: -48px;
  border-style: dashed;
  border-color: #b8f3ce17;
}
.satellite {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  animation: orbit 36s linear infinite;
}
.satellite::before {
  content: "";
  position: absolute;
  top: 60px;
  left: 60px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c2f6d3;
  box-shadow: 0 0 24px #b6ffcd88;
}
.rhythm {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: auto;
  padding-top: 72px;
  font-size: 11px;
  color: #b0c4b8;
  letter-spacing: 0.3px;
}
.rhythm span {
  color: #638273;
}
.entry {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 64px 56px;
  background: linear-gradient(150deg, #16201b66, transparent 65%);
}
.access {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  border: 1px solid #d6f3e51a;
  border-radius: 999px;
  padding: 7px 10px;
  font-size: 10px;
  letter-spacing: 1.4px;
  color: #bed2c5;
  text-transform: uppercase;
  margin-bottom: 30px;
}
.access svg {
  width: 12px;
  height: 12px;
  color: #b8edc7;
}
h1 {
  font-size: 32px;
  line-height: 1.2;
  font-weight: 500;
  letter-spacing: -1.2px;
  margin: 0 0 12px;
}
.description {
  font-size: 14px;
  color: #a5b5ab;
  line-height: 1.65;
  margin: 0 0 32px;
}
label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #d1e0d6;
  margin-bottom: 10px;
}
.field {
  position: relative;
}
.field svg {
  position: absolute;
  left: 16px;
  top: 18px;
  width: 18px;
  height: 18px;
  color: #849e8e;
  pointer-events: none;
}
input[type="password"] {
  display: block;
  width: 100%;
  height: 54px;
  border: 1px solid #c2e7cf26;
  border-radius: 10px;
  background: #0b130f;
  color: #edf4f1;
  padding: 0 16px 0 46px;
  font:
    16px ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  letter-spacing: 1px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
input::placeholder {
  font:
    13px ui-sans-serif,
    system-ui,
    sans-serif;
  letter-spacing: 0;
  color: #7f9588;
}
input:hover {
  border-color: #a9d9b950;
}
input:focus-visible {
  outline: 2px solid #b8f3ce;
  outline-offset: 3px;
  border-color: #b8f3ce;
}
input[aria-invalid="true"] {
  border-color: #e5aa87;
}
.hint {
  margin: 10px 0 24px;
  font-size: 12px;
  line-height: 1.6;
  color: #92a99a;
}
button {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px solid #d8ffe0;
  border-radius: 10px;
  background: #c5f5d4;
  color: #14271c;
  font:
    600 13px ui-sans-serif,
    system-ui,
    sans-serif;
  cursor: pointer;
  box-shadow: 0 4px 24px #9cffbb0a;
  transition:
    background 0.2s,
    transform 0.2s,
    box-shadow 0.2s;
}
button svg {
  width: 17px;
  height: 17px;
  transition: transform 0.2s;
}
button:hover {
  background: #d8ffe3;
  box-shadow: 0 4px 28px #9cffbb1c;
  transform: translateY(-1px);
}
button:hover svg {
  transform: translateX(3px);
}
button:active {
  transform: translateY(0);
}
button:focus-visible {
  outline: 2px solid #c5f5d4;
  outline-offset: 4px;
}
.remember {
  margin: 22px auto 0;
  max-width: 270px;
  text-align: center;
  color: #91a799;
  font-size: 11px;
  line-height: 1.8;
}
.notice {
  font-size: 12px;
  color: #f4c6a9;
  background: #a34a2019;
  border: 1px solid #dca47c40;
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0 0 20px;
  line-height: 1.65;
}
footer {
  position: relative;
  grid-column: 1 / -1;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  width: min(1080px, 100%);
  padding: 20px 8px 0;
  color: #829b8b;
  font-size: 10px;
  letter-spacing: 0.3px;
}
.shell {
  width: 100%;
  display: grid;
  justify-items: center;
}
@keyframes orbit {
  to {
    transform: rotate(360deg);
  }
}
@media (min-width: 1600px) {
  main {
    min-height: 700px;
  }
  .intro {
    margin-top: 100px;
  }
}
@media (max-width: 800px) {
  body {
    padding: 24px 18px;
  }
  main {
    grid-template-columns: 1fr;
    max-width: 480px;
    min-height: 0;
    border-radius: 22px;
  }
  .story {
    padding: 28px 30px 30px;
  }
  .intro {
    margin-top: 34px;
  }
  .headline {
    font-size: 40px;
    letter-spacing: -1.8px;
  }
  .headline br {
    display: none;
  }
  .lede {
    font-size: 13px;
    margin-top: 14px;
    max-width: 340px;
  }
  .rhythm {
    display: none;
  }
  .orbit {
    width: 320px;
    height: 320px;
    right: -180px;
    bottom: -215px;
  }
  .entry {
    padding: 32px 30px 36px;
  }
  .access {
    margin-bottom: 22px;
  }
  h1 {
    font-size: 28px;
  }
  .description {
    margin-bottom: 26px;
  }
  footer {
    max-width: 480px;
    padding-top: 16px;
    font-size: 9px;
  }
  .eyebrow {
    margin-bottom: 12px;
  }
}
@media (max-width: 360px) {
  body {
    padding: 14px 10px;
  }
  .story,
  .entry {
    padding-left: 22px;
    padding-right: 22px;
  }
  .headline {
    font-size: 36px;
  }
  footer {
    flex-wrap: wrap;
    gap: 6px;
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
  main,
  input[type="password"],
  button,
  .access,
  .notice {
    border: 1px solid CanvasText;
  }
  .orbit {
    display: none;
  }
  .headline em {
    color: CanvasText;
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
<meta name="color-scheme" content="dark">
<title>Welcome to Cadence</title>
<style>${styles}</style>
</head>
<body>
<div class="shell">
<main>
<section class="story" aria-label="Cadence">
<div class="brand"><svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><rect x="1" y="1" width="34" height="34" rx="11" stroke="currentColor" stroke-opacity=".3"/><path d="M25 12a9 9 0 1 0 0 12M12 18h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>cadence</div>
<div class="intro">
<p class="eyebrow">A little focus. A lot of possibility.</p>
<p class="headline">Find your flow.<br> Build <em>what’s next.</em></p>
<p class="lede">A space for your ideas to become plans, and your plans to become something real.</p>
</div>
<div class="orbit" aria-hidden="true"><div class="satellite"></div></div>
<div class="rhythm" aria-hidden="true">Think <span>↗</span> Create <span>↗</span> Keep going</div>
</section>
<section class="entry" aria-labelledby="welcome">
<div class="access"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V6a3 3 0 0 1 6 0v3" stroke="currentColor" stroke-width="1.5"/></svg>Private workspace</div>
<h1 id="welcome">Welcome to Cadence.</h1>
<p class="description">Your next idea starts here.<br>Enter your access key to step inside.</p>
${options.authError ? '<p id="auth-notice" class="notice" role="alert">Access key was not accepted. Check the current key and try again.</p>' : ""}
<form method="post" action="/auth">
<input type="hidden" name="next" value="${escapeAttr(options.nextPath)}">
<label for="key">Access key</label>
<div class="field">
<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="8" cy="9" r="4" stroke="currentColor" stroke-width="1.6"/><path d="m11 12 8 8m-3-3 2-2m-5-1 2-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
<input id="key" name="password" type="password" placeholder="Enter your access key" autocomplete="current-password" required autofocus aria-describedby="key-hint${options.authError ? " auth-notice" : ""}"${options.authError ? ' aria-invalid="true"' : ""}>
</div>
<p id="key-hint" class="hint">Use the key provided by your Cadence server.</p>
<button type="submit">Open workspace<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
</form>
<p class="remember">Stay signed in on this browser for up to a year.<br>Your access key stays out of the address bar.</p>
</section>
</main>
<footer><span>Cadence · A workspace for what’s next.</span><span>Your space. Your pace.</span></footer>
</div>
</body>
</html>
`;
}
