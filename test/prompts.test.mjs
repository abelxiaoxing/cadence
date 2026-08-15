import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { expandPromptTemplate } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/prompt-templates.js";

const packageDir = path.resolve(import.meta.dirname, "..");
const promptsDir = path.join(packageDir, "prompts");
const promptNames = [
  "abel-init",
  "abel-design",
  "abel-implement",
  "abel-diagnose",
];
const argumentHints = {
  "abel-init": "[project-path]",
  "abel-design": "<requirement> | --change <change_name>",
  "abel-implement": "<change_name>",
  "abel-diagnose": "<problem-description>",
};

const loadPrompts = async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-abel-prompts-"));
  const agentDir = path.join(root, "agent");
  mkdirSync(agentDir);
  try {
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      additionalPromptTemplatePaths: [promptsDir],
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    return loader.getPrompts();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("Abel prompt templates", () => {
  it("loads exactly the four approved prompt names with string argument hints", async () => {
    const missing = promptNames.filter(
      (name) => !existsSync(path.join(promptsDir, `${name}.md`)),
    );
    expect(missing, "all four prompt files must exist").toEqual([]);
    const { prompts, diagnostics } = await loadPrompts();
    expect(diagnostics).toEqual([]);
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(
      [...promptNames].sort(),
    );
    for (const prompt of prompts) {
      expect(prompt.argumentHint).toBe(argumentHints[prompt.name]);
      expect(typeof prompt.argumentHint).toBe("string");
    }
  });

  it("places complete quoted and space-containing arguments in abel-request", async () => {
    const { prompts } = await loadPrompts();
    expect(prompts).toHaveLength(4);
    for (const prompt of prompts) {
      expect(prompt.content).toMatch(
        /<abel-request>\s*\$ARGUMENTS\s*<\/abel-request>/,
      );
      const expanded = expandPromptTemplate(
        `/${prompt.name} "quoted requirement" with spaces`,
        prompts,
      );
      expect(expanded).toContain(
        "<abel-request>\nquoted requirement with spaces\n</abel-request>",
      );
    }
  });

  it("does not discover Markdown nested below prompts", async () => {
    const nestedDir = path.join(promptsDir, ".nested-test");
    const nestedPrompt = path.join(nestedDir, "nested-not-a-prompt.md");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      nestedPrompt,
      '---\nargument-hint: "[ignored]"\n---\nignored\n',
    );
    try {
      const { prompts } = await loadPrompts();
      expect(
        prompts.some((prompt) => prompt.name === "nested-not-a-prompt"),
      ).toBe(false);
      expect(prompts).toHaveLength(4);
    } finally {
      rmSync(nestedDir, { recursive: true, force: true });
    }
  });

  it("requires unique input for design, implement, and diagnose", () => {
    for (const name of ["abel-design", "abel-implement", "abel-diagnose"]) {
      const file = readFileSync(path.join(promptsDir, `${name}.md`), "utf8");
      expect(file).toMatch(/missing|absent/i);
      expect(file).toMatch(/ambiguous|unique/i);
      expect(file).toMatch(/stop/i);
      expect(file).toMatch(/ask/i);
    }
  });
});
