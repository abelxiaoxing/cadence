import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  isValidRelativePath,
  VERIFICATION_LIMITS,
  validateVerificationContract,
} from "./contracts.ts";
import type { DesignPlanDiagnostic } from "./design-diagnostics.ts";

const text = Type.String({ minLength: 1, maxLength: 8192, pattern: "\\S" });
const id = Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$" });
const object = <T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const managers = Type.Union([
  Type.Literal("bun"),
  Type.Literal("npm"),
  Type.Literal("pnpm"),
  Type.Literal("yarn"),
]);
const packageRunner = {
  kind: Type.Literal("package-script"),
  packageManager: managers,
  script: text,
  command: text,
};
const executable = Type.Union([
  object(packageRunner),
  object({ kind: Type.Literal("local-binary"), executable: text }),
  object({
    kind: Type.Literal("npx"),
    executable: text,
    noInstall: Type.Literal(true),
  }),
]);
const classification = Type.Union([
  Type.Literal("expected-red"),
  Type.Literal("expected-green"),
  Type.Literal("expected-refactor"),
]);
const base = {
  id,
  classification,
  expectedFailure: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  executionBindings: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()])),
  ),
};
const args = Type.Array(Type.String(), { maxItems: 128 });
export const ATOMIC_VERIFICATION_SCHEMAS = {
  vitest: object({
    ...base,
    kind: Type.Literal("vitest"),
    runner: executable,
    testFiles: Type.Array(text, {
      minItems: VERIFICATION_LIMITS.minTestFiles,
      maxItems: VERIFICATION_LIMITS.maxTestFiles,
      uniqueItems: true,
    }),
    args,
    minTests: Type.Integer({ minimum: 1 }),
  }),
  "package-script": object({ ...base, ...packageRunner, args }),
  "static-check": object({
    ...base,
    kind: Type.Literal("static-check"),
    runner: Type.Union([
      executable,
      object({ kind: Type.Literal("node"), script: text }),
    ]),
    args,
  }),
};
const atomic = Type.Union(Object.values(ATOMIC_VERIFICATION_SCHEMAS));
const steps = object({
  kind: Type.Literal("steps"),
  id,
  classification,
  steps: Type.Array(atomic, {
    minItems: VERIFICATION_LIMITS.minSteps,
    maxItems: VERIFICATION_LIMITS.maxSteps,
  }),
});
export const VERIFICATION_SCHEMA = Type.Union([atomic, steps]);
export const CHANGE_CONTRACT_SCHEMA = object({
  goal: text,
  acceptance: Type.Array(
    object({ id, statement: text, verification: VERIFICATION_SCHEMA }),
    { minItems: 1, maxItems: 256 },
  ),
  constraints: Type.Array(object({ id, statement: text }), { maxItems: 256 }),
  policy: object({
    writeRoots: Type.Array(text, {
      minItems: 1,
      maxItems: 256,
      uniqueItems: true,
    }),
    dependencies: Type.Array(text, { maxItems: 256, uniqueItems: true }),
    verificationModes: Type.Array(
      Type.Union([
        Type.Literal("behavior"),
        Type.Literal("mechanical"),
        Type.Literal("refactor"),
      ]),
      { minItems: 1, maxItems: 256, uniqueItems: true },
    ),
  }),
});
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const schemaFields = new Set([
  "goal",
  "acceptance",
  "id",
  "statement",
  "verification",
  "constraints",
  "policy",
  "writeRoots",
  "dependencies",
  "verificationModes",
  "classification",
  "expectedFailure",
  "executionBindings",
  "kind",
  "runner",
  "packageManager",
  "script",
  "command",
  "executable",
  "noInstall",
  "testFiles",
  "args",
  "minTests",
  "steps",
]);
function diagnosticField(pointer: string): string {
  const fields = ["contract"];
  for (const part of pointer.split("/").slice(1)) {
    if (!schemaFields.has(part) && !/^(0|[1-9][0-9]{0,5})$/u.test(part)) break;
    fields.push(part);
    // Binding keys are author data, even when they happen to look like schema fields.
    if (part === "executionBindings") break;
  }
  return fields.join(".");
}

/** Shared shape, bounded field-only diagnostics; never return submitted values or parser messages. */
export function changeContractDiagnostics(
  value: unknown,
): DesignPlanDiagnostic[] {
  const diagnostics: DesignPlanDiagnostic[] = Value.Errors(
    CHANGE_CONTRACT_SCHEMA,
    value,
  )
    .slice(0, 32)
    .map((error) => ({
      code: "change-contract-field-invalid",
      field: diagnosticField(error.instancePath),
      category: error.keyword,
    }));
  if (!record(value)) return diagnostics;
  if (Array.isArray(value.acceptance))
    value.acceptance.slice(0, 256).forEach((item, index) => {
      if (!record(item)) return;
      const verification = item.verification;
      if (!validateVerificationContract(verification).ok) {
        const field = `contract.acceptance.${index}.verification`;
        if (
          record(verification) &&
          verification.classification === "expected-red" &&
          typeof verification.expectedFailure !== "string"
        )
          diagnostics.push({
            code: "change-contract-field-invalid",
            field: `${field}.expectedFailure`,
          });
        else diagnostics.push({ code: "change-contract-field-invalid", field });
      }
    });
  if (record(value.policy) && Array.isArray(value.policy.writeRoots))
    value.policy.writeRoots.slice(0, 256).forEach((root, index) => {
      if (root !== "." && !isValidRelativePath(root))
        diagnostics.push({
          code: "change-contract-field-invalid",
          field: `contract.policy.writeRoots.${index}`,
        });
    });
  return diagnostics.slice(0, 32);
}
