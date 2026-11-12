import type { TSchema } from "typebox";

/** The `cadence_research` and `cadence_plan` parameters, declared once for the
 * native extension and the browser coordinator. */
export declare const RESEARCH_PARAMETERS: TSchema;
export declare const PLAN_PARAMETERS: TSchema;
export declare function createCoordinatorTools(): {
  tools: {
    name: string;
    label: string;
    description: string;
    parameters: TSchema;
    execute(
      callId: string,
      args: unknown,
      signal?: AbortSignal,
    ): Promise<{
      content: { type: "text"; text: string }[];
      details: undefined;
    }>;
  }[];
  close(): Promise<void>;
};
