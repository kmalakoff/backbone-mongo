export async function up(knex) {
    await knex.schema.createTable('widgets', (table)=>{
        table.increments('id').primary();
        table.text('name').notNullable();
    });
}
export async function down(knex) {
    await knex.schema.dropTable('widgets');
}
