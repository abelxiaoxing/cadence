import {
  createExtensionRuntime,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

/** ResourceLoader that discovers nothing and supplies only the approved prompt. */
export class EmptyResourceLoader implements ResourceLoader {
  constructor(private readonly systemPrompt?: string) {}
  getExtensions() {
    return { extensions: [], errors: [], runtime: createExtensionRuntime() };
  }
  getSkills() {
    return { skills: [], diagnostics: [] };
  }
  getPrompts() {
    return { prompts: [], diagnostics: [] };
  }
  getThemes() {
    return { themes: [], diagnostics: [] };
  }
  getAgentsFiles() {
    return { agentsFiles: [] };
  }
  getSystemPrompt() {
    return this.systemPrompt;
  }
  getSystemPromptSource() {
    return undefined;
  }
  getAppendSystemPrompt() {
    return [];
  }
  getAppendSystemPromptSources() {
    return [];
  }
  extendResources() {}
  async reload() {}
}
