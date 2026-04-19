require('dotenv').config();
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
        // Permitir requests sem origin (apps mobile, Postman, etc)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
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
    res.status(500).json({ error: customMsg });
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
                password TEXT NOT NULL
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
                nome TEXT NOT NULL,
                uuid TEXT NOT NULL UNIQUE,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cliente_id) REFERENCES clientes (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS avarias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                maquina_id TEXT NOT NULL, 
                tipo_avaria INTEGER NOT NULL,
                estado TEXT DEFAULT 'pendente',
                tecnico_id INTEGER,
                arquivada INTEGER DEFAULT 0,
                data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
                data_hora_inicio DATETIME,
                data_hora_fim DATETIME,
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

            // Garantir que novas colunas existem se a tabela já foi criada anteriormente
            db.run(`ALTER TABLE avarias ADD COLUMN tecnico_id INTEGER REFERENCES tecnicos(id)`, (err) => { });
            db.run(`ALTER TABLE avarias ADD COLUMN arquivada INTEGER DEFAULT 0`, (err) => { });
            db.run(`ALTER TABLE avarias ADD COLUMN data_hora_inicio DATETIME`, (err) => { });
            db.run(`ALTER TABLE avarias ADD COLUMN data_hora_fim DATETIME`, (err) => { });

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
        });
    }
});

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
    let { nome, telefone, email } = req.body;

    // 🔒 SEGURANÇA: Sanitização
    nome = sanitizeString(nome);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);

    if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Formato de email inválido" });
    if (telefone && !/^[0-9]{9}$/.test(telefone)) return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });

    db.run(`INSERT INTO clientes (nome, telefone, email) VALUES (?, ?, ?)`,
        [nome, telefone, email],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({ id: this.lastID, nome, telefone, email });
        });
});

app.put('/api/clientes/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { nome, telefone, email } = req.body;

    // 🔒 SEGURANÇA: Sanitização
    nome = sanitizeString(nome);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);

    if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Formato de email inválido" });
    if (telefone && !/^[0-9]{9}$/.test(telefone)) return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });

    db.run(`UPDATE clientes SET nome = ?, telefone = ?, email = ? WHERE id = ?`,
        [nome, telefone, email, id],
        function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Cliente atualizado com sucesso", id, nome, telefone, email });
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
        SELECT m.id, m.nome, m.uuid, m.data_criacao, c.nome as cliente_nome, c.id as cliente_id 
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
    const { cliente_id } = req.body;
    let { nome } = req.body;

    nome = sanitizeString(nome);

    if (!cliente_id || !nome) return res.status(400).json({ error: "Cliente e Nome são obrigatórios" });

    const uuid = crypto.randomUUID();

    db.run(`INSERT INTO maquinas (cliente_id, nome, uuid) VALUES (?, ?, ?)`,
        [cliente_id, nome, uuid],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({ id: this.lastID, cliente_id, nome, uuid });
        });
});

app.put('/api/maquinas/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { cliente_id } = req.body;
    let { nome } = req.body;

    nome = sanitizeString(nome);

    if (!cliente_id || !nome) return res.status(400).json({ error: "Cliente e Nome são obrigatórios" });

    db.run(`UPDATE maquinas SET cliente_id = ?, nome = ? WHERE id = ?`,
        [cliente_id, nome, id],
        function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Máquina atualizada com sucesso", id, cliente_id, nome });
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
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
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
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
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
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.data_hora, a.data_hora_fim, a.tecnico_id,
               m.nome as maquina_nome, c.nome as cliente_nome, t.nome as tecnico_nome
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
    db.get(`SELECT id FROM tecnicos WHERE id = ?`, [tecnico_id], (err, tecnico) => {
        if (err) return handleDBError(res, err);
        if (!tecnico) return res.status(404).json({ error: "Técnico não encontrado" });

        db.run(`UPDATE avarias SET tecnico_id = ? WHERE id = ?`, [tecnico_id, id], function (err) {
            if (err) return handleDBError(res, err);
            securityLog('AVARIA_ATRIBUIDA', { avaria_id: id, tecnico_id });
            res.json({ message: "Técnico atribuído com sucesso", id, tecnico_id });
        });
    });
});

app.put('/api/avarias/:id/status', authenticateJWT, isAdminOrTecnico, (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    if (!['pendente', 'em resolução', 'resolvida'].includes(estado)) {
        return res.status(400).json({ error: "Estado inválido" });
    }

    let query = `UPDATE avarias SET estado = ? WHERE id = ?`;
    if (estado === 'em resolução') {
        query = `UPDATE avarias SET estado = ?, data_hora_inicio = COALESCE(data_hora_inicio, CURRENT_TIMESTAMP) WHERE id = ?`;
    } else if (estado === 'resolvida') {
        query = `UPDATE avarias SET estado = ?, data_hora_fim = CURRENT_TIMESTAMP WHERE id = ?`;
    }

    db.run(query, [estado, id], function (err) {
        if (err) return handleDBError(res, err);
        securityLog('AVARIA_STATUS_CHANGED', { avaria_id: id, new_status: estado, user: req.user.id });
        res.json({ message: "Estado atualizado com sucesso", id, estado });
    });
});

app.get('/api/estatisticas/avarias', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT a.id, a.tipo_avaria, a.data_hora_fim, a.tecnico_id, t.nome as tecnico_nome
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
        SELECT a.id, a.tipo_avaria, a.estado, a.data_hora, a.data_hora_inicio, a.data_hora_fim, a.tecnico_id,
               m.nome as maquina_nome, m.uuid as maquina_uuid, m.cliente_id,
               c.nome as cliente_nome, t.nome as tecnico_nome
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

    // 🔒 SEGURANÇA: Gerar palavra-passe forte (12 caracteres)
    const generatedPassword = crypto.randomBytes(8).toString('hex'); // 16 chars hex
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
    const techId = req.user.id;
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.data_hora,
               m.nome as maquina_nome, c.nome as cliente_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.tecnico_id = ? AND a.estado != 'resolvida' AND a.arquivada = 0
        ORDER BY a.data_hora DESC
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/historico', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.data_hora, a.data_hora_inicio, a.data_hora_fim,
               m.nome as maquina_nome, c.nome as cliente_nome
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

    db.get(`SELECT nome FROM maquinas WHERE uuid = ?`, [uuid], (err, row) => {
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
            securityLog('AVARIA_REPORTED', { id: this.lastID, maquina_id, tipo_avaria });
            res.status(201).json({ id: this.lastID, message: "Avaria reportada" });
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
});