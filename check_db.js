const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

db.all("PRAGMA table_info(avarias)", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("Avarias columns:", rows.map(r => r.name));
    db.all("SELECT * FROM tecnicos LIMIT 1", [], (err2, rows2) => {
        if (err2) {
            console.error("Tecnicos table error:", err2.message);
        } else {
            console.log("Tecnicos table exists.");
        }
        db.close();
    });
});
