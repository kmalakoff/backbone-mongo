import type { CreateResult, DownResult, MigrationFacade, MigrationStatus, UpResult } from 'backbone-mongo-migration-proof';

export function consumeFacade(facade: MigrationFacade): void {
  const createPromise: Promise<CreateResult> = facade.create('typed');
  const statusPromise: Promise<MigrationStatus[]> = facade.status();
  const upPromise: Promise<UpResult> = facade.up();
  const downPromise: Promise<DownResult> = facade.down();

  const createReturn: void = facade.create('typed', (error, result) => {
    if (!error && result) result.sourceId.toUpperCase();
  });
  const statusReturn: void = facade.status((error, result) => {
    if (!error && result) result.map(({ id }) => id);
  });
  const upReturn: void = facade.up((error, result) => {
    if (!error && result) result.applied.map((id) => id);
  });
  const downReturn: void = facade.down((error, result) => {
    if (!error && result) result.reverted.map((id) => id);
  });

  // @ts-expect-error Callback form deliberately returns void, not a Promise.
  const invalidCreatePromise: Promise<CreateResult> = facade.create('typed', () => undefined);
  facade.status((_error, result) => {
    // @ts-expect-error Failure callbacks legitimately omit their result.
    const invalidMandatoryResult: MigrationStatus[] = result;
    void invalidMandatoryResult;
  });

  void [createPromise, statusPromise, upPromise, downPromise, createReturn, statusReturn, upReturn, downReturn, invalidCreatePromise];
}

export function consumePreparation(facade: import('backbone-mongo-migration-proof').MigrationPreparationFacade): void {
  const createPromise: Promise<CreateResult> = facade.create('typed');
  const statusPromise: Promise<MigrationStatus[]> = facade.status();
  const createReturn: void = facade.create('typed', (error, result) => {
    if (!error && result) result.deployedId.toUpperCase();
  });
  const statusReturn: void = facade.status((_error, result) => result?.map(({ id }) => id));
  // @ts-expect-error Callback calls return void.
  const invalidPromise: Promise<MigrationStatus[]> = facade.status(() => undefined);
  // @ts-expect-error Execution is unavailable in the preparation slice.
  facade.up();
  // @ts-expect-error Undo is unavailable in the preparation slice.
  facade.down();
  void [createPromise, statusPromise, createReturn, statusReturn, invalidPromise];
}

export function consumePreparationFactories(
  sqlOptions: import('backbone-mongo-migration-proof').SqlPreparationOptions,
  mongoOptions: import('backbone-mongo-migration-proof').IsolatedMongoOptions,
): void {
  void import('backbone-mongo-migration-proof').then(({ createSqlPreparationFacade, createMongoPreparationFacade }) => {
    const sql = createSqlPreparationFacade(sqlOptions);
    const mongo = createMongoPreparationFacade(mongoOptions);
    const sqlStatus: Promise<MigrationStatus[]> = sql.status();
    const mongoCreate: Promise<CreateResult> = mongo.create('typed');
    // @ts-expect-error Mutation remains outside both preparation adapters.
    sql.up();
    // @ts-expect-error Mutation remains outside both preparation adapters.
    mongo.down();
    void [sqlStatus, mongoCreate];
  });
}

export function preparationConfigurationBoundary(): void {
  type Database = import('backbone-mongo-migration-proof').SqlPreparationDatabase;
  const admitted: Database = { client: 'sqlite3', connection: { filename: 'existing.sqlite' }, migrations: { tableName: 'native_history', schemaName: 'main' } };
  // @ts-expect-error Client aliases require separate admission.
  const alias: Database['client'] = 'sqlite';
  // @ts-expect-error Connection providers are outside the static preparation contract.
  const provider: Database['connection'] = () => ({ filename: 'missing.sqlite' });
  // @ts-expect-error Connection strings are outside the static preparation contract.
  const connectionString: Database['connection'] = 'sqlite://missing.sqlite';
  // @ts-expect-error Deployed loader extensions are fixed to .js.
  const loader: NonNullable<Database['migrations']> = { loadExtensions: ['.mjs'] };
  // @ts-expect-error Native directory/source overrides are not preparation history metadata.
  const directory: NonNullable<Database['migrations']> = { directory: ['other'] };
  void [admitted, alias, provider, connectionString, loader, directory];
}
