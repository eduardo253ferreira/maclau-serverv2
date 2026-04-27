const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath);

console.log('A tentar adicionar a coluna email à tabela administradores...');

db.run(`ALTER TABLE administradores ADD COLUMN email TEXT`, (err) => {
    if (err) {
        if (err.message.includes('duplicate column name')) {
            console.log('✅ A coluna já existe.');
        } else {
            console.error('❌ Erro ao adicionar coluna:', err.message);
        }
    } else {
        console.log('✅ Coluna email adicionada com sucesso!');
    }
    db.close();
});
