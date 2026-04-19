// const fetch = require('node-fetch'); // Usando fetch global do Node 18+

async function testRateLimit() {
    console.log("Iniciando teste de Rate Limiting...");
    const url = 'http://localhost:3000/api/public/avarias';
    const payload = { maquina_id: 'any-uuid', tipo_avaria: 2 };

    for (let i = 1; i <= 25; i++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            console.log(`Requisição #${i}: Status ${res.status} - ${JSON.stringify(data)}`);
            if (res.status === 429) {
                console.log("SUCESSO: Rate limiting bloqueou corretamente após 20 pedidos.");
                return;
            }
        } catch (err) {
            console.error("Erro na requisição:", err.message);
        }
    }
    console.log("FALHA: Rate limiting não bloqueou conforme esperado.");
}

testRateLimit();
