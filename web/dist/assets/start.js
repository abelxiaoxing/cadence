// Stable, dependency-free classic script: an old HTML document can still
// observe failure of its versioned module graph after a service replacement.
// Never handle runtime exceptions, API failures, lazy chunks or user commands.
(() => {
  const marker = "cadence:startup-reload";
  const entryBuild = (target) =>
    target instanceof HTMLScriptElement &&
    target.type === "module" &&
    /^\/ui\/([a-f0-9]{64})\/assets\/cadence\.js$/.exec(
      target.getAttribute("src"),
    )?.[1];
  const targetUrl = (next) => {
    if (location.pathname !== "/app") return null;
    const params = new URLSearchParams();
    const project = new URLSearchParams(location.search).get("project");
    if (project && /^[a-f0-9]{64}$/.test(project))
      params.set("project", project);
    params.set("v", next);
    return `/app?${params}${location.hash}`;
  };
  let checking = false;
  document.addEventListener(
    "load",
    ({ target }) => {
      if (entryBuild(target)) {
        try {
          sessionStorage.removeItem(marker);
        } catch {
          /* storage is optional */
        }
      }
    },
    true,
  );
  const recover = async (current) => {
    const notice = document.getElementById("startup-failure");
    if (!notice) return; // the app has already mounted
    let reloading = false;
    let discovered = "";
    const button = notice.querySelector("button");
    if (navigator.language.startsWith("zh")) {
      notice.firstChild.textContent = "Cadence 页面未能加载。";
      button.textContent = "重试";
    }
    button.onclick = () => {
      const target = discovered && targetUrl(discovered);
      if (target) location.replace(target);
      else location.reload();
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetch(location.pathname + location.search, {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: abort.signal,
      });
      const next = response.headers.get("X-Cadence-Web-Build");
      if (
        !response.ok ||
        !next ||
        !/^[a-f0-9]{64}$/.test(next) ||
        current === next
      )
        return;
      discovered = next;
      if (sessionStorage.getItem(marker) === next) return;
      // No safe loop guard (e.g. blocked storage) means no automatic reload.
      sessionStorage.setItem(marker, next);
      const target = targetUrl(next);
      if (target) location.replace(target);
      else location.reload();
      reloading = true;
    } catch {
      /* Offline, expired login or blocked storage: leave Retry visible. */
    } finally {
      abort.abort();
      clearTimeout(timer);
      if (!reloading) notice.hidden = false;
    }
  };
  document.addEventListener(
    "error",
    ({ target }) => {
      const current = entryBuild(target);
      if (!current || checking) return;
      checking = true;
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => recover(current), {
          once: true,
        });
      } else return recover(current);
    },
    true,
  );
})();
