import type { Knex } from 'knex';

export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  await knex('events').insert({ event: 'down-prepared' });
}

export async function down(knex: Knex): Promise<void> {
  await knex('events').insert({ event: 'down-failure-write' });
  throw new Error('failure after SQL down data change');
}
