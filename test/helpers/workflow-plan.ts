import type {
  WorkflowPlan,
  WorkflowTask,
} from "../../src/service/contracts/workflow.ts";

export const sampleTasks = (): WorkflowTask[] => [
  {
    id: "a",
    title: "A",
    instructions: "Create a.txt",
    writes: ["a.txt"],
    after: [],
    reads: [],
  },
  {
    id: "b",
    title: "B",
    instructions: "Create b.txt",
    writes: ["b.txt"],
    after: [],
    reads: [],
  },
];

/** Current V5 Stage 1 delivery agreement (no static tasks or reviewReads). */
export const plan = (): WorkflowPlan => ({
  goal: "Two independent outputs",
  design: "Implement two files without touching existing files.",
  decisions: "No remote push or installation.",
  acceptance: "Both files contain their expected text.",
  version: 5,
  assumptions: "",
  investigations: [],
  areas: [],
  documents: [],
  policy: { installs: false },
  build: [],
  links: [],
  tasks: [],
  checks: [
    {
      name: "outputs",
      command:
        "node -e \"const f=require('fs');for(const n of ['a','b'])if(f.readFileSync(n+'.txt','utf8')!=='implemented '+n+'.txt\\n')process.exit(1)\"",
      timeoutMs: 3000,
    },
  ],
  setup: [],
  baselineChecks: [],
  delivery: "local-merge",
});

/** Retained V4 agreement (readonly readable, includes tasks and reviewReads). */
export const v4Plan = (): WorkflowPlan => ({
  goal: "Two independent outputs",
  design: "Implement two files without touching existing files.",
  decisions: "No remote push or installation.",
  acceptance: "Both files contain their expected text.",
  version: 4,
  assumptions: "",
  documents: [],
  reviewReads: [],
  policy: { installs: false },
  build: [],
  links: [],
  tasks: sampleTasks(),
  checks: [
    {
      name: "outputs",
      command:
        "node -e \"const f=require('fs');for(const n of ['a','b'])if(f.readFileSync(n+'.txt','utf8')!=='implemented '+n+'.txt\\n')process.exit(1)\"",
      timeoutMs: 3000,
    },
  ],
  setup: [],
  baselineChecks: [],
  delivery: "local-merge",
});

/** In-memory V5 fixture with pre-populated Stage 2 tasks for Stage 3+ runtime unit seams. */
export const stagedPlan = (): WorkflowPlan => ({
  ...plan(),
  tasks: sampleTasks(),
});
