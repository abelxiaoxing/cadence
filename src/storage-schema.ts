export const ROUTE_HEALTH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS route_health (
    route_fingerprint TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    next_half_open_at INTEGER,
    projection_json TEXT NOT NULL
  ) STRICT;
`;

/** Owner-private storage contracts. Migrations run atomically before use. */
export const RUN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    root_hash TEXT NOT NULL,
    stage TEXT NOT NULL,
    lookup_key TEXT NOT NULL,
    change_name TEXT,
    provisional_key TEXT,
    state TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_hash TEXT NOT NULL,
    delivery_revision INTEGER,
    projection_json TEXT NOT NULL,
    terminal_tombstone TEXT,
    UNIQUE (root_hash, stage, lookup_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS delivery_bindings (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    gate TEXT NOT NULL,
    revision INTEGER NOT NULL,
    receipt_hash TEXT NOT NULL,
    approval_revision INTEGER,
    contract_hash TEXT,
    record_hash TEXT,
    operation_id TEXT NOT NULL,
    PRIMARY KEY (run_id, gate, revision),
    UNIQUE (run_id, operation_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS events (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    prior_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence),
    UNIQUE (run_id, event_hash)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS tasks (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    state TEXT NOT NULL,
    phase TEXT,
    projection_json TEXT NOT NULL,
    PRIMARY KEY (run_id, task_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS operations (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    outcome_json TEXT,
    lease_token TEXT,
    lease_expires_at INTEGER,
    PRIMARY KEY (run_id, operation_id)
  ) STRICT;

${ROUTE_HEALTH_SCHEMA}

  CREATE TABLE IF NOT EXISTS artifacts (
    content_hash TEXT PRIMARY KEY,
    size_bytes INTEGER NOT NULL,
    seal_state TEXT NOT NULL,
    owner_run_id TEXT REFERENCES runs(run_id) ON DELETE CASCADE,
    reference_count INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workspace_revisions (
    revision_id TEXT PRIMARY KEY,
    owner_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    parent_revision_id TEXT,
    manifest_hash TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS apply_transactions (
    transaction_id TEXT PRIMARY KEY,
    owner_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    intent_json TEXT NOT NULL,
    recovery_json TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS bootstrap_handoffs (
    handoff_id TEXT PRIMARY KEY,
    owner_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    receipt_hash TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL,
    facts_json TEXT NOT NULL
  ) STRICT;
`;

export const DESIGN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS design_facts (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    kind TEXT NOT NULL,
    identity TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    canonical_hash TEXT NOT NULL,
    prior_record_hash TEXT NOT NULL,
    record_hash TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence),
    UNIQUE (run_id, kind, identity),
    UNIQUE (run_id, record_hash)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS design_operations (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    outcome_json TEXT NOT NULL,
    PRIMARY KEY (run_id, operation_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS design_compiled_plans (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    fact_sequence INTEGER NOT NULL,
    raw_sha256 TEXT NOT NULL,
    canonical_hash TEXT NOT NULL,
    plan_bytes BLOB NOT NULL,
    PRIMARY KEY (run_id, revision),
    UNIQUE (run_id, fact_sequence),
    FOREIGN KEY (run_id, fact_sequence)
      REFERENCES design_facts(run_id, sequence) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS design_finalization_leases (
    run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL
  ) STRICT;
`;

export const ENGINE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS workflow_engine_runs (
    run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
    current_revision INTEGER,
    baseline_workspace_revision TEXT,
    current_workspace_revision TEXT,
    cleanup_state TEXT NOT NULL DEFAULT 'none',
    route_id TEXT,
    route_fingerprint TEXT,
    transaction_id TEXT,
    verification_json TEXT,
    delivery_diagnostics_json TEXT,
    next_queue_position INTEGER NOT NULL DEFAULT 1
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workflow_engine_deliveries (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    gate TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    PRIMARY KEY (run_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workflow_engine_tasks (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    task_order INTEGER NOT NULL,
    delivery_revision INTEGER NOT NULL,
    plan_json TEXT NOT NULL,
    state TEXT NOT NULL,
    phase TEXT NOT NULL,
    pause_code TEXT,
    context_request_json TEXT,
    attempt_diagnostic_json TEXT,
    route_id TEXT,
    route_fingerprint TEXT,
    queue_position INTEGER,
    PRIMARY KEY (run_id, task_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workflow_engine_operations (
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    command TEXT NOT NULL,
    state TEXT NOT NULL,
    lease_token TEXT,
    lease_expires_at INTEGER,
    outcome_json TEXT,
    PRIMARY KEY (run_id, operation_id)
  ) STRICT;
`;

export const TASK_SCHEMA = `
      CREATE TABLE IF NOT EXISTS candidates (
        candidate_id TEXT PRIMARY KEY,
        identity_json TEXT NOT NULL,
        state TEXT NOT NULL,
        next_sequence INTEGER NOT NULL,
        total_bytes INTEGER NOT NULL,
        artifact_hash TEXT,
        candidate_hash TEXT,
        segment_count INTEGER,
        paths_json TEXT,
        pause_code TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS candidate_segments (
        candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        artifact_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        segment_hash TEXT NOT NULL,
        PRIMARY KEY (candidate_id, sequence)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS task_ledger (
        run_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        delivery_revision INTEGER NOT NULL,
        boundary_hash TEXT NOT NULL,
        objective TEXT NOT NULL,
        context_refs_json TEXT NOT NULL,
        initial_phase TEXT NOT NULL,
        PRIMARY KEY (run_id, task_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS task_events (
        run_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        prior_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        PRIMARY KEY (run_id, task_id, ordinal),
        UNIQUE (run_id, task_id, event_id),
        FOREIGN KEY (run_id, task_id) REFERENCES task_ledger(run_id, task_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS durable_facts (
        fact_key TEXT PRIMARY KEY,
        fact_json TEXT NOT NULL
      ) STRICT;
    `;

export const APPLY_SCHEMA = `
      CREATE TABLE IF NOT EXISTS apply_transaction_journal (
        transaction_id TEXT PRIMARY KEY,
        journal_json TEXT NOT NULL,
        journal_hash TEXT NOT NULL
      ) STRICT;
    `;

export const ENGINE_ADDITIONS = {
  workflow_engine_runs: {
    baseline_workspace_revision: "TEXT",
    current_workspace_revision: "TEXT",
    cleanup_state: "TEXT NOT NULL DEFAULT 'none'",
    verification_json: "TEXT",
    delivery_diagnostics_json: "TEXT",
    route_fingerprint: "TEXT",
  },
  workflow_engine_tasks: {
    route_fingerprint: "TEXT",
    context_request_json: "TEXT",
    attempt_diagnostic_json: "TEXT",
  },
};
