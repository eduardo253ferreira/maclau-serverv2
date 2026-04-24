const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

db.serialize(() => {
    db.run(`ALTER TABLE avarias ADD COLUMN assinatura_tecnico TEXT`, (err) => {
        if (err) console.log("Avarias: " + err.message);
        else console.log("Avarias: Coluna adicionada.");
    });
    db.run(`ALTER TABLE servicos ADD COLUMN assinatura_tecnico TEXT`, (err) => {
        if (err) console.log("Servicos: " + err.message);
        else console.log("Servicos: Coluna adicionada.");
    });
});
db.close();
