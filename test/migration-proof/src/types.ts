export type MigrationState = 'applied' | 'pending';

export interface MigrationStatus {
  id: string;
  state: MigrationState;
  appliedAt?: string;
}

export interface CreateResult {
  sourceId: string;
  deployedId: string;
}

export interface UpResult {
  applied: string[];
}

export interface DownResult {
  reverted: string[];
}

export type MigrationCallback<T> = (error: Error | null, result?: T) => void;

export interface MigrationPreparationWorker {
  create(name: string, callback: MigrationCallback<CreateResult>): void;
  status(callback: MigrationCallback<MigrationStatus[]>): void;
}

export interface MigrationPreparationOperations {
  create(name: string): Promise<CreateResult>;
  status(): Promise<MigrationStatus[]>;
}

export interface MigrationWorker extends MigrationPreparationWorker {
  up(callback: MigrationCallback<UpResult>): void;
  down(callback: MigrationCallback<DownResult>): void;
}

export interface MigrationOperations extends MigrationPreparationOperations {
  up(): Promise<UpResult>;
  down(): Promise<DownResult>;
}
