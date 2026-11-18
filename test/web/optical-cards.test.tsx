import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { newDesign, reviseDesign } from "../../src/service/contracts/design.ts";
import { DesignCard } from "../../web/src/components/workspace/DesignCard";
import { designQuestionsFixture } from "../helpers/design-questions.ts";

it("projects the selected lens from the actual answer, including custom answers", () => {
  const base = newDesign(randomUUID(), { questions: designQuestionsFixture });
  const render = (answers: typeof base.answers) =>
    renderToStaticMarkup(
      <DesignCard
        draft={reviseDesign(base, answers, false)}
        disabled={false}
        onEdit={() => {}}
        onSubmit={() => {}}
      />,
    );
  expect(render([])).toContain('data-selected="false"');
  const selected = render([{ question: "surface", option: "everywhere" }]);
  expect(selected).toContain('data-selected="true"');
  expect(selected).toMatch(/checked=""[^>]*\/> Everywhere/);
  expect(selected).toContain("How much blur?");
  const custom = render([{ question: "surface", other: "Still surfaces" }]);
  expect(custom).toContain('data-selected="false"');
  expect(custom).toContain("design-custom chosen");
  expect(custom).not.toContain("How much blur?");
  expect(custom).not.toContain("Implement this plan");
});
