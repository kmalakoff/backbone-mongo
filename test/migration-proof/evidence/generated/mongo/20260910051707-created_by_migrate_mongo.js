export async function up(db, _client) {
    await db.collection('widgets').insertOne({
        name: 'created'
    });
}
export async function down(db, _client) {
    await db.collection('widgets').drop();
}
