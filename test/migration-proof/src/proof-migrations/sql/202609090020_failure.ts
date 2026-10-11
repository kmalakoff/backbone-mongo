import type { Knex } from 'knex';

export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  await knex('events').insert({ event: 'failure-write' });
  throw new Error('failure after SQL data change');
}

export async function down(knex: Knex): Promise<void> {
  await knex('events').where({ event: 'failure-write' }).delete();
}
