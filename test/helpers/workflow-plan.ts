import type { WorkflowPlan } from "../../src/service/contracts/workflow.ts";
export const plan = (): WorkflowPlan => ({
  goal: "Two independent outputs",
  design: "Implement two files without touching existing files.",
  decisions: "No remote push or installation.",
  acceptance: "Both files contain their expected text.",
  projectContext:
    "Consult existing.txt. This fixture has no dependency installation.",
  tasks: [
    {
      id: "a",
      title: "A",
      instructions: "Create a.txt",
      writes: ["a.txt"],
      after: [],
    },
    {
      id: "b",
      title: "B",
      instructions: "Create b.txt",
      writes: ["b.txt"],
      after: [],
    },
  ],
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
  repairAttempts: 0,
  delivery: "local-merge",
});
