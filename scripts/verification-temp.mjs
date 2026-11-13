import { assertTemporaryDirectory } from "../src/service/run-environment.ts";

/** Validate the caller's choice; never redirect, create or clean their data. */
export function assertVerificationTemp(root, env = process.env) {
  try {
    if (!env.TMPDIR || env.TMP !== env.TMPDIR || env.TEMP !== env.TMPDIR)
      throw new Error("temporary variables differ or are unset");
    assertTemporaryDirectory(root, env.TMPDIR);
  } catch {
    throw new Error(
      "verification-temp-required: set TMPDIR, TEMP and TMP to one fresh 0700 directory outside every Git working copy, on the checkout's disk filesystem (not tmpfs)",
    );
  }
}
