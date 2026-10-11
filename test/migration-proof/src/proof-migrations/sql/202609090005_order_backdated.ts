import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex('events').insert({ event: 'backdated-up' });
}

export async function down(knex: Knex): Promise<void> {
  await knex('events').insert({ event: 'backdated-down' });
}
