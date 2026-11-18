import type { DesignQuestion } from "../../src/service/contracts/design.ts";

export const designQuestionsFixture: DesignQuestion[] = [
  {
    id: "surface",
    question: "Where should glass appear?",
    options: [
      { id: "frames", label: "Frames", cost: "Quieter surfaces" },
      { id: "everywhere", label: "Everywhere", cost: "More compositing" },
    ],
    recommended: "frames",
    reason: "Keeps long content readable",
    acceptance: "Code contrast",
  },
  {
    id: "blur",
    question: "How much blur?",
    when: { question: "surface", option: "everywhere" },
    options: [
      { id: "light", label: "Light", cost: "Subtle separation" },
      { id: "heavy", label: "Heavy", cost: "Higher GPU cost" },
    ],
    recommended: "light",
    reason: "Reduce compositing",
    acceptance: "Narrow screen performance",
  },
  {
    id: "motion",
    question: "Which motion?",
    options: [
      { id: "quiet", label: "Quiet", cost: "Less emphasis" },
      { id: "strong", label: "Strong", cost: "More movement" },
    ],
    recommended: "quiet",
    reason: "Reading first",
    acceptance: "Focus stays visible",
  },
];
