/** Public directory-less workbench DTOs. No tokens, endpoints or native capabilities. */
import {
  decodeServiceBuild,
  type ServiceBuild,
} from "../../service-contract.ts";
import { closed, decodeHash, decodeId, list, literal, text } from "./core.ts";
export interface ProjectEntry {
  id: string;
  path: string;
  cwd: string;
  epoch: string;
}
export function decodeProjectEntry(value: unknown): ProjectEntry {
  const o = closed(value, ["id", "path", "cwd", "epoch"]);
  return {
    id: decodeHash(o.id),
    path: text(o.path, 4096, true),
    cwd: text(o.cwd, 4096, true),
    epoch: decodeId(o.epoch),
  };
}
export interface WorkbenchEntry {
  kind: "workbench";
  epoch: string;
  csrf: string;
  home: string;
  projects: ProjectEntry[];
  build: ServiceBuild;
}
export function decodeWorkbenchEntry(value: unknown): WorkbenchEntry {
  const o = closed(value, [
    "kind",
    "epoch",
    "csrf",
    "home",
    "projects",
    "build",
  ]);
  return {
    kind: literal(o.kind, "workbench"),
    epoch: decodeId(o.epoch),
    csrf: decodeId(o.csrf),
    home: text(o.home, 4096, true),
    projects: list(o.projects, 128, decodeProjectEntry),
    build: decodeServiceBuild(o.build),
  };
}
