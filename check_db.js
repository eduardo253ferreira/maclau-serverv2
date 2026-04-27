const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

db.all("PRAGMA table_info(avarias)", (err, rows) => {
    if (err) console.error(err);
    console.log("Avarias Columns:", rows.map(r => r.name).join(', '));

    db.all("PRAGMA table_info(servicos)", (err, rows) => {
        if (err) console.error(err);
        console.log("Servicos Columns:", rows.map(r => r.name).join(', '));
        db.close();
    });
});
