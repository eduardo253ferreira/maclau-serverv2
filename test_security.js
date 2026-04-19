/**
 * 🔒 TESTES DE SEGURANÇA - MACLAU SERVER
 * 
 * Execute este script para validar se todas as correções de segurança foram implementadas.
 * 
 * Uso: node test_security.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Iniciando Auditoria de Segurança...\n');

let totalIssues = 0;
let criticalIssues = 0;

// Ler o ficheiro server.js
const serverPath = path.join(__dirname, 'server.js');
if (!fs.existsSync(serverPath)) {
    console.error('❌ Ficheiro server.js não encontrado!');
    process.exit(1);
}

const serverCode = fs.readFileSync(serverPath, 'utf8');

// Ler o ficheiro .env se existir
const envPath = path.join(__dirname, '.env');
let envContent = '';
if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('                   VERIFICAÇÕES DE SEGURANÇA                    ');
console.log('═══════════════════════════════════════════════════════════════\n');

// ==================== TESTE 1: SQL INJECTION ====================
console.log('🔍 Teste 1: SQL Injection');
const sqlInjectionPatterns = [
    /db\.(get|run|all)\([^?]*\$\{[^}]+\}/g,  // Template strings em queries
    /db\.(get|run|all)\([^?]*\+\s*[a-zA-Z_]/g,  // Concatenação de strings
];

let sqlInjectionFound = false;
sqlInjectionPatterns.forEach(pattern => {
    const matches = serverCode.match(pattern);
    if (matches) {
        console.log('   ❌ CRÍTICO: Possível SQL Injection detectada!');
        matches.forEach(m => console.log(`      → ${m.substring(0, 60)}...`));
        sqlInjectionFound = true;
        criticalIssues++;
    }
});

if (!sqlInjectionFound) {
    console.log('   ✅ Nenhuma vulnerabilidade de SQL Injection encontrada');
} else {
    totalIssues++;
}
console.log('');

// ==================== TESTE 2: CORS ABERTO ====================
console.log('🔍 Teste 2: Configuração CORS');
if (serverCode.includes('app.use(cors());') && !serverCode.includes('origin:')) {
    console.log('   ❌ CRÍTICO: CORS aberto a todas as origens!');
    console.log('      → Configurar CORS com lista de domínios permitidos');
    totalIssues++;
    criticalIssues++;
} else if (serverCode.includes('origin:')) {
    console.log('   ✅ CORS configurado com restrições de origem');
} else {
    console.log('   ⚠️  CORS não detectado');
}
console.log('');

// ==================== TESTE 3: SECRET_KEY FRACA ====================
console.log('🔍 Teste 3: SECRET_KEY');
if (serverCode.includes('|| \'maclau_fallback_secret_key\'') ||
    serverCode.includes('|| \'maclau')) {
    console.log('   ❌ CRÍTICO: Fallback secret key detectada!');
    console.log('      → Remover fallback e forçar SECRET_KEY no .env');
    totalIssues++;
    criticalIssues++;
} else {
    console.log('   ✅ Sem fallback secret key');
}

if (envContent) {
    const secretMatch = envContent.match(/SECRET_KEY=(.+)/);
    if (secretMatch) {
        const secret = secretMatch[1].trim();
        if (secret.length < 32) {
            console.log('   ❌ CRÍTICO: SECRET_KEY muito curta!');
            console.log(`      → Atual: ${secret.length} caracteres, mínimo: 32`);
            totalIssues++;
            criticalIssues++;
        } else if (secret.includes('maclau') || secret.includes('123') || secret.includes('secret')) {
            console.log('   ⚠️  AVISO: SECRET_KEY parece previsível');
            console.log('      → Gerar chave aleatória com crypto.randomBytes(64)');
            totalIssues++;
        } else {
            console.log('   ✅ SECRET_KEY parece segura');
        }
    } else {
        console.log('   ❌ CRÍTICO: SECRET_KEY não encontrada no .env!');
        totalIssues++;
        criticalIssues++;
    }
}
console.log('');

// ==================== TESTE 4: JWT SEM EXPIRAÇÃO ====================
console.log('🔍 Teste 4: JWT Expiration');
if (!serverCode.includes('expiresIn:') && serverCode.includes('jwt.sign')) {
    console.log('   ❌ ALTO: JWTs sem expiração!');
    console.log('      → Adicionar { expiresIn: \'8h\' } ao jwt.sign()');
    totalIssues++;
} else if (serverCode.includes('expiresIn:')) {
    console.log('   ✅ JWTs com expiração configurada');
} else {
    console.log('   ⚠️  JWT não detectado');
}
console.log('');

// ==================== TESTE 5: PASSWORDS DEFAULT ====================
console.log('🔍 Teste 5: Passwords Default');
if (serverCode.includes('DEFAULT \'1234\'') || serverCode.includes('password: \'1234\'')) {
    console.log('   ❌ CRÍTICO: Password default \'1234\' detectada!');
    console.log('      → Remover default e forçar criação de password forte');
    totalIssues++;
    criticalIssues++;
} else {
    console.log('   ✅ Sem passwords default inseguras');
}
console.log('');

// ==================== TESTE 6: COOKIES SEM SECURE FLAG ====================
console.log('🔍 Teste 6: Cookies Security');
if (serverCode.includes('res.cookie') && !serverCode.includes('secure:')) {
    console.log('   ❌ ALTO: Cookies sem flag \'secure\'!');
    console.log('      → Adicionar secure: process.env.NODE_ENV === \'production\'');
    totalIssues++;
} else if (serverCode.includes('secure:')) {
    console.log('   ✅ Cookies com flags de segurança');
}

if (serverCode.includes('sameSite')) {
    console.log('   ✅ Cookies com proteção SameSite');
} else {
    console.log('   ⚠️  AVISO: SameSite não configurado nos cookies');
    totalIssues++;
}
console.log('');

// ==================== TESTE 7: RATE LIMITING ====================
console.log('🔍 Teste 7: Rate Limiting');
if (!serverCode.includes('express-rate-limit') && !serverCode.includes('rateLimit')) {
    console.log('   ❌ ALTO: Rate limiting não implementado!');
    console.log('      → Instalar e configurar express-rate-limit');
    totalIssues++;
} else {
    console.log('   ✅ Rate limiting detectado');

    // Verificar limites
    const maxMatch = serverCode.match(/max:\s*(\d+)/g);
    if (maxMatch) {
        maxMatch.forEach(m => {
            const limit = parseInt(m.match(/\d+/)[0]);
            if (limit > 500) {
                console.log(`   ⚠️  AVISO: Limite de ${limit} req/janela parece alto`);
            }
        });
    }
}
console.log('');

// ==================== TESTE 8: PASSWORDS EM RESPOSTAS ====================
console.log('🔍 Teste 8: Passwords em Respostas API');
if (serverCode.includes('SELECT * FROM tecnicos') || serverCode.includes('SELECT * FROM administradores')) {
    console.log('   ⚠️  AVISO: SELECT * pode expor passwords!');
    console.log('      → Especificar colunas explicitamente (sem password)');
    totalIssues++;
} else {
    console.log('   ✅ Queries não usam SELECT *');
}
console.log('');

// ==================== TESTE 9: VALIDAÇÃO DE INPUTS ====================
console.log('🔍 Teste 9: Validação de Inputs');
const hasValidation = serverCode.includes('sanitizeString') ||
    serverCode.includes('isValidUUID') ||
    serverCode.includes('.trim()');

if (!hasValidation) {
    console.log('   ⚠️  AVISO: Pouca validação/sanitização de inputs detectada');
    console.log('      → Implementar funções de sanitização');
    totalIssues++;
} else {
    console.log('   ✅ Validação de inputs implementada');
}
console.log('');

// ==================== TESTE 10: LOGGING DE SEGURANÇA ====================
console.log('🔍 Teste 10: Logging de Segurança');
if (!serverCode.includes('securityLog') && !serverCode.includes('winston')) {
    console.log('   ⚠️  AVISO: Logging de segurança não detectado');
    console.log('      → Implementar logs para eventos de segurança');
    totalIssues++;
} else {
    console.log('   ✅ Logging de segurança implementado');
}
console.log('');

// ==================== TESTE 11: GRACEFUL SHUTDOWN ====================
console.log('🔍 Teste 11: Graceful Shutdown');
if (!serverCode.includes('SIGTERM') && !serverCode.includes('SIGINT')) {
    console.log('   ⚠️  AVISO: Graceful shutdown não implementado');
    console.log('      → Adicionar handlers para SIGTERM/SIGINT');
    totalIssues++;
} else {
    console.log('   ✅ Graceful shutdown implementado');
}
console.log('');

// ==================== TESTE 12: HELMET ====================
console.log('🔍 Teste 12: Helmet (Security Headers)');
if (!serverCode.includes('helmet')) {
    console.log('   ❌ ALTO: Helmet não implementado!');
    console.log('      → Instalar e configurar helmet');
    totalIssues++;
} else {
    console.log('   ✅ Helmet configurado');

    if (serverCode.includes('"img-src": ["\'self\'", "data:", "blob:", "http:", "https:", "*"]')) {
        console.log('   ⚠️  AVISO: CSP img-src demasiado permissivo (permite *)');
        totalIssues++;
    }
}
console.log('');

// ==================== TESTE 13: HTTPS/SSL ====================
console.log('🔍 Teste 13: HTTPS/SSL');
if (envContent.includes('NODE_ENV=production')) {
    console.log('   ⚠️  AVISO: Configurar HTTPS em produção!');
    console.log('      → Usar certificado SSL/TLS (Let\'s Encrypt gratuito)');
} else {
    console.log('   ℹ️  Modo desenvolvimento - HTTPS não obrigatório');
}
console.log('');

// ==================== TESTE 14: FICHEIRO .ENV ====================
console.log('🔍 Teste 14: Ficheiro .env');
if (!envContent) {
    console.log('   ⚠️  AVISO: Ficheiro .env não encontrado!');
    console.log('      → Criar .env com configurações seguras');
    totalIssues++;
} else {
    console.log('   ✅ Ficheiro .env existe');

    // Verificar .gitignore
    const gitignorePath = path.join(__dirname, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        const gitignore = fs.readFileSync(gitignorePath, 'utf8');
        if (!gitignore.includes('.env')) {
            console.log('   ❌ CRÍTICO: .env não está no .gitignore!');
            console.log('      → Adicionar .env ao .gitignore IMEDIATAMENTE');
            criticalIssues++;
            totalIssues++;
        } else {
            console.log('   ✅ .env está no .gitignore');
        }
    } else {
        console.log('   ⚠️  AVISO: .gitignore não encontrado');
    }
}
console.log('');

// ==================== RESUMO ====================
console.log('═══════════════════════════════════════════════════════════════');
console.log('                        RESUMO DA AUDITORIA                     ');
console.log('═══════════════════════════════════════════════════════════════\n');

if (totalIssues === 0) {
    console.log('✅ EXCELENTE! Nenhum problema de segurança detectado!\n');
    console.log('🎉 O servidor está pronto para produção do ponto de vista da auditoria.\n');
} else {
    console.log(`⚠️  TOTAL DE PROBLEMAS: ${totalIssues}`);
    console.log(`❌ PROBLEMAS CRÍTICOS: ${criticalIssues}\n`);

    if (criticalIssues > 0) {
        console.log('🚨 ATENÇÃO: Problemas CRÍTICOS devem ser corrigidos IMEDIATAMENTE!');
        console.log('   O servidor NÃO está pronto para produção.\n');
    } else {
        console.log('ℹ️  Problemas encontrados são avisos/melhorias.');
        console.log('   Recomenda-se corrigi-los antes de produção.\n');
    }
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('                     CHECKLIST PRÉ-PRODUÇÃO                     ');
console.log('═══════════════════════════════════════════════════════════════\n');

const checklist = [
    '[ ] Corrigir SQL Injection (usar prepared statements)',
    '[ ] Configurar CORS com domínios específicos',
    '[ ] Gerar SECRET_KEY forte (64+ chars)',
    '[ ] Adicionar expiração aos JWTs (8h)',
    '[ ] Remover password default dos técnicos',
    '[ ] Configurar cookies com secure flag',
    '[ ] Validar todos os inputs (UUID, emails, etc)',
    '[ ] Não retornar passwords em respostas API',
    '[ ] Implementar logging de segurança',
    '[ ] Adicionar graceful shutdown',
    '[ ] Configurar Helmet com CSP restritivo',
    '[ ] Implementar HTTPS em produção',
    '[ ] Adicionar .env ao .gitignore',
    '[ ] Fazer backup automático da base de dados',
    '[ ] Testar rate limiting',
    '[ ] Configurar monitorização (Sentry/similar)',
    '[ ] Documentar APIs',
    '[ ] Testar em staging antes de produção'
];

checklist.forEach(item => console.log(item));

console.log('\n═══════════════════════════════════════════════════════════════\n');

if (criticalIssues > 0) {
    process.exit(1);
}