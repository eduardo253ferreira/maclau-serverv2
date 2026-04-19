// public/js/tecnico.js

const API_BASE = '/api';

// Prioridade: URL Params (?id=X&name=Y) > localStorage
const urlParams = new URLSearchParams(window.location.search);
let currentTechId = urlParams.get('id') || localStorage.getItem('maclau_tech_id');
let currentTechName = urlParams.get('name') || localStorage.getItem('maclau_tech_name');

// Save to localStorage if came from URL
if (urlParams.get('id')) localStorage.setItem('maclau_tech_id', currentTechId);
if (urlParams.get('name')) localStorage.setItem('maclau_tech_name', currentTechName);

let jwtToken = localStorage.getItem('maclau_token');

function showNotification(msg, isError = false) {
    const notif = document.getElementById('notification');
    if (!notif) return;
    notif.textContent = msg;
    notif.className = `notification ${isError ? 'error' : ''}`;
    notif.classList.remove('hidden');
    setTimeout(() => notif.classList.add('hidden'), 3000);
}

function escapeHTML(str) {
    if (!str) return '';
    const p = document.createElement('p');
    p.textContent = str;
    return p.innerHTML;
}

// Fake auth removed

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { console.error("Erro ao limpar sessão no servidor", e); }

    localStorage.removeItem('maclau_tech_id');
    localStorage.removeItem('maclau_tech_name');
    localStorage.removeItem('maclau_token');
    localStorage.removeItem('maclau_role');
    window.location.href = 'index.html';
}

async function showView() {
    if (!jwtToken) {
        window.location.href = 'index.html?expired=1';
        return;
    }

    if (!currentTechId) {
        // Fallback: se não tiver Id, talvez não seja um técnico
        window.location.href = 'index.html?expired=1';
        return;
    }

    document.getElementById('tech-name-display').textContent = `Olá, ${currentTechName || 'Técnico'}!`;
    loadMyTasks();
}

async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${jwtToken}`;
    return fetch(url, options);
}

async function loadMyTasks() {
    try {
        const res = await authFetch(`${API_BASE}/tecnico/avarias`);
        const tasks = await res.json();
        const container = document.getElementById('repairs-container');
        const stats = document.getElementById('tech-stats');
        
        stats.textContent = tasks.length === 1 ? "Tem 1 avaria pendente." : `Tem ${tasks.length} avarias pendentes.`;
        container.innerHTML = '';
        
        if (tasks.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:20px;">Não tem avarias pendentes. Bom trabalho!</p>';
            return;
        }

        tasks.forEach(task => {
            const div = document.createElement('div');
            div.className = 'repair-item';
            
            let tipoStr = task.tipo_avaria === 1 ? 'ELÉTRICA' : (task.tipo_avaria === 3 ? 'MECÂNICA' : 'DESCONHECIDA');
            let statusLabel = task.estado === 'pendente' ? 'Aguardando Início' : 'Em Resolução';
            let statusColor = task.estado === 'pendente' ? 'var(--danger)' : 'var(--warning)';

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                    <span style="font-size:11px; font-weight:700; background:var(--accent-light); color:var(--accent); padding:3px 8px; border-radius:4px;">${tipoStr}</span>
                    <span style="font-size:12px; font-weight:700; color:${statusColor};">${statusLabel}</span>
                </div>
                <h3 class="task-machine-name" style="margin-bottom:5px;"></h3>
                <p class="task-client-name" style="font-size:14px; color:var(--text-secondary);"></p>
                <div style="font-size:12px; color:var(--text-secondary); margin-top:10px;">Reportada em: ${new Date(task.data_hora).toLocaleString('pt-PT')}</div>
                
                <div class="repair-actions">
                </div>
            `;

            div.querySelector('.task-machine-name').textContent = task.maquina_nome;
            div.querySelector('.task-client-name').textContent = task.cliente_nome;

            const actionsDiv = div.querySelector('.repair-actions');
            const btn = document.createElement('button');
            btn.className = 'btn-status ' + (task.estado === 'pendente' ? 'btn-resolucao' : 'btn-resolvida');
            btn.textContent = task.estado === 'pendente' ? 'Começar Reparação' : 'Marcar como Resolvida';
            btn.onclick = () => updateStatus(task.id, task.estado === 'pendente' ? 'em resolução' : 'resolvida');
            actionsDiv.appendChild(btn);

            container.appendChild(div);
        });
    } catch (e) {
        showNotification("Erro ao carregar tarefas.", true);
    }
}

async function updateStatus(id, newStatus) {
    try {
        const res = await authFetch(`${API_BASE}/avarias/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: newStatus })
        });
        
        if (res.ok) {
            showNotification(newStatus === 'resolvida' ? "Bom trabalho! Avaria resolvida." : "Reparação iniciada!");
            loadMyTasks();
        } else {
            throw new Error("Erro ao atualizar estado.");
        }
    } catch (e) {
        showNotification(e.message, true);
    }
}

function formatTimeDifference(startStr, endStr) {
    if (!startStr || !endStr) return 'Desconhecido';
    const start = new Date(startStr);
    const end = new Date(endStr);
    const diffMs = end - start;
    if (diffMs < 0) return 'Desconhecido';

    const diffMins = Math.floor(diffMs / 60000);
    const totalHours = Math.floor(diffMins / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const mins = diffMins % 60;

    let res = [];
    if (days > 0) res.push(`${days}d`);
    if (hours > 0) res.push(`${hours}h`);
    if (mins > 0) res.push(`${mins}m`);
    if (res.length === 0) return '< 1m';
    return res.join(' ');
}

let historicoData = [];

async function loadHistorico() {
    try {
        const res = await authFetch(`${API_BASE}/tecnico/historico`);
        historicoData = await res.json();
        
        const uniqueClients = [...new Set(historicoData.map(a => a.cliente_nome))].filter(Boolean).sort();
        const filterSelect = document.getElementById('filter-hist-cliente');
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">Todos / Pesquisar Cliente</option>';
            uniqueClients.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                filterSelect.appendChild(opt);
            });
        }
        
        renderHistorico();
    } catch(e) {
        showNotification("Erro ao carregar histórico", true);
    }
}

window.renderHistorico = function() {
    const tbody = document.getElementById('table-historico-body');
    if(!tbody) return;
    tbody.innerHTML = '';

    const filter = document.getElementById('filter-hist-cliente')?.value;
    
    let filteredData = historicoData;
    if (filter) {
        filteredData = historicoData.filter(a => a.cliente_nome === filter);
    }

    filteredData.forEach(a => {
        const timeSpent = formatTimeDifference(a.data_hora_inicio, a.data_hora_fim);
        const dateStr = a.data_hora_fim ? new Date(a.data_hora_fim).toLocaleString('pt-PT') : new Date(a.data_hora).toLocaleString('pt-PT');
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td class="col-client"></td>
            <td class="col-machine"></td>
            <td>${timeSpent}</td>
        `;
        tr.querySelector('.col-client').textContent = a.cliente_nome;
        tr.querySelector('.col-machine').textContent = a.maquina_nome;
        
        tbody.appendChild(tr);
    });
};

// Nav Switch
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        
        const target = e.target.getAttribute('data-target');
        const view = document.getElementById(`view-${target}`);
        if(view) view.classList.remove('hidden');

        if (target === 'dashboard') loadMyTasks();
        if (target === 'historico') loadHistorico();
    });
});

// Password Change Form
const pwdForm = document.getElementById('form-change-password');
if (pwdForm) {
    pwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPassword = document.getElementById('pwd-old').value;
        const newPassword = document.getElementById('pwd-new').value;
        const confirmPwd = document.getElementById('pwd-confirm').value;

        if (newPassword !== confirmPwd) {
            showNotification("As novas passwords não coincidem", true);
            return;
        }

        try {
            const res = await authFetch(`${API_BASE}/tecnico/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro ao atualizar");

            showNotification("Password atualizada com sucesso!");
            pwdForm.reset();
        } catch (err) {
            showNotification(err.message, true);
        }
    });
}

// Iniciar
window.onload = () => {
    showView();

    // CSP Listeners
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    const histFilter = document.getElementById('filter-hist-cliente');
    if (histFilter) histFilter.addEventListener('change', renderHistorico);
};
