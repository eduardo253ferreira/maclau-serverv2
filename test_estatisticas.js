const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('database.db');
db.all(`SELECT a.id, a.tipo_avaria, a.data_hora_fim, a.tecnico_id, t.nome as tecnico_nome FROM avarias a LEFT JOIN tecnicos t ON a.tecnico_id = t.id WHERE a.estado = 'resolvida' AND a.data_hora_fim IS NOT NULL ORDER BY a.data_hora_fim ASC`, (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
});
