const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

db.all("SELECT name FROM sqlite_master WHERE type='table';", [], (err, rows) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log('--- TABELAS NA BASE DE DADOS ---');
    rows.forEach(row => {
        console.log(row.name);
    });
    db.close();
});
