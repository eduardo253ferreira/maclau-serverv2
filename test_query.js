const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

const query = `
    SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.data_hora, a.tecnico_id,
           m.nome as maquina_nome, c.nome as cliente_nome, t.nome as tecnico_nome
    FROM avarias a
    LEFT JOIN maquinas m ON a.maquina_id = m.uuid
    LEFT JOIN clientes c ON m.cliente_id = c.id
    LEFT JOIN tecnicos t ON a.tecnico_id = t.id
    ORDER BY a.data_hora DESC
`;

db.all(query, [], (err, rows) => {
    if (err) {
        console.error("Query failed:", err.message);
    } else {
        console.log("Query successful, rows:", rows.length);
    }
    db.close();
});
