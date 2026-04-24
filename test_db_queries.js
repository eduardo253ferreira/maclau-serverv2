
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

const queries = [
    {
        name: 'Admin Avarias',
        sql: `SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.estado_faturacao,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_pausa) as data_hora_pausa, 
               a.tecnico_id, a.notas,
               a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               a.assinatura_cliente,
               (m.marca || ' - ' || m.modelo) as maquina_nome, c.nome as cliente_nome, t.nome as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        LEFT JOIN tecnicos t ON a.tecnico_id = t.id
        WHERE a.arquivada = 0
        ORDER BY a.data_hora DESC`
    },
    {
        name: 'Historico Avarias',
        sql: `SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.estado_faturacao,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_inicio) as data_hora_inicio, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim, 
               a.tecnico_id, a.notas,
               a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               (m.marca || ' - ' || m.modelo) as maquina_nome, m.uuid as maquina_uuid, 
               c.nome as cliente_nome, c.id as cliente_id,
               t.nome as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        LEFT JOIN tecnicos t ON a.tecnico_id = t.id
        WHERE a.estado = 'resolvida'
        ORDER BY COALESCE(a.data_hora_fim, a.data_hora) DESC`
    }
];

async function test() {
    for (const q of queries) {
        console.log(`Testing query: ${q.name}...`);
        try {
            await new Promise((resolve, reject) => {
                db.all(q.sql, [], (err, rows) => {
                    if (err) reject(err);
                    else {
                        console.log(`✅ ${q.name} OK: ${rows.length} rows`);
                        resolve();
                    }
                });
            });
        } catch (e) {
            console.error(`❌ ${q.name} ERROR:`, e.message);
        }
    }
    db.close();
}

test();
