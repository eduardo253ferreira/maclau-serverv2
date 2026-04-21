const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

console.log("--- TABLE SCHEMAS ---");
db.all("PRAGMA table_info(avarias)", (err, rows) => {
    console.log("avarias:", rows.map(r => r.name).join(", "));
});

db.all("PRAGMA table_info(maquinas)", (err, rows) => {
    console.log("maquinas:", rows.map(r => r.name).join(", "));
});

console.log("\n--- RECENT AVARIAS DATA ---");
db.all(`
    SELECT a.id, a.maquina_id, a.estado, a.horas_trabalho, a.relatorio,
           m.nome as m_nome, m.uuid as m_uuid
    FROM avarias a
    LEFT JOIN maquinas m ON a.maquina_id = m.uuid
    ORDER BY a.id DESC LIMIT 10
`, (err, rows) => {
    if (err) console.error(err);
    else console.log(JSON.stringify(rows, null, 2));
    db.close();
});
