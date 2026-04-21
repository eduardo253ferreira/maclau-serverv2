const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

db.all("SELECT id, relatorio, pecas_substituidas FROM avarias WHERE pecas_substituidas IS NOT NULL OR relatorio IS NOT NULL LIMIT 5", (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("Recent reports with content:");
    console.log(JSON.stringify(rows, null, 2));
    db.close();
});
