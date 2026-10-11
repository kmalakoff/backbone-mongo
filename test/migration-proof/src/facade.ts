import type { CreateResult, DownResult, MigrationCallback, MigrationPreparationWorker, MigrationStatus, MigrationWorker, UpResult } from './types.ts';

function invoke<T>(start: (callback: MigrationCallback<T>) => void, callback?: MigrationCallback<T>): void | Promise<T> {
  if (callback) {
    start(callback);
    return;
  }
  return new Promise<T>((resolve, reject) => {
    start((error, result) => {
      if (error) return reject(error);
      if (result === undefined) return reject(new Error('Migration worker completed without a result'));
      resolve(result);
    });
  });
}

export class MigrationPreparationFacade {
  private readonly worker: MigrationPreparationWorker;

  constructor(worker: MigrationPreparationWorker) {
    this.worker = worker;
  }

  create(name: string): Promise<CreateResult>;
  create(name: string, callback: MigrationCallback<CreateResult>): void;
  create(name: string, callback?: MigrationCallback<CreateResult>): void | Promise<CreateResult> {
    return invoke((done) => this.worker.create(name, done), callback);
  }

  status(): Promise<MigrationStatus[]>;
  status(callback: MigrationCallback<MigrationStatus[]>): void;
  status(callback?: MigrationCallback<MigrationStatus[]>): void | Promise<MigrationStatus[]> {
    return invoke((done) => this.worker.status(done), callback);
  }
}

export default class MigrationFacade extends MigrationPreparationFacade {
  private readonly executionWorker: MigrationWorker;

  constructor(worker: MigrationWorker) {
    super(worker);
    this.executionWorker = worker;
  }

  up(): Promise<UpResult>;
  up(callback: MigrationCallback<UpResult>): void;
  up(callback?: MigrationCallback<UpResult>): void | Promise<UpResult> {
    return invoke((done) => this.executionWorker.up(done), callback);
  }

  down(): Promise<DownResult>;
  down(callback: MigrationCallback<DownResult>): void;
  down(callback?: MigrationCallback<DownResult>): void | Promise<DownResult> {
    return invoke((done) => this.executionWorker.down(done), callback);
  }
}
