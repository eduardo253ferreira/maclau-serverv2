const fs = require('fs');
const crypto = require('crypto');

// Gerar SECRET_KEY forte (128 caracteres)
const secretKey = crypto.randomBytes(64).toString('hex');

// Conteúdo do .env
const envContent = `PORT=3000
NODE_ENV=production
SECRET_KEY=${secretKey}
ADMIN_USER=admin
ADMIN_PASS=TrocaIsto123!
ALLOWED_ORIGINS=http://localhost:3000,http://teudominio.com
COOKIE_SECURE=false
`;

// Escrever ficheiro
fs.writeFileSync('.env', envContent, 'utf8');

console.log('✅ Ficheiro .env criado com sucesso!');
console.log('📊 SECRET_KEY tem', secretKey.length, 'caracteres');
console.log('\n📄 Conteúdo:');
console.log(envContent);