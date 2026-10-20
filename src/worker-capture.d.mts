import type { Writable } from "node:stream";
import type {
  CaptureCoverage,
  CaptureEvent,
  CaptureFrame,
  CapturePosition,
  DetailDescriptor,
  FinalSelection,
  WorkerPublicRequest,
} from "./worker-public.mjs";
export function completeCoverage(): CaptureCoverage;
export function controlEvent(kind: string): boolean;
export function chunks(text: string): Generator<string>;
export class CaptureState {
  constructor(childRunId: string, request?: WorkerPublicRequest);
  position: CapturePosition;
  selected: FinalSelection | null;
  coverage: CaptureCoverage;
  bytes: number;
  failed: boolean;
  details: Map<
    string,
    {
      descriptor: DetailDescriptor;
      bytes: number;
      ended: boolean;
      preview: string;
    }
  >;
  accept(input: unknown, encodedBytes?: number): CaptureFrame;
  mergeCoverage(coverage: CaptureCoverage): void;
  get preview(): string;
}
export class CaptureQueue {
  bytes: number;
  frames: number;
  reserveSource(): {
    bytes: number;
    lease: {
      readonly bytes: number;
      grow(size: number): void;
      shrink(size: number): void;
      release(): void;
    };
  };
  reserve(
    bytes: number,
    lane?: "data" | "control",
  ): {
    readonly bytes: number;
    grow(size: number): void;
    shrink(size: number): void;
    release(): void;
  };
}
export class CaptureEmitter {
  constructor(
    childRunId: string,
    output: Pick<Writable, "write">,
    onFailure: () => void,
    request?: WorkerPublicRequest,
  );
  state: CaptureState;
  queue: CaptureQueue;
  queuedBytes: number;
  broken: boolean;
  emit(event: CaptureEvent): Promise<void>;
  drain(): Promise<void>;
}
export class SdkCapture {
  constructor(emitter: CaptureEmitter, secrets?: string[]);
  selected: FinalSelection | null;
  events: number;
  context(request: WorkerPublicRequest, system: string): Promise<void>;
  event(event: unknown): Promise<void>;
  final(): Promise<void>;
}
export function parseCaptureLine(line: string): unknown;
