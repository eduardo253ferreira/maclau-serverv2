require('dotenv').config();
process.env.TZ = 'Europe/Lisbon';
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const qrcode = require('qrcode');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const multer = require('multer');

// --- Configuração Multer (Upload de Fotos) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/reports')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, 'report-' + uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Apenas imagens são permitidas!'));
        }
    }
});
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔒 SEGURANÇA: Confiar no proxy (necessário para HTTPS via proxy e Rate Limiting)
app.set('trust proxy', 1);

// 🔒 SEGURANÇA: Validar SECRET_KEY obrigatória e forte
const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY || SECRET_KEY.length < 32) {
    console.error('❌ ERRO FATAL: SECRET_KEY não definida ou muito fraca! Mínimo 32 caracteres.');
    console.error('   Gere uma chave forte: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
}

// 🔒 SEGURANÇA: Helper para sanitização de inputs
const sanitizeString = (str, maxLength = 255) => {
    if (typeof str !== 'string') return '';
    return str.trim().substring(0, maxLength);
};

// 🔒 SEGURANÇA: Validador de UUID
const isValidUUID = (uuid) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
};

// 🔒 SEGURANÇA: Logger de segurança (substituir por Winston em produção)
const securityLog = (event, details) => {
    const timestamp = new Date().toISOString();
    console.log(`[SECURITY] ${timestamp} - ${event}:`, JSON.stringify(details));
};

// Helmet com CSP mais restritivo
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            "script-src-attr": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            "img-src": ["'self'", "data:", "blob:"],  // 🔒 Removido "*" e "http:"
            "connect-src": ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 🔒 SEGURANÇA: CORS configurado corretamente
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000']; // Apenas localhost em dev

app.use(cors({
    origin: (origin, callback) => {
        // Permitir requests sem origin (apps mobile, etc) ou do próprio host
        if (!origin) return callback(null, true);

        const isLocalHost = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('192.168.') || origin.includes('10.');

        if (allowedOrigins.includes(origin) || isLocalHost) {
            callback(null, true);
        } else {
            securityLog('CORS_BLOCKED', { origin });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' })); // 🔒 Limitar tamanho do body
app.use(cookieParser());

// Middleware de Proteção para ficheiros HTML específicos
const authorizeHTML = (requiredRole) => {
    return (req, res, next) => {
        const token = req.cookies.maclau_token;
        if (!token) {
            securityLog('HTML_ACCESS_DENIED', { path: req.path, reason: 'no_token' });
            return res.redirect('/index.html?expired=1');
        }
        jwt.verify(token, SECRET_KEY, (err, decoded) => {
            if (err || (requiredRole && decoded.role !== requiredRole)) {
                securityLog('HTML_ACCESS_DENIED', { path: req.path, reason: 'invalid_token', role: requiredRole });
                return res.redirect('/index.html?expired=1');
            }
            next();
        });
    };
};

// Rotas HTML protegidas (devem vir antes de express.static)
app.get('/admin.html', authorizeHTML('admin'), (req, res, next) => {
    res.sendFile('admin.html', { root: path.join(__dirname, 'public') }, err => {
        if (err) {
            console.error('[ERROR] Falha ao enviar admin.html:', err);
            next(err);
        }
    });
});

app.get('/tecnico.html', authorizeHTML('tecnico'), (req, res, next) => {
    res.sendFile('tecnico.html', { root: path.join(__dirname, 'public') }, err => {
        if (err) {
            console.error('[ERROR] Falha ao enviar tecnico.html:', err);
            next(err);
        }
    });
});

// 🔒 SEGURANÇA: Rota protegida para servir fotos dos relatórios (fora da pasta public)
app.get('/uploads/reports/:filename', (req, res) => {
    const token = req.cookies.maclau_token;
    if (!token) {
        securityLog('PHOTO_ACCESS_DENIED', { path: req.path, reason: 'no_token' });
        return res.sendStatus(401);
    }

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            securityLog('PHOTO_ACCESS_DENIED', { path: req.path, reason: 'invalid_token' });
            return res.sendStatus(403);
        }
        
        // Apenas Admins e Técnicos podem ver as fotos
        if (decoded.role !== 'admin' && decoded.role !== 'tecnico') {
            securityLog('PHOTO_ACCESS_DENIED', { path: req.path, reason: 'unauthorized_role', role: decoded.role });
            return res.sendStatus(403);
        }

        const filePath = path.join(__dirname, 'uploads', 'reports', req.params.filename);
        
        // Verificar se o ficheiro existe antes de enviar
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.sendStatus(404);
        }
    });
});

app.use(express.static(path.join(__dirname, 'public')));

// 🔒 SEGURANÇA: Rate Limiting ajustado
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200, // 🔒 Reduzido de 1000 para 200
    message: { error: "Demasiados pedidos a partir deste IP. Tente mais tarde." },
    standardHeaders: true,
    legacyHeaders: false,
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // 🔒 Reduzido de 10 para 5
    message: { error: "Demasiadas tentativas de login. Tente novamente após 15 minutos." },
    skipSuccessfulRequests: true, // Não conta logins bem-sucedidos
});

const reportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // 🔒 Reduzido de 20 para 10
    message: { error: "Limite de reportes atingido. Tente novamente mais tarde." }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/public/avarias', reportLimiter);

// Helper para Erros de DB (evitar leaks)
const handleDBError = (res, err, customMsg = "Erro interno no servidor") => {
    console.error('[DB ERROR]', err);
    res.status(500).json({ error: `${customMsg} (${err.message})` });
};

// Initialize DB
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to the SQLite database.');
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS clientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                telefone TEXT,
                email TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS administradores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                email TEXT
            )`);

            // Inicializar Admin se não existir
            db.get(`SELECT COUNT(*) as count FROM administradores`, [], (err, row) => {
                if (!err && row && row.count === 0) {
                    const adminUser = process.env.ADMIN_USER;
                    const adminPass = process.env.ADMIN_PASS;

                    if (!adminUser || !adminPass) {
                        console.error('❌ ADMIN_USER e ADMIN_PASS devem estar definidos no .env');
                        process.exit(1);
                    }

                    const hash = bcrypt.hashSync(adminPass, 10);
                    db.run(`INSERT INTO administradores (username, password) VALUES (?, ?)`, [adminUser, hash]);
                    console.log(`✅ [AUTH] Utilizador Admin '${adminUser}' inicializado.`);
                } else {
                    console.log(`✅ [AUTH] Base de dados de administradores verificada.`);
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS maquinas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id INTEGER,
                marca TEXT,
                modelo TEXT,
                numero_serie TEXT,
                data_instalacao TEXT,
                data_inicio_garantia TEXT,
                data_fim_garantia TEXT,
                uuid TEXT NOT NULL UNIQUE,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cliente_id) REFERENCES clientes (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS avarias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                maquina_id TEXT NOT NULL, 
                tipo_avaria INTEGER NOT NULL,
                estado TEXT DEFAULT 'pendente',
                estado_faturacao TEXT DEFAULT 'Por Faturar',
                tecnico_id INTEGER,
                arquivada INTEGER DEFAULT 0,
                data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
                data_hora_inicio DATETIME,
                data_hora_fim DATETIME,
                relatorio TEXT,
                relatorio_submetido INTEGER DEFAULT 0,
                pecas_substituidas TEXT,
                horas_trabalho REAL,
                data_agendada DATETIME,
                FOREIGN KEY (maquina_id) REFERENCES maquinas (uuid),
                FOREIGN KEY (tecnico_id) REFERENCES tecnicos (id)
            )`);

            // 🔒 SEGURANÇA: Remover password default
            db.run(`CREATE TABLE IF NOT EXISTS tecnicos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                especialidade TEXT,
                telefone TEXT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )`);

            // Migrações movidas para o final do bloco de inicialização para garantir que as tabelas existem


            db.run(`CREATE TABLE IF NOT EXISTS servicos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id INTEGER NOT NULL,
                tecnico_id INTEGER,
                tipo_servico TEXT NOT NULL,
                tipo_camiao TEXT NOT NULL,
                estado TEXT DEFAULT 'pendente',
                estado_faturacao TEXT DEFAULT 'Por Faturar',
                arquivada INTEGER DEFAULT 0,
                data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
                data_hora_inicio DATETIME,
                data_hora_fim DATETIME,
                relatorio TEXT,
                relatorio_submetido INTEGER DEFAULT 0,
                pecas_substituidas TEXT,
                horas_trabalho REAL,
                notas TEXT,
                data_hora_pausa DATETIME,
                assinatura_cliente TEXT,
                assinatura_tecnico TEXT,
                data_agendada DATETIME,
                FOREIGN KEY (cliente_id) REFERENCES clientes (id),
                FOREIGN KEY (tecnico_id) REFERENCES tecnicos (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS fotos_relatorio (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                avaria_id INTEGER,
                servico_id INTEGER,
                caminho TEXT NOT NULL,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (avaria_id) REFERENCES avarias (id),
                FOREIGN KEY (servico_id) REFERENCES servicos (id)
            )`);

            // 🔒 SEGURANÇA: Migração com serialize para evitar race conditions
            db.serialize(() => {
                db.all(`SELECT id, password FROM tecnicos`, [], (err, rows) => {
                    if (!err && rows && rows.length > 0) {
                        const stmt = db.prepare(`UPDATE tecnicos SET password = ? WHERE id = ?`);
                        rows.forEach(row => {
                            // Hash BCrypt tem 60 caracteres
                            if (row.password && row.password.length < 60) {
                                const hash = bcrypt.hashSync(row.password, 10);
                                stmt.run(hash, row.id);
                            }
                        });
                        stmt.finalize();
                        console.log('✅ [MIGRATION] Passwords migradas para bcrypt');
                    }
                });
            });

            db.run(`CREATE TABLE IF NOT EXISTS fault_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS frota (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                marca TEXT NOT NULL,
                modelo TEXT NOT NULL,
                ano INTEGER,
                data_proxima_inspecao DATE,
                proxima_revisao_kms INTEGER,
                data_ultima_revisao DATE
            )`);

            // --- MIGRATIONS (Adicionar colunas a tabelas existentes) ---
            const migrations = [
                { table: 'avarias', column: 'data_hora_inicio', type: 'DATETIME' },
                { table: 'avarias', column: 'data_hora_fim', type: 'DATETIME' },
                { table: 'avarias', column: 'relatorio', type: 'TEXT' },
                { table: 'avarias', column: 'relatorio_submetido', type: 'INTEGER DEFAULT 0' },
                { table: 'avarias', column: 'pecas_substituidas', type: 'TEXT' },
                { table: 'avarias', column: 'horas_trabalho', type: 'REAL' },
                { table: 'avarias', column: 'notas', type: 'TEXT' },
                { table: 'avarias', column: 'data_hora_pausa', type: 'DATETIME' },
                { table: 'avarias', column: 'assinatura_cliente', type: 'TEXT' },
                { table: 'avarias', column: 'assinatura_tecnico', type: 'TEXT' },
                { table: 'avarias', column: 'estado_faturacao', type: 'TEXT DEFAULT \'Por Faturar\'' },
                { table: 'avarias', column: 'data_agendada', type: 'DATETIME' },
                { table: 'servicos', column: 'assinatura_tecnico', type: 'TEXT' },
                { table: 'servicos', column: 'data_agendada', type: 'DATETIME' },
                { table: 'administradores', column: 'email', type: 'TEXT' },
                { table: 'clientes', column: 'morada', type: 'TEXT' },
                { table: 'clientes', column: 'NIF', type: 'TEXT' }
            ];

            migrations.forEach(m => {
                db.run(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`, (err) => {
                    // Ignorar erro de "coluna já existe"
                });
            });

        });
    }
});

// --- Configuração Nodemailer ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Helper para enviar e-mail de atribuição
async function sendAssignmentEmail(tecnicoEmail, tecnicoNome, machineNome, clientNome, notas = '', type = 'avaria') {
    if (!process.env.SMTP_HOST || !tecnicoEmail) return;

    const isService = type === 'servico';
    const typeLabel = isService ? 'Serviço' : 'Avaria';
    const accentColor = isService ? '#1e3a8a' : '#2D5A27'; // Azul para serviço, Verde para avaria
    const taskDescription = isService ? 'uma nova tarefa de serviço (instalação/transporte)' : 'uma nova tarefa de manutenção';

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Maclau <noreply@maclau.pt>',
        to: tecnicoEmail,
        subject: `Novo/a ${typeLabel} Atribuído/a: ${machineNome}`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <img src="cid:logo" alt="Maclau Logo" style="max-width: 150px; height: auto;">
                </div>
                <h1 style="color: ${accentColor}; font-size: 24px; margin-bottom: 20px;">Olá, ${tecnicoNome}!</h1>
                <p style="font-size: 16px; color: #64748B; margin-bottom: 24px;">Foi-lhe atribuída ${taskDescription}.</p>
                
                <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 24px; border-top: 4px solid ${accentColor};">
                    <p style="margin: 0 0 10px 0;"><strong>Cliente/Lavandaria:</strong> ${clientNome}</p>
                    <p style="margin: 0;"><strong>${isService ? 'Tipo de Serviço' : 'Máquina'}:</strong> ${machineNome}</p>
                </div>

                ${notas ? `
                <div style="margin-bottom: 24px;">
                    <h3 style="color: #475569; font-size: 14px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Notas Adicionais:</h3>
                    <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; color: #92400e; font-style: italic; border-radius: 4px;">
                        ${notas}
                    </div>
                </div>
                ` : ''}
                
                <p style="font-size: 14px; color: #64748B;">Por favor, aceda ao seu portal para começar a trabalhar.</p>
                <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8;">
                    Este é um e-mail automático enviado pelo sistema Maclau.
                </div>
            </div>
        `,
        attachments: [{
            filename: 'logo.png',
            path: path.join(__dirname, 'public', 'img', 'logo.png'),
            cid: 'logo' // mesmo valor que em src="cid:logo"
        }]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Notificação enviada para: ${tecnicoEmail}`);
    } catch (error) {
        console.error('[EMAIL ERROR]', error);
    }
}

// Helper para notificar administradores de novas avarias reportadas por clientes
async function sendAdminNotificationEmail(adminEmails, machineNome, clientNome, tipoAvaria) {
    if (!process.env.SMTP_HOST || !adminEmails || adminEmails.length === 0) return;

    const tipoTexto = tipoAvaria === 1 ? 'Elétrica' : tipoAvaria === 3 ? 'Mecânica' : 'Desconhecida';

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Maclau <noreply@maclau.pt>',
        to: adminEmails.join(','),
        subject: `⚠️ ALERTA: Nova Avaria Reportada - ${clientNome}`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #fca5a5; border-radius: 12px; padding: 30px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <img src="cid:logo" alt="Maclau Logo" style="max-width: 150px; height: auto;">
                </div>
                <h1 style="color: #b91c1c; font-size: 22px; margin-bottom: 20px;">Nova Avaria Reportada!</h1>
                <p style="font-size: 16px; color: #4b5563;">Um cliente acabou de reportar uma avaria através do sistema QR Code.</p>
                
                <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin-bottom: 24px; border-left: 4px solid #ef4444;">
                    <p style="margin: 0 0 10px 0;"><strong>Cliente:</strong> ${clientNome}</p>
                    <p style="margin: 0 0 10px 0;"><strong>Máquina:</strong> ${machineNome}</p>
                    <p style="margin: 0;"><strong>Tipo de Avaria:</strong> ${tipoTexto}</p>
                </div>

                <p style="font-size: 14px; color: #6b7280;">Por favor, aceda ao painel de administração para atribuir um técnico a esta ocorrência.</p>
                
                <div style="margin-top: 30px; border-top: 1px solid #fee2e2; padding-top: 20px; font-size: 12px; color: #9ca3af;">
                    Este é um alerta automático de segurança do sistema Maclau.
                </div>
            </div>
        `,
        attachments: [{
            filename: 'logo.png',
            path: path.join(__dirname, 'public', 'img', 'logo.png'),
            cid: 'logo'
        }]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Notificação de administrador enviada.`);
    } catch (error) {
        console.error('[EMAIL ERROR ADMIN]', error);
    }
}

// Helper para alertas de frota (inspeções)
async function sendFrotaAlertEmail(adminEmails, vehicle, isToday = false) {
    if (!process.env.SMTP_HOST || !adminEmails || adminEmails.length === 0) return;

    const subject = isToday 
        ? `ALERTA: Inspeção de Veículo HOJE - ${vehicle.marca} ${vehicle.modelo}`
        : `Lembrete: Inspeção de Veículo em 1 Semana - ${vehicle.marca} ${vehicle.modelo}`;

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Maclau <noreply@maclau.pt>',
        to: adminEmails.join(','),
        subject: subject,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <img src="cid:logo" alt="Maclau Logo" style="max-width: 150px; height: auto;">
                </div>
                <h1 style="color: #2D5A27; font-size: 24px; margin-bottom: 20px;">Alerta de Frota</h1>
                <p style="font-size: 16px; color: #64748B; margin-bottom: 24px;">
                    Este é um lembrete automático sobre a próxima inspeção do veículo:
                </p>
                
                <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 24px; border-top: 4px solid #2D5A27;">
                    <p style="margin: 0 0 10px 0;"><strong>Veículo:</strong> ${vehicle.marca} ${vehicle.modelo} (${vehicle.ano || 'N/A'})</p>
                    <p style="margin: 0;"><strong>Data da Inspeção:</strong> ${vehicle.data_proxima_inspecao ? vehicle.data_proxima_inspecao.split('-').reverse().join('/') : 'N/A'}</p>
                </div>

                <p style="font-size: 16px; color: #1E293B;">
                    ${isToday ? '⚠️ A inspeção deve ser realizada <strong>HOJE</strong>.' : 'ℹ️ A inspeção está agendada para daqui a <strong>7 dias</strong>.'}
                </p>
                
                <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8;">
                    Este é um e-mail automático enviado pelo sistema Maclau.
                </div>
            </div>
        `,
        attachments: [{
            filename: 'logo.png',
            path: path.join(__dirname, 'public', 'img', 'logo.png'),
            cid: 'logo'
        }]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Alerta de frota enviado para: ${adminEmails.join(', ')}`);
    } catch (error) {
        console.error('[EMAIL ERROR FROTA]', error);
    }
}

// Função para verificar inspeções
function checkVehicleInspections() {
    console.log('[FROTA] A verificar inspeções agendadas...');
    
    db.all(`SELECT email FROM administradores WHERE email IS NOT NULL AND email != ''`, [], (err, admins) => {
        if (err || !admins || admins.length === 0) return;
        const adminEmails = admins.map(a => a.email);

        const today = new Date().toISOString().split('T')[0];
        const nextWeekDate = new Date();
        nextWeekDate.setDate(nextWeekDate.getDate() + 7);
        const nextWeek = nextWeekDate.toISOString().split('T')[0];

        // Hoje
        db.all(`SELECT * FROM frota WHERE data_proxima_inspecao = ?`, [today], (err, vehiclesToday) => {
            if (!err && vehiclesToday) {
                vehiclesToday.forEach(v => sendFrotaAlertEmail(adminEmails, v, true));
            }
        });

        // 7 dias
        db.all(`SELECT * FROM frota WHERE data_proxima_inspecao = ?`, [nextWeek], (err, vehiclesNextWeek) => {
            if (!err && vehiclesNextWeek) {
                vehiclesNextWeek.forEach(v => sendFrotaAlertEmail(adminEmails, v, false));
            }
        });
    });
}

function scheduleDailyCheck() {
    const now = new Date();
    const nextCheck = new Date();
    nextCheck.setHours(8, 0, 0, 0);
    
    if (nextCheck <= now) {
        nextCheck.setDate(nextCheck.getDate() + 1);
    }
    
    const delay = nextCheck - now;
    console.log(`[SCHEDULE] Próxima verificação de frota em ${(delay / 1000 / 60 / 60).toFixed(2)} horas.`);
    
    setTimeout(() => {
        checkVehicleInspections();
        setInterval(checkVehicleInspections, 24 * 60 * 60 * 1000);
    }, delay);
}

// 🔒 SEGURANÇA: Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing DB');
    db.close((err) => {
        if (err) console.error(err);
        console.log('Database connection closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing DB');
    db.close((err) => {
        if (err) console.error(err);
        console.log('Database connection closed.');
        process.exit(0);
    });
});

// Middleware for JWT verification
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (err) {
                securityLog('JWT_VERIFICATION_FAILED', { error: err.message, ip: req.ip });
                return res.sendStatus(403);
            }
            req.user = user;
            next();
        });
    } else {
        res.sendStatus(401);
    }
};

// Middlewares de Autorização
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') next();
    else {
        securityLog('UNAUTHORIZED_ACCESS', { role: req.user?.role, required: 'admin', ip: req.ip });
        res.status(403).json({ error: "Acesso negado: Requer privilégios de Administrador" });
    }
};

const isTecnico = (req, res, next) => {
    if (req.user && req.user.role === 'tecnico') next();
    else {
        securityLog('UNAUTHORIZED_ACCESS', { role: req.user?.role, required: 'tecnico', ip: req.ip });
        res.status(403).json({ error: "Acesso negado: Requer conta de Técnico" });
    }
};

const isAdminOrTecnico = (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'tecnico')) next();
    else {
        securityLog('UNAUTHORIZED_ACCESS', { role: req.user?.role, required: 'admin_or_tecnico', ip: req.ip });
        res.status(403).json({ error: "Acesso negado" });
    }
};

// API: Autenticação
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email e password são obrigatórios" });
    }

    // 1. Tentar login como Administrator
    db.get(`SELECT id, username, password FROM administradores WHERE username = ?`, [email], (err, row) => {
        if (err) return handleDBError(res, err);

        if (row) {
            const match = bcrypt.compareSync(password, row.password);
            if (match) {
                const accessToken = jwt.sign(
                    { id: row.id, username: row.username, role: 'admin' },
                    SECRET_KEY,
                    { expiresIn: '8h', algorithm: 'HS256' } // 🔒 JWT com expiração
                );

                res.cookie('maclau_token', accessToken, {
                    httpOnly: true,
                    // 🔒 Permite desativar 'secure' para testes em produção via HTTP se necessário
                    secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && req.protocol === 'https'),
                    sameSite: 'strict',
                    maxAge: 8 * 60 * 60 * 1000 // 8 horas
                });

                securityLog('LOGIN_SUCCESS', { user: row.username, role: 'admin', ip: req.ip });
                return res.json({ accessToken, role: 'admin', redirectUrl: 'admin.html' });
            } else {
                securityLog('LOGIN_FAILED', { user: email, role: 'admin', reason: 'wrong_password', ip: req.ip });
            }
        }

        // 2. Tentar login como Técnico se não for Admin
        db.get(`SELECT id, nome, password FROM tecnicos WHERE email = ?`, [email], (err, row) => {
            if (err) return handleDBError(res, err);

            if (row) {
                const match = bcrypt.compareSync(password, row.password);
                if (match) {
                    const accessToken = jwt.sign(
                        { id: row.id, role: 'tecnico' },
                        SECRET_KEY,
                        { expiresIn: '8h', algorithm: 'HS256' } // 🔒 JWT com expiração
                    );

                    res.cookie('maclau_token', accessToken, {
                        httpOnly: true,
                        secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && req.protocol === 'https'),
                        sameSite: 'strict',
                        maxAge: 8 * 60 * 60 * 1000
                    });

                    securityLog('LOGIN_SUCCESS', { user: email, role: 'tecnico', ip: req.ip });
                    return res.json({
                        accessToken,
                        role: 'tecnico',
                        redirectUrl: `tecnico.html?id=${row.id}&name=${encodeURIComponent(row.nome)}`
                    });
                } else {
                    securityLog('LOGIN_FAILED', { user: email, role: 'tecnico', reason: 'wrong_password', ip: req.ip });
                }
            } else {
                securityLog('LOGIN_FAILED', { user: email, reason: 'user_not_found', ip: req.ip });
            }

            return res.status(401).json({ error: 'Credenciais inválidas' });
        });
    });
});

// API: Logout
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('maclau_token');
    res.json({ message: 'Logout efetuado com sucesso' });
});

// --- ADMIN ROUTES (Protected by JWT and Admin Role) --- //

app.get('/api/clientes', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT * FROM clientes`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/clientes', authenticateJWT, isAdmin, (req, res) => {
    let { nome, telefone, email, morada, NIF } = req.body;

    // 🔒 SEGURANÇA: Sanitização
    nome = sanitizeString(nome);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);
    morada = sanitizeString(morada, 500);
    NIF = sanitizeString(NIF, 9);

    if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Formato de email inválido" });
    if (telefone && !/^[0-9]{9}$/.test(telefone)) return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });
    if (NIF && !/^[0-9]{9}$/.test(NIF)) return res.status(400).json({ error: "NIF deve conter exatamente 9 dígitos numéricos" });

    db.run(`INSERT INTO clientes (nome, telefone, email, morada, NIF) VALUES (?, ?, ?, ?, ?)`,
        [nome, telefone, email, morada, NIF],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({ id: this.lastID, nome, telefone, email, morada, NIF });
        });
});

app.put('/api/clientes/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { nome, telefone, email, morada, NIF } = req.body;

    // 🔒 SEGURANÇA: Sanitização
    nome = sanitizeString(nome);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);
    morada = sanitizeString(morada, 500);
    NIF = sanitizeString(NIF, 9);

    if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Formato de email inválido" });
    if (telefone && !/^[0-9]{9}$/.test(telefone)) return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });
    if (NIF && !/^[0-9]{9}$/.test(NIF)) return res.status(400).json({ error: "NIF deve conter exatamente 9 dígitos numéricos" });

    db.run(`UPDATE clientes SET nome = ?, telefone = ?, email = ?, morada = ?, NIF = ? WHERE id = ?`,
        [nome, telefone, email, morada, NIF, id],
        function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Cliente atualizado com sucesso", id, nome, telefone, email, morada, NIF });
        });
});

app.delete('/api/clientes/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM clientes WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Cliente removido com sucesso", id });
    });
});

app.get('/api/maquinas', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT m.id, m.marca, m.modelo, m.numero_serie, m.data_instalacao, m.data_inicio_garantia, m.data_fim_garantia, m.uuid, strftime('%Y-%m-%dT%H:%M:%SZ', m.data_criacao) as data_criacao, c.nome as cliente_nome, c.id as cliente_id 
        FROM maquinas m 
        LEFT JOIN clientes c ON m.cliente_id = c.id
        ORDER BY m.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/maquinas', authenticateJWT, isAdmin, (req, res) => {
    const { cliente_id, data_instalacao, data_inicio_garantia, data_fim_garantia } = req.body;
    let { marca, modelo, numero_serie } = req.body;

    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    numero_serie = sanitizeString(numero_serie);

    if (!cliente_id || !marca || !modelo) return res.status(400).json({ error: "Cliente, Marca e Modelo são obrigatórios" });

    const uuid = crypto.randomUUID();

    db.run(`INSERT INTO maquinas (cliente_id, marca, modelo, numero_serie, data_instalacao, data_inicio_garantia, data_fim_garantia, uuid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [cliente_id, marca, modelo, numero_serie, data_instalacao, data_inicio_garantia, data_fim_garantia, uuid],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({ id: this.lastID, cliente_id, marca, modelo, uuid });
        });
});

app.put('/api/maquinas/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { cliente_id, data_instalacao, data_inicio_garantia, data_fim_garantia } = req.body;
    let { marca, modelo, numero_serie } = req.body;

    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    numero_serie = sanitizeString(numero_serie);

    if (!cliente_id || !marca || !modelo) return res.status(400).json({ error: "Cliente, Marca e Modelo são obrigatórios" });

    db.run(`UPDATE maquinas SET cliente_id = ?, marca = ?, modelo = ?, numero_serie = ?, data_instalacao = ?, data_inicio_garantia = ?, data_fim_garantia = ? WHERE id = ?`,
        [cliente_id, marca, modelo, numero_serie, data_instalacao, data_inicio_garantia, data_fim_garantia, id],
        function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Máquina atualizada com sucesso", id, cliente_id, marca, modelo });
        });
});

app.delete('/api/maquinas/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM maquinas WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Máquina removida com sucesso", id });
    });
});

app.get('/api/maquinas/:uuid/qrcode', authenticateJWT, isAdmin, async (req, res) => {
    const { uuid } = req.params;

    // 🔒 SEGURANÇA: Validar UUID
    if (!isValidUUID(uuid)) {
        return res.status(400).json({ error: "UUID inválido" });
    }

    const host = req.get('host');
    const protocol = req.protocol; // 🔒 Usa o mesmo protocolo do pedido atual
    const reportUrl = `${protocol}://${host}/report.html?machine=${uuid}`;

    try {
        const qrCodeDataUrl = await qrcode.toDataURL(reportUrl);
        res.json({ qrCode: qrCodeDataUrl, url: reportUrl });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate QR Code" });
    }
});

// 🔒 SEGURANÇA CRÍTICA: Endpoint para gerar QR code corrigido
app.post('/api/maquinas/gerar-qrcode', authenticateJWT, isAdmin, async (req, res) => {
    const { maquina_id } = req.body;

    // 🔒 Validar UUID
    if (!isValidUUID(maquina_id)) {
        return res.status(400).json({ error: "UUID inválido" });
    }

    // 🔒 CORRIGIDO: Usar prepared statement ao invés de string interpolation
    db.get(`SELECT * FROM maquinas WHERE uuid = ?`, [maquina_id], async (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Máquina não encontrada" });

        const host = req.get('host');
        const protocol = req.protocol;
        const url = `${protocol}://${host}/report.html?machine=${maquina_id}`;

        try {
            const qrCode = await qrcode.toDataURL(url);
            res.json({ qrCode, url });
        } catch (err) {
            res.status(500).json({ error: "Erro ao gerar QR Code" });
        }
    });
});

app.get('/api/avarias', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.estado_faturacao,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_pausa) as data_hora_pausa, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_agendada) as data_agendada,
               a.tecnico_id, a.notas,
               a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               a.assinatura_cliente,
               COALESCE(m.marca || ' - ' || m.modelo, 'Máquina Removida') as maquina_nome, 
               COALESCE(c.nome, 'Sem Cliente') as cliente_nome, 
               COALESCE(t.nome, 'Não Atribuído') as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        LEFT JOIN tecnicos t ON a.tecnico_id = t.id
        WHERE a.arquivada = 0
        ORDER BY a.data_hora DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/avarias', authenticateJWT, isAdmin, (req, res) => {
    const { maquina_id, tipo_avaria, tecnico_id, notas } = req.body;

    if (!maquina_id || !tipo_avaria) {
        return res.status(400).json({ error: "Máquina e tipo de avaria são obrigatórios" });
    }

    // Validar UUID
    if (!isValidUUID(maquina_id)) {
        console.error('[VALIDATION ERROR] UUID inválido:', maquina_id);
        return res.status(400).json({ error: "Máquina selecionada é inválida ou não foi selecionada corretamente." });
    }

    // Validar tipo_avaria
    if (!Number.isInteger(tipo_avaria) || tipo_avaria < 1 || tipo_avaria > 10) {
        return res.status(400).json({ error: "Tipo de avaria inválido" });
    }

    // Verificar se a máquina existe
    db.get(`SELECT (marca || ' - ' || modelo) as nome, cliente_id FROM maquinas WHERE uuid = ?`, [maquina_id], (err, machine) => {
        if (err) return handleDBError(res, err);
        if (!machine) return res.status(404).json({ error: "Máquina não encontrada" });

        const data_agendada = req.body.data_agendada || null;

        // Verificar se o técnico existe
        if (tecnico_id) {
            db.get(`SELECT id, nome, email FROM tecnicos WHERE id = ?`, [tecnico_id], (err, tecnico) => {
                if (err) return handleDBError(res, err);
                if (!tecnico) return res.status(404).json({ error: "Técnico não encontrado" });

                db.run(`INSERT INTO avarias (maquina_id, tipo_avaria, tecnico_id, notas, data_agendada) VALUES (?, ?, ?, ?, ?)`,
                    [maquina_id, tipo_avaria, tecnico_id, notas, data_agendada],
                    function (err) {
                        if (err) return handleDBError(res, err);
                        const avariaId = this.lastID;
                        securityLog('AVARIA_REPORTED_BY_ADMIN', { id: avariaId, maquina_id, tecnico_id });

                        db.get(`SELECT nome FROM clientes WHERE id = ?`, [machine.cliente_id], (err, client) => {
                            if (!err && client && tecnico.email) {
                                sendAssignmentEmail(tecnico.email, tecnico.nome, machine.nome, client.nome, notas, 'avaria');
                            }
                            res.status(201).json({ id: avariaId, message: "Avaria reportada e atribuída" });
                        });
                    }
                );
            });
        } else {
            db.run(`INSERT INTO avarias (maquina_id, tipo_avaria, notas, data_agendada) VALUES (?, ?, ?, ?)`,
                [maquina_id, tipo_avaria, notas, data_agendada],
                function (err) {
                    if (err) {
                        console.error('[DB ERROR] Falha ao inserir avaria sem técnico:', err);
                        return handleDBError(res, err, "Erro ao gravar na base de dados. Verifique se todos os campos estão corretos.");
                    }
                    securityLog('AVARIA_REPORTED_BY_ADMIN', { id: this.lastID, maquina_id });
                    res.status(201).json({ id: this.lastID, message: "Avaria reportada" });
                }
            );
        }
    });
});

app.put('/api/avarias/:id/arquivar', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE avarias SET arquivada = 1 WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Avaria arquivada (removida do dashboard)", id });
    });
});

// 🔒 SEGURANÇA: Validar se técnico existe antes de atribuir
app.put('/api/avarias/:id/atribuir', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { tecnico_id } = req.body;

    if (!tecnico_id) {
        return res.status(400).json({ error: "ID do técnico é obrigatório" });
    }

    // Verificar se o técnico existe
    db.get(`SELECT id, nome, email FROM tecnicos WHERE id = ?`, [tecnico_id], (err, tecnico) => {
        if (err) return handleDBError(res, err);
        if (!tecnico) return res.status(404).json({ error: "Técnico não encontrado" });

        // Buscar detalhes da avaria para o e-mail
        const avariaQuery = `
            SELECT (m.marca || ' - ' || m.modelo) as maquina_nome, c.nome as cliente_nome, a.notas
            FROM avarias a
            LEFT JOIN maquinas m ON a.maquina_id = m.uuid
            LEFT JOIN clientes c ON m.cliente_id = c.id
            WHERE a.id = ?
        `;

        db.get(avariaQuery, [id], (err, avaria) => {
            if (err) return handleDBError(res, err);

            db.run(`UPDATE avarias SET tecnico_id = ? WHERE id = ?`, [tecnico_id, id], function (err) {
                if (err) return handleDBError(res, err);
                securityLog('AVARIA_ATRIBUIDA', { avaria_id: id, tecnico_id });

                // Enviar notificação por e-mail
                if (tecnico.email && avaria) {
                    sendAssignmentEmail(tecnico.email, tecnico.nome, avaria.maquina_nome, avaria.cliente_nome, avaria.notas, 'avaria');
                }

                res.json({ message: "Técnico atribuído com sucesso", id, tecnico_id });
            });
        });
    });
});

app.put('/api/avarias/:id/status', authenticateJWT, isAdminOrTecnico, (req, res) => {
    const { id } = req.params;
    const { estado, relatorio } = req.body;

    if (!['pendente', 'em resolução', 'resolvida', 'pausada'].includes(estado)) {
        return res.status(400).json({ error: "Estado inválido" });
    }

    let query;
    let params = [estado];

    if (estado === 'em resolução') {
        query = `UPDATE avarias SET estado = ?, data_hora_inicio = COALESCE(data_hora_inicio, CURRENT_TIMESTAMP) WHERE id = ?`;
        params.push(id);
    } else if (estado === 'resolvida') {
        if (relatorio) {
            query = `UPDATE avarias SET estado = ?, data_hora_fim = CURRENT_TIMESTAMP, relatorio = ? WHERE id = ?`;
            params.push(relatorio, id);
        } else {
            query = `UPDATE avarias SET estado = ?, data_hora_fim = CURRENT_TIMESTAMP WHERE id = ?`;
            params.push(id);
        }
    } else if (estado === 'pausada') {
        if (req.body.motivo_pausa) {
            query = `UPDATE avarias SET estado = ?, relatorio = COALESCE(relatorio || '

', '') || ?, data_hora_pausa = CURRENT_TIMESTAMP WHERE id = ?`;
            const dataS = new Date().toLocaleString('pt-PT');
            const stamp = `[Reparação Pausada em ${dataS}]: ${req.body.motivo_pausa}`;
            params.push(stamp, id);
        } else {
            query = `UPDATE avarias SET estado = ?, data_hora_pausa = CURRENT_TIMESTAMP WHERE id = ?`;
            params.push(id);
        }
    } else {
        query = `UPDATE avarias SET estado = ? WHERE id = ?`;
        params.push(id);
    }

    db.run(query, params, function (err) {
        if (err) return handleDBError(res, err);
        securityLog('AVARIA_STATUS_CHANGED', { avaria_id: id, new_status: estado, user: req.user.id });
        res.json({ message: "Estado atualizado com sucesso", id, estado });
    });
});

// Salvar rascunho de relatório
app.put('/api/tecnico/avarias/:id/relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const { relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico } = req.body;
    const techId = req.user.id;

    console.log(`[DEBUG] Salvando relatório para ID ${id}. Horas: ${horas_trabalho}`);
    console.log(`[DEBUG] Assinatura Cliente (len): ${assinatura_cliente ? assinatura_cliente.length : 0}`);
    console.log(`[DEBUG] Assinatura Técnico (len): ${assinatura_tecnico ? assinatura_tecnico.length : 0}`);

    // Verificar se o técnico é o responsável pela avaria e se não está submetido
    db.get(`SELECT tecnico_id, relatorio_submetido FROM avarias WHERE id = ?`, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Avaria não encontrada" });
        if (row.tecnico_id !== techId) return res.status(403).json({ error: "Acesso negado" });
        if (row.relatorio_submetido === 1) return res.status(400).json({ error: "Relatório já foi submetido e não pode ser editado." });

        const horasNum = (horas_trabalho !== null && horas_trabalho !== '') ? parseFloat(String(horas_trabalho).replace(',', '.')) : null;

        db.run(`UPDATE avarias SET relatorio = ?, pecas_substituidas = ?, horas_trabalho = ?, assinatura_cliente = ?, assinatura_tecnico = ? WHERE id = ?`,
            [relatorio, pecas_substituidas, horasNum, assinatura_cliente, assinatura_tecnico, id], function (err) {
                if (err) {
                    console.error(`[DEBUG ERROR] Falha ao atualizar ID ${id}:`, err);
                    return handleDBError(res, err);
                }
                console.log(`[DEBUG] ID ${id} atualizado com sucesso. Horas gravadas: ${horasNum}`);
                res.json({ message: "Rascunho salvo com sucesso" });
            });
    });
});

// Submeter relatório definitivamente
app.post('/api/tecnico/avarias/:id/submeter-relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const techId = req.user.id;

    db.get(`SELECT tecnico_id, relatorio_submetido, relatorio FROM avarias WHERE id = ?`, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Avaria não encontrada" });
        if (row.tecnico_id !== techId) return res.status(403).json({ error: "Acesso negado" });
        if (row.relatorio_submetido === 1) return res.status(400).json({ error: "Relatório já foi submetido." });

        db.run(`UPDATE avarias SET relatorio_submetido = 1 WHERE id = ?`, [id], function (err) {
            if (err) return handleDBError(res, err);
            securityLog('RELATORIO_SUBMETIDO', { avaria_id: id, tecnico_id: techId });
            res.json({ message: "Relatório submetido com sucesso. Ficou agora visível para o Administrador." });
        });
    });
});

// Endpoint para Detalhes Completos do Relatório (PDF)
app.get('/api/avarias/:id/detalhes-relatorio', authenticateJWT, (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT a.*, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_inicio) as data_hora_inicio,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim,
               (m.marca || ' - ' || m.modelo) as maquina_nome, m.uuid as maquina_uuid,
               c.nome as cliente_nome, c.telefone as cliente_contato, c.email as cliente_email,
               t.nome as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        LEFT JOIN tecnicos t ON a.tecnico_id = t.id
        WHERE a.id = ?
    `;

    db.get(query, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Intervenção não encontrada" });

        // Buscar fotos
        db.all(`SELECT id, caminho FROM fotos_relatorio WHERE avaria_id = ?`, [id], (err, fotos) => {
            if (err) return handleDBError(res, err);
            row.fotos = fotos || [];
            res.json(row);
        });
    });
});

app.get('/api/estatisticas/avarias', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT a.id, a.tipo_avaria, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim, 
               a.tecnico_id, t.nome as tecnico_nome
        FROM avarias a
        LEFT JOIN tecnicos t ON a.tecnico_id = t.id
        WHERE a.estado = 'resolvida' AND a.data_hora_fim IS NOT NULL
        ORDER BY a.data_hora_fim ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/historico/avarias', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.estado_faturacao,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_inicio) as data_hora_inicio, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim, 
               a.tecnico_id, a.notas,
               a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               COALESCE(m.marca || ' - ' || m.modelo, 'Máquina Removida') as maquina_nome, m.uuid as maquina_uuid, 
               COALESCE(c.nome, 'Sem Cliente') as cliente_nome, c.id as cliente_id,
               COALESCE(t.nome, 'Não Atribuído') as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        LEFT JOIN tecnicos t ON a.tecnico_id = t.id
        WHERE a.estado = 'resolvida'
        ORDER BY COALESCE(a.data_hora_fim, a.data_hora) DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

// Atualizar estado de faturação
app.put('/api/avarias/:id/faturacao', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { estado_faturacao } = req.body;

    const allowed = ['Por Faturar', 'Faturado', 'Oferta', 'Garantia'];
    if (!allowed.includes(estado_faturacao)) {
        return res.status(400).json({ error: "Estado de faturação inválido" });
    }

    db.run(`UPDATE avarias SET estado_faturacao = ? WHERE id = ?`, [estado_faturacao, id], function (err) {
        if (err) return handleDBError(res, err);
        securityLog('AVARIA_FATURACAO_CHANGED', { avaria_id: id, novo_estado: estado_faturacao });
        res.json({ message: "Estado de faturação atualizado com sucesso", id, estado_faturacao });
    });
});

// --- SERVIÇOS ROUTES ---

app.get('/api/servicos', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT s.*, 
               COALESCE(c.nome, 'Sem Cliente') as cliente_nome, 
               COALESCE(t.nome, 'Não Atribuído') as tecnico_nome,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_fim) as data_hora_fim,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_agendada) as data_agendada
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN tecnicos t ON s.tecnico_id = t.id
        WHERE s.arquivada = 0
        ORDER BY s.data_hora DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/servicos', authenticateJWT, isAdmin, (req, res) => {
    const { cliente_id, tecnico_id, tipo_servico, tipo_camiao, notas, data_agendada } = req.body;

    if (!cliente_id || !tipo_servico || !tipo_camiao) {
        return res.status(400).json({ error: "Cliente, Tipo de Serviço e Tipo de Camião são obrigatórios" });
    }

    const query = `INSERT INTO servicos (cliente_id, tecnico_id, tipo_servico, tipo_camiao, notas, data_agendada) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(query, [cliente_id, tecnico_id || null, tipo_servico, tipo_camiao, notas, data_agendada || null], function (err) {
        if (err) return handleDBError(res, err);
        const serviceId = this.lastID;
        securityLog('SERVICE_REPORTED_BY_ADMIN', { id: serviceId, cliente_id, tecnico_id });

        if (tecnico_id) {
            db.get(`SELECT nome, email FROM tecnicos WHERE id = ?`, [tecnico_id], (err, tech) => {
                db.get(`SELECT nome FROM clientes WHERE id = ?`, [cliente_id], (err, client) => {
                    if (tech && tech.email) {
                        sendAssignmentEmail(tech.email, tech.nome, `${tipo_servico} (${tipo_camiao})`, client ? client.nome : 'Cliente', notas, 'servico');
                    }
                });
            });
        }
        res.status(201).json({ id: serviceId, message: "Serviço reportado com sucesso" });
    });
});

app.put('/api/servicos/:id/atribuir', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { tecnico_id } = req.body;

    db.get(`SELECT id, nome, email FROM tecnicos WHERE id = ?`, [tecnico_id], (err, tech) => {
        if (!tech) return res.status(404).json({ error: "Técnico não encontrado" });

        db.run(`UPDATE servicos SET tecnico_id = ? WHERE id = ?`, [tecnico_id, id], function (err) {
            if (err) return handleDBError(res, err);

            db.get(`SELECT s.tipo_servico, s.tipo_camiao, s.notas, c.nome as cliente_nome 
                   FROM servicos s JOIN clientes c ON s.cliente_id = c.id 
                   WHERE s.id = ?`, [id], (err, srv) => {
                if (srv && tech.email) {
                    sendAssignmentEmail(tech.email, tech.nome, `${srv.tipo_servico} (${srv.tipo_camiao})`, srv.cliente_nome, srv.notas, 'servico');
                }
            });
            res.json({ message: "Técnico atribuído" });
        });
    });
});

app.put('/api/servicos/:id/status', authenticateJWT, isAdminOrTecnico, (req, res) => {
    const { id } = req.params;
    const { estado, relatorio } = req.body;

    if (!['pendente', 'em resolução', 'resolvida', 'pausada'].includes(estado)) {
        return res.status(400).json({ error: "Estado inválido" });
    }

    let query;
    let params = [estado];

    if (estado === 'em resolução') {
        query = `UPDATE servicos SET estado = ?, data_hora_inicio = COALESCE(data_hora_inicio, CURRENT_TIMESTAMP) WHERE id = ?`;
        params.push(id);
    } else if (estado === 'resolvida') {
        query = `UPDATE servicos SET estado = ?, data_hora_fim = CURRENT_TIMESTAMP${relatorio ? ', relatorio = ?' : ''} WHERE id = ?`;
        if (relatorio) params.push(relatorio);
        params.push(id);
    } else if (estado === 'pausada') {
        query = `UPDATE servicos SET estado = ?, data_hora_pausa = CURRENT_TIMESTAMP${req.body.motivo_pausa ? ', relatorio = COALESCE(relatorio || \'\n\n\', \'\') || ?' : ''} WHERE id = ?`;
        if (req.body.motivo_pausa) {
            const stamp = `[Serviço Pausado em ${new Date().toLocaleString('pt-PT')}]: ${req.body.motivo_pausa}`;
            params.push(stamp);
        }
        params.push(id);
    } else {
        query = `UPDATE servicos SET estado = ? WHERE id = ?`;
        params.push(id);
    }

    db.run(query, params, function (err) {
        if (err) return handleDBError(res, err);
        securityLog('SERVICE_STATUS_CHANGED', { service_id: id, new_status: estado, user: req.user.id });
        res.json({ message: "Estado atualizado", id, estado });
    });
});

app.put('/api/servicos/:id/arquivar', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE servicos SET arquivada = 1 WHERE id = ?`, [id], (err) => {
        if (err) return handleDBError(res, err);
        res.json({ message: "Serviço arquivado" });
    });
});

app.put('/api/servicos/:id/faturacao', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { estado_faturacao } = req.body;
    db.run(`UPDATE servicos SET estado_faturacao = ? WHERE id = ?`, [estado_faturacao, id], (err) => {
        if (err) return handleDBError(res, err);
        res.json({ message: "Faturação atualizada" });
    });
});

app.get('/api/tecnico/servicos', authenticateJWT, isTecnico, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const techId = req.user.id;
    const query = `
        SELECT s.*, c.nome as cliente_nome,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_pausa) as data_hora_pausa
        FROM servicos s
        JOIN clientes c ON s.cliente_id = c.id
        WHERE s.tecnico_id = ? 
          AND s.estado != 'resolvida' 
          AND s.arquivada = 0
          AND (s.data_agendada IS NULL OR datetime(s.data_agendada) <= datetime('now', 'localtime', '+24 hours'))
        ORDER BY CASE WHEN s.estado = 'pausada' THEN 0 ELSE 1 END, s.data_hora DESC
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/servicos/:id/detalhes-relatorio', authenticateJWT, (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT s.*, 
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_inicio) as data_hora_inicio,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_fim) as data_hora_fim,
               c.nome as cliente_nome, c.telefone as cliente_contato, c.email as cliente_email,
               t.nome as tecnico_nome
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN tecnicos t ON s.tecnico_id = t.id
        WHERE s.id = ?
    `;
    db.get(query, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Serviço não encontrado" });

        // Buscar fotos
        db.all(`SELECT id, caminho FROM fotos_relatorio WHERE servico_id = ?`, [id], (err, fotos) => {
            if (err) return handleDBError(res, err);
            row.fotos = fotos || [];
            res.json(row);
        });
    });
});

app.put('/api/tecnico/servicos/:id/relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const { relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico } = req.body;
    const techId = req.user.id;

    db.get(`SELECT tecnico_id, relatorio_submetido FROM servicos WHERE id = ?`, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Serviço não encontrado" });
        if (row.tecnico_id !== techId) return res.status(403).json({ error: "Acesso negado" });
        if (row.relatorio_submetido === 1) return res.status(400).json({ error: "Relatório já submetido" });

        const horasNum = (horas_trabalho !== null && horas_trabalho !== '') ? parseFloat(String(horas_trabalho).replace(',', '.')) : null;

        db.run(`UPDATE servicos SET relatorio = ?, pecas_substituidas = ?, horas_trabalho = ?, assinatura_cliente = ?, assinatura_tecnico = ? WHERE id = ?`,
            [relatorio, pecas_substituidas, horasNum, assinatura_cliente, assinatura_tecnico, id], (err) => {
                if (err) return handleDBError(res, err);
                res.json({ message: "Rascunho de serviço salvo" });
            });
    });
});

app.post('/api/tecnico/servicos/:id/submeter-relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const techId = req.user.id;

    db.run(`UPDATE servicos SET relatorio_submetido = 1 WHERE id = ? AND tecnico_id = ?`, [id, techId], function (err) {
        if (err) return handleDBError(res, err);
        securityLog('RELATORIO_SERVICO_SUBMETIDO', { service_id: id, tecnico_id: techId });
        res.json({ message: "Relatório submetido" });
    });
});

// --- Upload e Gestão de Fotos ---
app.post('/api/tecnico/upload-fotos', authenticateJWT, isTecnico, upload.array('fotos', 10), (req, res) => {
    const { avaria_id, servico_id } = req.body;
    if (!avaria_id && !servico_id) {
        return res.status(400).json({ error: "ID da avaria ou serviço é obrigatório" });
    }

    const id = avaria_id || servico_id;
    const column = avaria_id ? 'avaria_id' : 'servico_id';

    // Inserir cada foto na base de dados
    const stmt = db.prepare(`INSERT INTO fotos_relatorio (${column}, caminho) VALUES (?, ?)`);
    const paths = [];

    req.files.forEach(file => {
        const caminho = `/uploads/reports/${file.filename}`;
        stmt.run(id, caminho);
        paths.push(caminho);
    });

    stmt.finalize((err) => {
        if (err) return handleDBError(res, err);
        securityLog('PHOTOS_UPLOADED', { id, count: req.files.length, type: avaria_id ? 'avaria' : 'servico' });
        res.json({ message: "Fotos enviadas com sucesso", paths });
    });
});

app.delete('/api/tecnico/fotos/:id', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const techId = req.user.id;

    const checkQuery = `
        SELECT f.caminho, f.avaria_id, f.servico_id, a.tecnico_id as a_tech, s.tecnico_id as s_tech
        FROM fotos_relatorio f
        LEFT JOIN avarias a ON f.avaria_id = a.id
        LEFT JOIN servicos s ON f.servico_id = s.id
        WHERE f.id = ?
    `;

    db.get(checkQuery, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Foto não encontrada" });

        const ownerId = row.a_tech || row.s_tech;
        if (ownerId !== techId) return res.status(403).json({ error: "Acesso negado" });

        db.run(`DELETE FROM fotos_relatorio WHERE id = ?`, [id], function (err) {
            if (err) return handleDBError(res, err);

            // As fotos agora estão na raiz /uploads, não em /public/uploads
            const relativePath = row.caminho.startsWith('/') ? row.caminho.substring(1) : row.caminho;
            const fullPath = path.join(__dirname, relativePath);
            fs.unlink(fullPath, (err) => {
                if (err) console.error("Erro ao apagar ficheiro:", err);
            });

            securityLog('PHOTO_DELETED', { photo_id: id, path: row.caminho });
            res.json({ message: "Foto removida" });
        });
    });
});

app.get('/api/historico/servicos', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT s.*, c.nome as cliente_nome, t.nome as tecnico_nome,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_fim) as data_hora_fim
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN tecnicos t ON s.tecnico_id = t.id
        WHERE s.estado = 'resolvida'
        ORDER BY s.data_hora_fim DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/agendamentos', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT 'avaria' as type, a.id, a.maquina_id, a.tipo_avaria, a.estado, a.notas,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_agendada) as data_agendada,
               COALESCE(m.marca || ' - ' || m.modelo, 'Máquina Removida') as title,
               c.nome as cliente_nome, t.nome as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        LEFT JOIN tecnicos t ON a.tecnico_id = t.id
        WHERE a.data_agendada IS NOT NULL AND a.arquivada = 0
        
        UNION ALL
        
        SELECT 'servico' as type, s.id, NULL as maquina_id, s.tipo_servico as tipo_avaria, s.estado, s.notas,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_agendada) as data_agendada,
               s.tipo_servico || ' (' || s.tipo_camiao || ')' as title,
               c.nome as cliente_nome, t.nome as tecnico_nome
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN tecnicos t ON s.tecnico_id = t.id
        WHERE s.data_agendada IS NOT NULL AND s.arquivada = 0
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/agendamentos', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const query = `
        SELECT 'avaria' as type, a.id, a.maquina_id, a.tipo_avaria, a.estado,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_agendada) as data_agendada,
               COALESCE(m.marca || ' - ' || m.modelo, 'Máquina Removida') as title,
               c.nome as cliente_nome, a.notas
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.data_agendada IS NOT NULL AND a.tecnico_id = ? AND a.estado != 'resolvida' AND a.arquivada = 0
        
        UNION ALL
        
        SELECT 'servico' as type, s.id, NULL as maquina_id, s.tipo_servico as tipo_avaria, s.estado,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_agendada) as data_agendada,
               s.tipo_servico || ' (' || s.tipo_camiao || ')' as title,
               c.nome as cliente_nome, s.notas
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        WHERE s.data_agendada IS NOT NULL AND s.tecnico_id = ? AND s.estado != 'resolvida' AND s.arquivada = 0
        
        ORDER BY data_agendada ASC
    `;
    db.all(query, [techId, techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

// --- TECNICOS ROUTES --- //

// 🔒 SEGURANÇA: Não retornar passwords
app.get('/api/tecnicos', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT id, nome, especialidade, telefone, email FROM tecnicos`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/tecnicos', authenticateJWT, isAdmin, (req, res) => {
    let { nome, especialidade, telefone, email } = req.body;

    // 🔒 SEGURANÇA: Sanitização
    nome = sanitizeString(nome);
    especialidade = sanitizeString(especialidade);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);

    if (!nome || !email) {
        return res.status(400).json({ error: "Nome e Email são obrigatórios" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Formato de email inválido" });
    }

    if (telefone && !/^[0-9]{9}$/.test(telefone)) {
        return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });
    }

    // 🔒 SEGURANÇA: Gerar palavra-passe simples (6 dígitos) pois será alterada
    const generatedPassword = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPwd = bcrypt.hashSync(generatedPassword, 10);

    db.run(`INSERT INTO tecnicos (nome, especialidade, telefone, email, password) VALUES (?, ?, ?, ?, ?)`,
        [nome, especialidade, telefone, email, hashedPwd],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: "Email já está registado" });
                }
                return handleDBError(res, err);
            }
            securityLog('TECNICO_CREATED', { id: this.lastID, nome, email });
            res.status(201).json({
                id: this.lastID,
                nome,
                especialidade,
                telefone,
                email,
                tempPassword: generatedPassword // Retornar a pass temporária para o admin
            });
        });
});

app.put('/api/tecnicos/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { nome, especialidade, telefone, email, password } = req.body;

    // 🔒 SEGURANÇA: Sanitização
    nome = sanitizeString(nome);
    especialidade = sanitizeString(especialidade);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Formato de email inválido" });
    if (telefone && !/^[0-9]{9}$/.test(telefone)) return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });

    if (password) {
        const hashedPwd = bcrypt.hashSync(password, 10);
        db.run(`UPDATE tecnicos SET nome = ?, especialidade = ?, telefone = ?, email = ?, password = ? WHERE id = ?`,
            [nome, especialidade, telefone, email, hashedPwd, id],
            function (err) {
                if (err) return handleDBError(res, err);
                securityLog('TECNICO_UPDATED', { id, nome, email, password_changed: true });
                res.json({ message: "Técnico atualizado", id });
            });
    } else {
        db.run(`UPDATE tecnicos SET nome = ?, especialidade = ?, telefone = ?, email = ? WHERE id = ?`,
            [nome, especialidade, telefone, email, id],
            function (err) {
                if (err) return handleDBError(res, err);
                securityLog('TECNICO_UPDATED', { id, nome, email, password_changed: false });
                res.json({ message: "Técnico atualizado", id });
            });
    }
});

app.delete('/api/tecnicos/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM tecnicos WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        securityLog('TECNICO_DELETED', { id });
        res.json({ message: "Técnico removido" });
    });
});

// --- PORTAL DO TÉCNICO (Protected by JWT) --- //

app.get('/api/tecnico/avarias', authenticateJWT, isTecnico, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const techId = req.user.id;
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_pausa) as data_hora_pausa, 
               a.notas,
               a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               a.assinatura_cliente,
               (m.marca || ' - ' || m.modelo) as maquina_nome, c.nome as cliente_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.tecnico_id = ? 
          AND a.estado != 'resolvida' 
          AND a.arquivada = 0
          AND (a.data_agendada IS NULL OR datetime(a.data_agendada) <= datetime('now', 'localtime', '+24 hours'))
        ORDER BY CASE WHEN a.estado = 'pausada' THEN 0 ELSE 1 END, a.data_hora DESC
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/historico', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_inicio) as data_hora_inicio, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim,
               a.notas, a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               (m.marca || ' - ' || m.modelo) as maquina_nome, m.uuid as maquina_uuid,
               c.nome as cliente_nome, c.id as cliente_id
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.tecnico_id = ? AND a.estado = 'resolvida'
        ORDER BY COALESCE(a.data_hora_fim, a.data_hora) DESC
        LIMIT 50
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/servicos/historico', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const query = `
        SELECT s.*, c.nome as cliente_nome,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_fim) as data_hora_fim
        FROM servicos s
        JOIN clientes c ON s.cliente_id = c.id
        WHERE s.tecnico_id = ? AND s.estado = 'resolvida'
        ORDER BY s.data_hora_fim DESC
        LIMIT 50
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.put('/api/tecnico/password', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) return res.status(400).json({ error: "Preencha a password atual e a nova password" });

    // 🔒 SEGURANÇA: Validar força da nova password
    if (newPassword.length < 8) {
        return res.status(400).json({ error: "Nova password deve ter no mínimo 8 caracteres" });
    }

    db.get('SELECT password FROM tecnicos WHERE id = ?', [techId], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row || !bcrypt.compareSync(oldPassword, row.password)) {
            securityLog('PASSWORD_CHANGE_FAILED', { tecnico_id: techId, reason: 'wrong_old_password' });
            return res.status(401).json({ error: 'Password atual incorreta' });
        }

        const hashedPwd = bcrypt.hashSync(newPassword, 10);
        db.run('UPDATE tecnicos SET password = ? WHERE id = ?', [hashedPwd, techId], function (err) {
            if (err) return handleDBError(res, err);
            securityLog('PASSWORD_CHANGED', { tecnico_id: techId });
            res.json({ message: "Password atualizada com sucesso" });
        });
    });
});

// --- PUBLIC ROUTES (Client mobile) --- //

app.get('/api/public/maquinas/:uuid', (req, res) => {
    const { uuid } = req.params;

    // 🔒 SEGURANÇA: Validar UUID
    if (!isValidUUID(uuid)) {
        return res.status(400).json({ error: "UUID inválido" });
    }

    db.get(`SELECT (marca || ' - ' || modelo) as nome FROM maquinas WHERE uuid = ?`, [uuid], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Máquina não encontrada" });
        res.json(row);
    });
});

app.post('/api/public/avarias', (req, res) => {
    const { maquina_id, tipo_avaria } = req.body;

    if (!maquina_id || !tipo_avaria) {
        return res.status(400).json({ error: "Faltam parâmetros" });
    }

    // 🔒 SEGURANÇA: Validar UUID
    if (!isValidUUID(maquina_id)) {
        return res.status(400).json({ error: "UUID de máquina inválido" });
    }

    // Validar tipo_avaria
    if (!Number.isInteger(tipo_avaria) || tipo_avaria < 1 || tipo_avaria > 10) {
        return res.status(400).json({ error: "Tipo de avaria inválido" });
    }

    db.run(`INSERT INTO avarias (maquina_id, tipo_avaria) VALUES (?, ?)`,
        [maquina_id, tipo_avaria],
        function (err) {
            if (err) return handleDBError(res, err);
            const avariaId = this.lastID;
            securityLog('AVARIA_REPORTED', { id: avariaId, maquina_id, tipo_avaria });

            // Notificar Administradores (apenas se for via QR Code público)
            db.get(`SELECT m.marca, m.modelo, c.nome as cliente_nome 
                   FROM maquinas m JOIN clientes c ON m.cliente_id = c.id 
                   WHERE m.uuid = ?`, [maquina_id], (err, machineInfo) => {
                if (!err && machineInfo) {
                    db.all(`SELECT email FROM administradores WHERE email IS NOT NULL`, [], (err, admins) => {
                        if (!err && admins.length > 0) {
                            const adminEmails = admins.map(a => a.email);
                            const machineLabel = `${machineInfo.marca} ${machineInfo.modelo}`;
                            sendAdminNotificationEmail(adminEmails, machineLabel, machineInfo.cliente_nome, tipo_avaria);
                        }
                    });
                }
            });

            res.status(201).json({ id: avariaId, message: "Avaria reportada" });
        });
});

// --- GESTÃO DE FROTA ROUTES ---

app.get('/api/frota', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT * FROM frota ORDER BY id DESC`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/frota', authenticateJWT, isAdmin, (req, res) => {
    let { marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao } = req.body;

    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    ano = parseInt(ano) || null;
    proxima_revisao_kms = parseInt(proxima_revisao_kms) || null;

    if (!marca || !modelo) return res.status(400).json({ error: "Marca e Modelo são obrigatórios" });

    db.run(`INSERT INTO frota (marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao) VALUES (?, ?, ?, ?, ?, ?)`,
        [marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({ id: this.lastID, marca, modelo, ano });
        });
});

app.put('/api/frota/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao } = req.body;

    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    ano = parseInt(ano) || null;
    proxima_revisao_kms = parseInt(proxima_revisao_kms) || null;

    if (!marca || !modelo) return res.status(400).json({ error: "Marca e Modelo são obrigatórios" });

    db.run(`UPDATE frota SET marca = ?, modelo = ?, ano = ?, data_proxima_inspecao = ?, proxima_revisao_kms = ?, data_ultima_revisao = ? WHERE id = ?`,
        [marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao, id],
        function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Veículo atualizado com sucesso", id, marca, modelo });
        });
});

app.delete('/api/frota/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM frota WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Veículo removido com sucesso", id });
    });
});

// Error Handler Global (Ocultar Stack Traces)
app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err);
    securityLog('UNHANDLED_ERROR', { error: err.message, path: req.path });
    res.status(500).json({ error: "Ocorreu um erro interno no servidor." });
});

app.listen(PORT, () => {
    console.log(`🚀 Maclau SERVER v2.2 SECURE is running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔐 Security: CORS, Helmet, Rate Limiting, JWT Expiration ENABLED`);
    
    // Iniciar verificação de frota
    checkVehicleInspections(); // Corre uma vez no arranque
    scheduleDailyCheck(); // Agenda para correr todos os dias às 08:00
});