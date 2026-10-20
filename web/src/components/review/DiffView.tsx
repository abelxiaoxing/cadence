/* Direct adaptation of pi-web-ui SCMPanel.tsx renderDiff; MIT (c) 2026 xing-shuyin.
 * Text is an observed sanitized diff page, never a mutation or attribution claim. */
import { textLines } from "../../rich/text-lines";
export function DiffView({ text }: { text: string }) {
  return (
    <pre className="scm-diff-pre">
      {textLines(text).map(({ text: ln, key }) => {
        let cls = "";
        if (
          [
            "diff --git",
            "index ",
            "new file",
            "deleted file",
            "old mode",
            "new mode",
            "similarity index",
            "rename ",
            "copy ",
            "Binary files",
            "---",
            "+++",
          ].some((prefix) => ln.startsWith(prefix))
        )
          cls = "hdr";
        else if (ln.startsWith("@@")) cls = "hunk";
        else if (ln.startsWith("+")) cls = "add";
        else if (ln.startsWith("-")) cls = "del";
        return (
          <div key={key} className={`scm-diff-line ${cls}`}>
            {ln || " "}
          </div>
        );
      })}
    </pre>
  );
}
