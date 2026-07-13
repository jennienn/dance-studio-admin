export type RowKey = Record<string, string | number>;

export interface ManifestRow {
  sequence: number;
  table: string;
  key: RowKey;
  scenario: string;
}

export interface SeedManifest {
  version: 1;
  runId: string;
  projectRef: string;
  targetUrl: string;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  failure?: string;
  cleanup?: {
    startedAt: string;
    completedAt?: string;
    verifiedSequences: number[];
  };
  rows: ManifestRow[];
  scenarios: Record<string, Array<string | number>>;
}
