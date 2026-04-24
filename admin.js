// public/js/admin.js

const API_BASE = '/api';
let jwtToken = localStorage.getItem('maclau_token');
let currentActiveView = 'dashboard';
let currentMainDashboard = 'avarias'; // 'avarias' ou 'servicos'
let refreshIntervalId = null;
let lastRefreshTime = new Date();

// Funções Utilitárias
function showNotification(msg, isError = false) {
    const notif = document.getElementById('notification');
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

function updateRefreshStatus() {
    const statusEl = document.getElementById('refresh-status');
    if (!statusEl) return;

    lastRefreshTime = new Date();
    const timeStr = lastRefreshTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    statusEl.innerHTML = `
        <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%;"></span>
        Sincronizado às ${timeStr}
    `;
}

function startAutoRefresh() {
    refreshIntervalId = setInterval(() => {
        // Não fazer refresh se houver modais abertos
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        if (openModals.length > 0) return;

        if (currentActiveView === 'dashboard') {
            if (currentMainDashboard === 'avarias') {
                loadAvarias();
            } else {
                loadServicos();
            }
            updateRefreshStatus();
        }
    }, 30000); // 30 segundos
}

// --- Funções de Gestão (Globais para onclick) ---
async function arquivarAvaria(id, event) {
    console.log("arquivarAvaria triggered for ID:", id);
    if (event) event.stopPropagation();
    if (!confirm('Deseja limpar esta avaria resolvida do dashboard? Ela continuará registada na base de dados.')) return;
    try {
        await apiFetch(`/avarias/${id}/arquivar`, { method: 'PUT' });
        loadAvarias();
    } catch (e) { showNotification(e.message, true); }
}

async function deleteCliente(id) {
    console.log("deleteCliente triggered for ID:", id);
    if (!confirm('Tem a certeza que deseja remover este cliente?')) return;
    try {
        await apiFetch(`/clientes/${id}`, { method: 'DELETE' });
        showNotification('Cliente removido.');
        loadClientes();
    } catch (e) { showNotification(e.message, true); }
}

async function deleteMaquina(id) {
    console.log("deleteMaquina triggered for ID:", id);
    if (!confirm('Tem a certeza que deseja remover esta máquina?')) return;
    try {
        await apiFetch(`/maquinas/${id}`, { method: 'DELETE' });
        showNotification('Máquina removida.');
        loadMaquinas();
    } catch (e) { showNotification(e.message, true); }
}

async function deleteTecnico(id) {
    console.log("deleteTecnico triggered for ID:", id);
    if (!confirm('Tem a certeza que deseja remover este técnico?')) return;
    try {
        await apiFetch(`/tecnicos/${id}`, { method: 'DELETE' });
        showNotification('Técnico removido.');
        loadTecnicos();
    } catch (e) { showNotification(e.message, true); }
}


// Autenticação inicial
async function ensureAuth() {
    if (!jwtToken) {
        window.location.href = 'index.html?expired=1';
    } else {
        const role = localStorage.getItem('maclau_role');
        if (role !== 'admin') {
            alert('Acesso restrito a administradores.');
            localStorage.removeItem('maclau_token');
            localStorage.removeItem('maclau_role');
            window.location.href = 'index.html?expired=1';
        }
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { console.error("Erro ao limpar sessão no servidor", e); }

    localStorage.removeItem('maclau_token');
    localStorage.removeItem('maclau_role');
    window.location.href = 'index.html';
}

// Fetch helper with auth
async function apiFetch(endpoint, options = {}) {
    if (!options.headers) options.headers = {};
    if (jwtToken) options.headers['Authorization'] = `Bearer ${jwtToken}`;

    const res = await fetch(`${API_BASE}${endpoint}`, options);
    // Se o token expirar, limpa e força reload
    if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('maclau_token');
        jwtToken = null;
        await ensureAuth();
        return apiFetch(endpoint, options); // tenta de novo
    }

    if (!res.ok) {
        let errStr = "Erro no servidor";
        try { const d = await res.json(); errStr = d.error || errStr; } catch (e) { }
        throw new Error(errStr);
    }
    return res.json();
}

// --- Navegação ---
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.currentTarget.getAttribute('data-target');
        if (!target) return;

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        currentActiveView = target;
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        const viewEl = document.getElementById(`view-${target}`);
        if (viewEl) viewEl.classList.remove('hidden');

        if (target === 'dashboard') {
            if (currentMainDashboard === 'avarias') loadAvarias();
            else loadServicos();
            updateRefreshStatus();
            startAutoRefresh();
        } else {
            if (refreshIntervalId) clearInterval(refreshIntervalId);
        }

        if (target === 'historico') {
            loadHistoricoMaquinas();
            loadHistorico();
        }
        if (target === 'estatisticas') loadEstatisticas();
        if (target === 'clientes') loadClientes();
        if (target === 'maquinas') loadMaquinas();
        if (target === 'tecnicos') loadTecnicos();
    });
});

// Dashboard Toggle Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.toggle-btn-main').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filter = e.currentTarget.getAttribute('data-main-filter');
            if (!filter) return;

            document.querySelectorAll('.toggle-btn-main').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentMainDashboard = filter;

            if (filter === 'avarias') {
                document.getElementById('wrapper-board-avarias').classList.remove('hidden');
                document.getElementById('wrapper-board-servicos').classList.add('hidden');
                loadAvarias();
            } else {
                document.getElementById('wrapper-board-avarias').classList.add('hidden');
                document.getElementById('wrapper-board-servicos').classList.remove('hidden');
                loadServicos();
            }
            updateRefreshStatus();
        });
    });
});

// --- Modals ---
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openFullNoteModal(note) {
    document.getElementById('full-note-content').textContent = note;
    openModal('modal-view-note');
}

// --- Dashboard (Avarias) ---
async function loadAvarias() {
    try {
        const avarias = await apiFetch('/avarias');
        const colPendente = document.querySelector('#col-pendente .cards-wrapper');
        const colResolucao = document.querySelector('#col-resolucao .cards-wrapper');
        const colResolvida = document.querySelector('#col-resolvida .cards-wrapper');

        colPendente.innerHTML = '';
        colResolucao.innerHTML = '';
        colResolvida.innerHTML = '';

        const dateStart = document.getElementById('filter-date-start').value;
        const dateEnd = document.getElementById('filter-date-end').value;
        const techFilter = document.getElementById('filter-tech-dashboard').value;

        avarias.forEach(a => {
            // Apply Tech Filter to all columns
            if (techFilter && a.tecnico_id != techFilter) return;

            const card = document.createElement('div');
            card.className = 'avaria-card';

            // 1: Eletrica, 2: Desconhecida, 3: Mecanica
            let tipoStr = a.tipo_avaria === 1 ? 'ELÉTRICA' : (a.tipo_avaria === 3 ? 'MECÂNICA' : 'DESCONHECIDA');

            let tagHTML = `<div class="card-type">${tipoStr}</div>`;
            if (a.estado === 'pausada') {
                tagHTML += ` <div class="card-type" style="background:#fef08a; color:#854d0e; margin-left:5px;"><i class="ph ph-pause"></i> PAUSADA</div>`;
            }

            card.innerHTML = `
                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;">${tagHTML}</div>
                <h4 class="card-machine-name"></h4>
                <p class="card-client-name"></p>
                <div class="assigned-tech" style="margin-top:10px; font-size:13px; font-weight:600; color:var(--accent);">
                    <span style="color:var(--text-secondary); font-weight:400;">Técnico:</span> <span class="card-tech-name"></span>
                </div>
                <div class="date">${new Date(a.data_hora).toLocaleString('pt-PT')}</div>
                ${a.notas ? `<div class="card-notes" title="Clique para ver nota completa"><strong>Notas:</strong><br>${escapeHTML(a.notas)}</div>` : ''}
            `;

            if (a.notas) {
                const notesEl = card.querySelector('.card-notes');
                notesEl.onclick = (e) => {
                    e.stopPropagation();
                    openFullNoteModal(a.notas);
                };
            }

            // Preencher dados com segurança
            card.querySelector('.card-machine-name').textContent = a.maquina_nome || 'Máquina Removida';
            card.querySelector('.card-client-name').textContent = a.cliente_nome || 'Sem Cliente';
            card.querySelector('.card-tech-name').textContent = a.tecnico_nome || 'Não Atribuído';

            if (a.estado === 'resolvida') {
                const btnArchive = document.createElement('button');
                btnArchive.className = 'btn-archive';
                btnArchive.title = 'Limpar do dashboard';
                btnArchive.innerHTML = '<i class="ph ph-x"></i>';
                btnArchive.onclick = (e) => arquivarAvaria(a.id, e);
                card.appendChild(btnArchive);
            }

            // Clicar para atribuir (apenas se estiver pendente ou pausada)
            if (a.estado === 'pendente' || a.estado === 'pausada') {
                card.onclick = () => {
                    document.getElementById('atribuir-avaria-id').value = a.id;
                    document.getElementById('atribuir-tecnico-select').value = a.tecnico_id || '';
                    openModal('modal-atribuir-tecnico');
                };
            } else {
                card.style.cursor = 'default';
            }

            if (a.estado === 'pendente' || a.estado === 'pausada') colPendente.appendChild(card);
            else if (a.estado === 'em resolução') colResolucao.appendChild(card);
            else {
                // Resolvidas - Apply Data Range Filter
                let addCard = true;
                const dateRef = new Date(a.data_hora_fim || a.data_hora).toISOString().split('T')[0];

                if (dateStart && dateRef < dateStart) {
                    addCard = false;
                }
                if (dateEnd && dateRef > dateEnd) {
                    addCard = false;
                }
                if (addCard) colResolvida.appendChild(card);
            }
        });

    } catch (e) {
        showNotification(e.message, true);
    }
}

document.getElementById('form-atribuir-tecnico').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('atribuir-avaria-id').value;
    const tecnico_id = document.getElementById('atribuir-tecnico-select').value;

    try {
        const modal = document.getElementById('modal-atribuir-tecnico');
        const type = modal.dataset.type || 'avaria';
        const endpoint = type === 'servico' ? `/servicos/${id}/atribuir` : `/avarias/${id}/atribuir`;

        await apiFetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tecnico_id })
        });
        showNotification('Técnico atribuído!');
        closeModal('modal-atribuir-tecnico');
        if (type === 'servico') loadServicos(); else loadAvarias();
        modal.dataset.type = '';
    } catch (e) {
        showNotification(e.message, true);
    }
});

document.getElementById('form-status-avaria').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('status-avaria-id').value;
    const estado = document.getElementById('status-avaria-select').value;

    try {
        await apiFetch(`/avarias/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado })
        });
        showNotification('Estado atualizado!');
        closeModal('modal-status-avaria');
        loadAvarias(); // refresh
    } catch (e) {
        showNotification(e.message, true);
    }
});

// --- Clientes ---
async function loadClientes() {
    try {
        const clientes = await apiFetch('/clientes');
        const tbody = document.getElementById('table-clientes-body');
        tbody.innerHTML = '';

        // Popula Tabela
        clientes.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-id"></td>
                <td class="col-nome"></td>
                <td class="col-tel"></td>
                <td class="col-email"></td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-view-maquinas" title="Ver Máquinas do Cliente">
                            <i class="ph ph-washing-machine"></i>
                        </button>
                        <button class="btn-icon btn-edit" title="Editar">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon delete btn-delete" title="Apagar">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tr.querySelector('.col-id').textContent = c.id;
            tr.querySelector('.col-nome').textContent = c.nome;
            tr.querySelector('.col-tel').textContent = c.telefone || '-';
            tr.querySelector('.col-email').textContent = c.email || '-';

            tr.querySelector('.btn-view-maquinas').onclick = () => {
                const maquinasTabBtn = document.querySelector('.nav-btn[data-target="maquinas"]');
                if (maquinasTabBtn) maquinasTabBtn.click();
                const filterMaquinas = document.getElementById('filter-cliente-maquinas');
                if (filterMaquinas) {
                    filterMaquinas.value = c.id;
                    loadMaquinas();
                }
            };
            tr.querySelector('.btn-edit').onclick = () => openEditClientModal(c.id, c.nome, c.telefone, c.email);
            tr.querySelector('.btn-delete').onclick = () => deleteCliente(c.id);

            tbody.appendChild(tr);
        });

        // Popula Select de Clientes nas Abas: Máquinas e Histórico
        const selects = [
            document.getElementById('maquina-cliente_id'),
            document.getElementById('edit-maquina-cliente_id'),
            document.getElementById('hist-cliente'),
            document.getElementById('filter-cliente-maquinas'),
            document.getElementById('report-avaria-cliente'),
            document.getElementById('report-servico-cliente')
        ];

        selects.forEach(select => {
            if (!select) return;
            select.innerHTML = '<option value="">Todos / Selecione o Cliente</option>';
            clientes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.nome;
                select.appendChild(opt);
            });
        });

    } catch (e) {
        showNotification(e.message, true);
    }
}

function openEditClientModal(id, nome, telefone, email) {
    document.getElementById('edit-client-id').value = id;
    document.getElementById('edit-client-nome').value = nome;
    document.getElementById('edit-client-telefone').value = telefone || '';
    document.getElementById('edit-client-email').value = email || '';
    openModal('modal-edit-client');
}

document.getElementById('form-edit-client').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-client-id').value;
    const nome = document.getElementById('edit-client-nome').value;
    const telefone = document.getElementById('edit-client-telefone').value;
    const email = document.getElementById('edit-client-email').value;

    try {
        await apiFetch(`/clientes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, telefone, email })
        });
        showNotification('Cliente atualizado com sucesso!');
        closeModal('modal-edit-client');
        loadClientes();
        loadMaquinas(); // Caso o nome do cliente tenha mudado na tabela de máquinas
    } catch (e) {
        showNotification(e.message, true);
    }
});

document.getElementById('form-add-client').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('client-nome').value;
    const telefone = document.getElementById('client-telefone').value;
    const email = document.getElementById('client-email').value;

    try {
        await apiFetch('/clientes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, telefone, email })
        });
        showNotification('Cliente adicionado com sucesso!');
        closeModal('modal-add-client');
        document.getElementById('form-add-client').reset();
        loadClientes();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// --- Máquinas ---
async function loadMaquinas() {
    try {
        const maquinas = await apiFetch('/maquinas');
        const tbody = document.getElementById('table-maquinas-body');
        tbody.innerHTML = '';

        const clienteFilter = document.getElementById('filter-cliente-maquinas')?.value;

        maquinas.forEach(m => {
            if (clienteFilter && m.cliente_id != clienteFilter) return;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-id"></td>
                <td class="col-maquina"></td>
                <td class="col-serie"></td>
                <td class="col-cliente"></td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-info" title="Ver Info">
                            <i class="ph ph-info"></i>
                        </button>
                        <button class="btn-icon btn-qr" title="Gerar QR Code">
                            <i class="ph ph-qr-code"></i>
                        </button>
                        <button class="btn-icon btn-edit" title="Editar">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon delete btn-delete" title="Apagar">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            const maquinaNome = (m.marca || '') + ((m.marca && m.modelo) ? ' - ' : '') + (m.modelo || '');
            tr.querySelector('.col-id').textContent = m.id;
            tr.querySelector('.col-maquina').textContent = maquinaNome || '-';
            tr.querySelector('.col-serie').textContent = m.numero_serie || '-';
            tr.querySelector('.col-cliente').textContent = m.cliente_nome || '-';

            tr.querySelector('.btn-info').onclick = () => openViewMaquinaModal(m);
            tr.querySelector('.btn-qr').onclick = () => generateQR(m.uuid, m.cliente_nome, maquinaNome);
            tr.querySelector('.btn-edit').onclick = () => openEditMaquinaModal(m);
            tr.querySelector('.btn-delete').onclick = () => deleteMaquina(m.id);

            tbody.appendChild(tr);
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

function openViewMaquinaModal(m) {
    document.getElementById('view-maquina-cliente').textContent = m.cliente_nome || 'N/A';
    document.getElementById('view-maquina-marca').textContent = m.marca || 'N/A';
    document.getElementById('view-maquina-modelo').textContent = m.modelo || 'N/A';
    document.getElementById('view-maquina-serie').textContent = m.numero_serie || 'N/A';
    document.getElementById('view-maquina-instalacao').textContent = m.data_instalacao || 'N/A';
    document.getElementById('view-maquina-iniciogarantia').textContent = m.data_inicio_garantia || 'N/A';
    document.getElementById('view-maquina-fimgarantia').textContent = m.data_fim_garantia || 'N/A';
    openModal('modal-view-maquina');
}

function openEditMaquinaModal(m) {
    document.getElementById('edit-maquina-id').value = m.id;
    document.getElementById('edit-maquina-cliente_id').value = m.cliente_id;
    document.getElementById('edit-maquina-marca').value = m.marca || '';
    document.getElementById('edit-maquina-modelo').value = m.modelo || '';
    document.getElementById('edit-maquina-numero-serie').value = m.numero_serie || '';
    document.getElementById('edit-maquina-data-instalacao').value = m.data_instalacao || '';
    document.getElementById('edit-maquina-data-inicio-garantia').value = m.data_inicio_garantia || '';
    document.getElementById('edit-maquina-data-fim-garantia').value = m.data_fim_garantia || '';
    openModal('modal-edit-maquina');
}

document.getElementById('form-edit-maquina').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-maquina-id').value;
    const cliente_id = document.getElementById('edit-maquina-cliente_id').value;

    const payload = {
        cliente_id,
        marca: document.getElementById('edit-maquina-marca').value,
        modelo: document.getElementById('edit-maquina-modelo').value,
        numero_serie: document.getElementById('edit-maquina-numero-serie').value,
        data_instalacao: document.getElementById('edit-maquina-data-instalacao').value,
        data_inicio_garantia: document.getElementById('edit-maquina-data-inicio-garantia').value,
        data_fim_garantia: document.getElementById('edit-maquina-data-fim-garantia').value
    };

    try {
        await apiFetch(`/maquinas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showNotification('Máquina atualizada com sucesso!');
        closeModal('modal-edit-maquina');
        loadMaquinas();
    } catch (e) {
        showNotification(e.message, true);
    }
});

document.getElementById('form-add-maquina').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cliente_id = document.getElementById('maquina-cliente_id').value;

    const payload = {
        cliente_id,
        marca: document.getElementById('maquina-marca').value,
        modelo: document.getElementById('maquina-modelo').value,
        numero_serie: document.getElementById('maquina-numero-serie').value,
        data_instalacao: document.getElementById('maquina-data-instalacao').value,
        data_inicio_garantia: document.getElementById('maquina-data-inicio-garantia').value,
        data_fim_garantia: document.getElementById('maquina-data-fim-garantia').value
    };

    try {
        await apiFetch('/maquinas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showNotification('Máquina adicionada com sucesso!');
        closeModal('modal-add-maquina');
        document.getElementById('form-add-maquina').reset();
        loadMaquinas();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// QR Code
async function generateQR(uuid, clienteNome, maquinaNome) {
    try {
        const res = await apiFetch(`/maquinas/${uuid}/qrcode`);
        const container = document.getElementById('qrcode-image-container');
        document.getElementById('print-client-name').textContent = clienteNome || '';
        document.getElementById('print-machine-name').textContent = maquinaNome || '';
        container.innerHTML = `<img src="${res.qrCode}" alt="QR Code" style="width:200px; height:200px;">
                               <p style="margin-top:10px; font-size:12px; word-break: break-all;">${res.url}</p>`;
        openModal('modal-qrcode');
    } catch (e) {
        showNotification(e.message, true);
    }
}

// --- Técnicos ---
async function loadTecnicos() {
    try {
        const tecnicos = await apiFetch('/tecnicos');
        const tbody = document.getElementById('table-tecnicos-body');
        tbody.innerHTML = '';

        tecnicos.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-id"></td>
                <td class="col-nome"></td>
                <td class="col-esp"></td>
                <td class="col-contato"></td>

                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-edit" title="Editar">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon delete btn-delete" title="Apagar">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tr.querySelector('.col-id').textContent = t.id;
            tr.querySelector('.col-nome').textContent = t.nome;
            tr.querySelector('.col-esp').textContent = t.especialidade || '-';
            tr.querySelector('.col-contato').textContent = `${t.telefone || '-'} / ${t.email || '-'}`;

            tr.querySelector('.btn-edit').onclick = () => openEditTecnicoModal(t.id, t.nome, t.especialidade, t.telefone, t.email);
            tr.querySelector('.btn-delete').onclick = () => deleteTecnico(t.id);

            tbody.appendChild(tr);
        });

        // Popula select de atribuição e filtros
        const selectAtribuir = document.getElementById('atribuir-tecnico-select');
        const filterDash = document.getElementById('filter-tech-dashboard');
        const statsTech = document.getElementById('stats-tecnico');
        const histTech = document.getElementById('hist-tecnico');
        const reportTech = document.getElementById('report-avaria-tecnico');
        const reportServicoTech = document.getElementById('report-servico-tecnico');

        selectAtribuir.innerHTML = '<option value="">-- Selecionar Técnico --</option>';
        if (filterDash) filterDash.innerHTML = '<option value="">Todos</option>';
        if (statsTech) statsTech.innerHTML = '<option value="">Todos</option>';
        if (histTech) histTech.innerHTML = '<option value="">Todos</option>';
        if (reportTech) reportTech.innerHTML = '<option value="">-- Não Atribuir Agora --</option>';
        if (reportServicoTech) reportServicoTech.innerHTML = '<option value="">-- Não Atribuir Agora --</option>';

        tecnicos.forEach(t => {
            const safeName = escapeHTML(t.nome);
            selectAtribuir.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeName}</option>`);
            if (filterDash) filterDash.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeName}</option>`);
            if (statsTech) statsTech.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeName}</option>`);
            if (histTech) histTech.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeName}</option>`);
            if (reportTech) reportTech.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeName}</option>`);
            if (reportServicoTech) reportServicoTech.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeName}</option>`);
        });

    } catch (e) {
        showNotification(e.message, true);
    }
}

function openEditTecnicoModal(id, nome, especialidade, telefone, email) {
    document.getElementById('edit-tecnico-id').value = id;
    document.getElementById('edit-tecnico-nome').value = nome;
    document.getElementById('edit-tecnico-especialidade').value = especialidade || '';
    document.getElementById('edit-tecnico-telefone').value = telefone || '';
    document.getElementById('edit-tecnico-email').value = email || '';
    document.getElementById('edit-tecnico-password').value = '';
    openModal('modal-edit-tecnico');
}

document.getElementById('form-add-tecnico').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        nome: document.getElementById('tecnico-nome').value,
        especialidade: document.getElementById('tecnico-especialidade').value,
        telefone: document.getElementById('tecnico-telefone').value,
        email: document.getElementById('tecnico-email').value,
        // password removido pois é gerado no server
    };

    try {
        const responseData = await apiFetch('/tecnicos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        // Mostrar Modal de sucesso com a password gerada
        document.getElementById('display-temp-password').textContent = responseData.tempPassword;
        openModal('modal-tech-success');

        closeModal('modal-add-tecnico');
        document.getElementById('form-add-tecnico').reset();
        loadTecnicos();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// Listener para copiar password
const btnCopyPwd = document.getElementById('btn-copy-password');
if (btnCopyPwd) {
    btnCopyPwd.addEventListener('click', () => {
        const pwd = document.getElementById('display-temp-password').textContent;
        navigator.clipboard.writeText(pwd).then(() => {
            const icon = btnCopyPwd.querySelector('i');
            icon.className = 'ph ph-check';
            showNotification('Password copiada para a área de transferência!');
            setTimeout(() => {
                icon.className = 'ph ph-copy';
            }, 2000);
        }).catch(err => {
            showNotification('Erro ao copiar password', true);
        });
    });
}

// Fechar modal de sucesso do técnico
const btnTechSuccessOk = document.getElementById('btn-tech-success-ok');
if (btnTechSuccessOk) {
    btnTechSuccessOk.addEventListener('click', () => {
        closeModal('modal-tech-success');
    });
}

document.getElementById('form-edit-tecnico').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-tecnico-id').value;
    const data = {
        nome: document.getElementById('edit-tecnico-nome').value,
        especialidade: document.getElementById('edit-tecnico-especialidade').value,
        telefone: document.getElementById('edit-tecnico-telefone').value,
        email: document.getElementById('edit-tecnico-email').value,
        password: document.getElementById('edit-tecnico-password').value
    };

    try {
        await apiFetch(`/tecnicos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        showNotification('Técnico atualizado!');
        closeModal('modal-edit-tecnico');
        loadTecnicos();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// --- Serviços ---
function updateRefreshStatusServicos() {
    const statusEl = document.getElementById('refresh-status-servicos');
    if (!statusEl) return;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    statusEl.innerHTML = `
        <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%;"></span>
        Sincronizado às ${timeStr}
    `;
}

async function loadServicos() {
    try {
        const servicos = await apiFetch('/servicos');
        const colPendente = document.querySelector('#srv-col-pendente .cards-wrapper');
        const colResolucao = document.querySelector('#srv-col-resolucao .cards-wrapper');
        const colResolvida = document.querySelector('#srv-col-resolvida .cards-wrapper');

        colPendente.innerHTML = '';
        colResolucao.innerHTML = '';
        colResolvida.innerHTML = '';

        servicos.forEach(s => {
            const card = document.createElement('div');
            card.className = 'avaria-card';

            let tagHTML = `<div class="card-type" style="background:var(--accent); color:white;">${escapeHTML(s.tipo_servico)}</div>`;
            tagHTML += ` <div class="card-type" style="background:#e2e8f0; color:#475569; margin-left:5px;">${escapeHTML(s.tipo_camiao)}</div>`;
            
            if (s.estado === 'pausada') {
                tagHTML += ` <div class="card-type" style="background:#fef08a; color:#854d0e; margin-left:5px;"><i class="ph ph-pause"></i> PAUSADA</div>`;
            }

            card.innerHTML = `
                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;">${tagHTML}</div>
                <h4 class="card-machine-name"></h4>
                <div class="assigned-tech" style="margin-top:10px; font-size:13px; font-weight:600; color:var(--accent);">
                    <span style="color:var(--text-secondary); font-weight:400;">Técnico:</span> <span class="card-tech-name"></span>
                </div>
                <div class="date">${new Date(s.data_hora).toLocaleString('pt-PT')}</div>
                ${s.notas ? `<div class="card-notes" title="Clique para ver nota completa"><strong>Notas:</strong><br>${escapeHTML(s.notas)}</div>` : ''}
            `;

            if (s.notas) {
                const notesEl = card.querySelector('.card-notes');
                notesEl.onclick = (e) => {
                    e.stopPropagation();
                    openFullNoteModal(s.notas);
                };
            }
            
            card.querySelector('.card-machine-name').textContent = s.cliente_nome || 'Sem Cliente';
            card.querySelector('.card-tech-name').textContent = s.tecnico_nome || 'Não Atribuído';

            if (s.estado === 'resolvida') {
                const btnArchive = document.createElement('button');
                btnArchive.className = 'btn-archive';
                btnArchive.title = 'Limpar do dashboard';
                btnArchive.innerHTML = '<i class="ph ph-x"></i>';
                btnArchive.onclick = async (e) => {
                    e.stopPropagation();
                    if (!confirm('Deseja limpar este serviço do dashboard?')) return;
                    try {
                        await apiFetch(`/servicos/${s.id}/arquivar`, { method: 'PUT' });
                        loadServicos();
                    } catch (err) { showNotification(err.message, true); }
                };
                card.appendChild(btnArchive);
            } else {
                card.onclick = () => {
                    const modal = document.getElementById('modal-atribuir-tecnico');
                    modal.dataset.type = 'servico';
                    document.getElementById('atribuir-avaria-id').value = s.id;
                    document.getElementById('atribuir-tecnico-select').value = s.tecnico_id || '';
                    openModal('modal-atribuir-tecnico');
                };
            }

            if (s.estado === 'pendente' || s.estado === 'pausada') colPendente.appendChild(card);
            else if (s.estado === 'em resolução') colResolucao.appendChild(card);
            else colResolvida.appendChild(card);
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

document.getElementById('form-report-servico').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        cliente_id: document.getElementById('report-servico-cliente').value,
        tipo_servico: document.getElementById('report-servico-tipo').value,
        tipo_camiao: document.getElementById('report-servico-camiao').value,
        notas: document.getElementById('report-servico-notas').value,
        tecnico_id: document.getElementById('report-servico-tecnico').value
    };

    try {
        await apiFetch('/servicos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        showNotification('Serviço reportado com sucesso!');
        closeModal('modal-report-servico');
        document.getElementById('form-report-servico').reset();
        loadServicos();
    } catch (err) {
        showNotification(err.message, true);
    }
});

const btnOpenReportServico = document.getElementById('btn-open-report-servico');
if (btnOpenReportServico) {
    btnOpenReportServico.onclick = () => openModal('modal-report-servico');
}

function toggleDashboardCol(colId) {
    const col = document.getElementById(colId);
    col.classList.toggle('collapsed');
    const states = JSON.parse(localStorage.getItem('maclau_dashboard_cols') || '{}');
    states[colId] = col.classList.contains('collapsed');
    localStorage.setItem('maclau_dashboard_cols', JSON.stringify(states));
}

// --- Estatísticas (Chart.js) ---
let statsChartInstance = null;

function getGroupingKey(dateStr, grouping) {
    const d = new Date(dateStr);
    if (grouping === 'dia') {
        return d.toISOString().split('T')[0]; // YYYY-MM-DD
    } else if (grouping === 'mes') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
    } else if (grouping === 'semana') {
        // Obter início da semana (Segunda-feira)
        const day = d.getDay();
        const diff = d.getDate() - day + (day == 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        return monday.toISOString().split('T')[0];
    }
}

async function loadEstatisticas() {
    try {
        const statsData = await apiFetch('/estatisticas/avarias');
        const techFilter = document.getElementById('stats-tecnico').value;
        const grouping = document.getElementById('stats-agrupamento').value;

        // Apply filters
        let filtered = statsData;
        if (techFilter) {
            filtered = filtered.filter(a => a.tecnico_id == techFilter);
        }

        // Group data
        const grouped = {};
        filtered.forEach(a => {
            const key = getGroupingKey(a.data_hora_fim, grouping);
            if (!grouped[key]) grouped[key] = 0;
            grouped[key]++;
        });

        // Sort keys chronologically
        const labels = Object.keys(grouped).sort();
        const dataPoints = labels.map(l => grouped[l]);

        const ctx = document.getElementById('statsChart').getContext('2d');
        if (statsChartInstance) statsChartInstance.destroy();

        statsChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Avarias Resolvidas',
                    data: dataPoints,
                    backgroundColor: '#007bff',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    } catch (e) {
        showNotification("Erro ao carregar estatísticas: " + e.message, true);
    }
}

// --- Histórico ---
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

async function loadHistoricoMaquinas() {
    const clienteId = document.getElementById('hist-cliente').value;
    const select = document.getElementById('hist-maquina');
    select.innerHTML = '<option value="">Todas</option>';

    if (!clienteId) {
        select.innerHTML = '<option value="">Todas (Selecione Lavandaria primeiro)</option>';
        return;
    }

    try {
        const maquinas = await apiFetch('/maquinas');
        const filtered = maquinas.filter(m => m.cliente_id == clienteId);
        filtered.forEach(m => {
            const maquinaNome = (m.marca || '') + ((m.marca && m.modelo) ? ' - ' : '') + (m.modelo || '');
            select.insertAdjacentHTML('beforeend', `<option value="${m.uuid}">${maquinaNome}</option>`);
        });
    } catch (e) {
        // fail silently
    }
}

async function loadHistorico() {
    try {
        const data = await apiFetch('/historico/avarias');
        const tbody = document.getElementById('table-historico-body');

        const filtroCliente = document.getElementById('hist-cliente').value;
        const filtroMaquina = document.getElementById('hist-maquina').value;
        const filtroTecnico = document.getElementById('hist-tecnico').value;
        const filtroFaturacao = document.getElementById('hist-faturacao').value;

        tbody.innerHTML = '';

        data.forEach(a => {
            if (filtroCliente && a.cliente_id != filtroCliente) return;
            if (filtroMaquina && a.maquina_uuid != filtroMaquina) return;
            if (filtroTecnico && a.tecnico_id != filtroTecnico) return;
            if (filtroFaturacao && a.estado_faturacao !== filtroFaturacao) return;

            const dataFimExibicao = a.data_hora_fim ? new Date(a.data_hora_fim).toLocaleString('pt-PT') : new Date(a.data_hora).toLocaleString('pt-PT');
            const reportBtnHtml = a.relatorio ? `` : `<span style="font-size:11px; color:var(--text-secondary);">Sem Relatório</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${dataFimExibicao}</td>
                <td class="col-tech"></td>
                <td class="col-client"></td>
                <td class="col-machine"></td>
                <td>${(a.horas_trabalho !== null && a.horas_trabalho !== undefined && a.horas_trabalho !== '') ? a.horas_trabalho + 'h' : '-'}</td>
                <td>
                    <select class="select-faturacao">
                        <option value="Por Faturar">Por Faturar</option>
                        <option value="Faturado">Faturado</option>
                        <option value="Oferta">Oferta</option>
                        <option value="Garantia">Garantia</option>
                    </select>
                </td>
                <td class="col-actions">
                    <div style="display:flex; gap:5px;">${reportBtnHtml}</div>
                </td>
            `;
            tr.querySelector('.col-tech').textContent = a.tecnico_nome || 'Não Atribuído';
            tr.querySelector('.col-client').textContent = a.cliente_nome || 'Sem Cliente';
            tr.querySelector('.col-machine').textContent = a.maquina_nome || 'Máquina Removida';

            const selFat = tr.querySelector('.select-faturacao');
            if (a.estado_faturacao) selFat.value = a.estado_faturacao;

            // Apply dynamic class for modern look
            const updateStatusClass = (val) => {
                selFat.classList.remove('status-por-faturar', 'status-faturado', 'status-oferta', 'status-garantia');
                const classMap = {
                    'Por Faturar': 'status-por-faturar',
                    'Faturado': 'status-faturado',
                    'Oferta': 'status-oferta',
                    'Garantia': 'status-garantia'
                };
                if (classMap[val]) selFat.classList.add(classMap[val]);
            };
            updateStatusClass(selFat.value);

            selFat.addEventListener('change', async (e) => {
                const newVal = e.target.value;
                const oldVal = a.estado_faturacao || 'Por Faturar';

                if (!confirm(`Tem a certeza que deseja alterar o estado de faturação para "${newVal}"?`)) {
                    e.target.value = oldVal;
                    updateStatusClass(oldVal);
                    return;
                }

                updateStatusClass(newVal);
                try {
                    await apiFetch('/avarias/' + a.id + '/faturacao', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ estado_faturacao: newVal })
                    });
                    showNotification('Faturação atualizada!');
                    a.estado_faturacao = newVal;
                } catch (err) {
                    showNotification(err.message, true);
                    e.target.value = oldVal;
                    updateStatusClass(oldVal);
                }
            });

            if (a.relatorio) {

                const colActions = tr.querySelector('.col-actions div');
                const btnPdf = document.createElement('button');
                btnPdf.className = 'btn-status';
                btnPdf.style.padding = '5px 10px';
                btnPdf.style.fontSize = '12px';
                btnPdf.style.display = 'flex';
                btnPdf.style.alignItems = 'center';
                btnPdf.style.gap = '5px';
                btnPdf.style.border = 'none';
                btnPdf.style.borderRadius = '6px';
                btnPdf.style.cursor = 'pointer';
                btnPdf.style.fontWeight = '600';

                if (a.relatorio_submetido === 1) {
                    btnPdf.style.background = '#dc2626';
                    btnPdf.style.color = '#ffffff';
                    btnPdf.innerHTML = '<i class="ph ph-file-pdf"></i> PDF';
                } else {
                    btnPdf.style.background = '#fef08a';
                    btnPdf.style.color = '#854d0e';
                    btnPdf.style.padding = '3px 8px';
                    btnPdf.style.fontSize = '10px';
                    btnPdf.innerHTML = '<i class="ph ph-file-text"></i> Rascunho';
                }

                btnPdf.onclick = () => window.open(`/relatorio.html?id=${a.id}`, '_blank');
                colActions.appendChild(btnPdf);
            }

            tbody.appendChild(tr);
        });
    } catch (e) {
        showNotification("Erro ao carregar histórico: " + e.message, true);
    }
}

function viewRelatorio(texto) {
    const content = document.getElementById('view-relatorio-content');
    content.textContent = texto;
    openModal('modal-view-relatorio');
}

async function loadMachinesForReport() {
    const clienteId = document.getElementById('report-avaria-cliente').value;
    const select = document.getElementById('report-avaria-maquina');

    if (!clienteId) {
        select.innerHTML = '<option value="">Selecione o Cliente primeiro</option>';
        select.disabled = true;
        return;
    }

    try {
        const maquinas = await apiFetch('/maquinas');
        const filtered = maquinas.filter(m => m.cliente_id == clienteId);

        select.innerHTML = '<option value="">-- Selecionar Máquina --</option>';
        if (filtered.length === 0) {
            select.innerHTML = '<option value="">Nenhuma máquina encontrada</option>';
            select.disabled = true;
        } else {
            filtered.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.uuid;
                opt.textContent = (m.marca || '') + ((m.marca && m.modelo) ? ' - ' : '') + (m.modelo || '');
                select.appendChild(opt);
            });
            select.disabled = false;
        }
    } catch (e) {
        showNotification("Erro ao carregar máquinas", true);
    }
}

// INIT
window.onload = async () => {
    await ensureAuth();
    loadAvarias();
    loadClientes();
    loadTecnicos();

    const states = JSON.parse(localStorage.getItem('maclau_dashboard_cols') || '{}');
    Object.keys(states).forEach(colId => {
        if (states[colId]) {
            const col = document.getElementById(colId);
            if (col) col.classList.add('collapsed');
        }
    });

    // --- Listeners para conformidade CSP (Sem inline handlers) ---

    // Logout
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Filtros Dashboard
    const filterTech = document.getElementById('filter-tech-dashboard');
    if (filterTech) filterTech.addEventListener('change', loadAvarias);

    const filterStart = document.getElementById('filter-date-start');
    if (filterStart) filterStart.addEventListener('change', loadAvarias);

    const filterEnd = document.getElementById('filter-date-end');
    if (filterEnd) filterEnd.addEventListener('change', loadAvarias);

    // Toggle Colunas
    document.querySelectorAll('.btn-toggle-col').forEach(btn => {
        btn.addEventListener('click', () => {
            const colId = btn.getAttribute('data-col');
            toggleDashboardCol(colId);
        });
    });

    // Estatísticas
    const statsAgrup = document.getElementById('stats-agrupamento');
    if (statsAgrup) statsAgrup.addEventListener('change', loadEstatisticas);

    const statsTechF = document.getElementById('stats-tecnico');
    if (statsTechF) statsTechF.addEventListener('change', loadEstatisticas);

    // Histórico
    const histClient = document.getElementById('hist-cliente');
    if (histClient) histClient.addEventListener('change', () => {
        loadHistoricoMaquinas();
        updateFilterBadge();
        loadHistorico();
    });

    const histMaq = document.getElementById('hist-maquina');
    if (histMaq) histMaq.addEventListener('change', () => {
        updateFilterBadge();
        loadHistorico();
    });

    const histTechF = document.getElementById('hist-tecnico');
    if (histTechF) histTechF.addEventListener('change', () => {
        updateFilterBadge();
        loadHistorico();
    });

    const histFatF = document.getElementById('hist-faturacao');
    if (histFatF) histFatF.addEventListener('change', () => {
        updateFilterBadge();
        loadHistorico();
    });

    // --- Filter Menu Toggle Logic ---
    const btnFilterToggle = document.getElementById('btn-filter-toggle');
    const filterMenu = document.getElementById('filter-menu');

    if (btnFilterToggle && filterMenu) {
        btnFilterToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            filterMenu.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!filterMenu.contains(e.target) && !btnFilterToggle.contains(e.target)) {
                filterMenu.classList.remove('active');
            }
        });
    }

    function updateFilterBadge() {
        const c = document.getElementById('hist-cliente').value;
        const m = document.getElementById('hist-maquina').value;
        const t = document.getElementById('hist-tecnico').value;
        const f = document.getElementById('hist-faturacao').value;

        let count = 0;
        if (c) count++;
        if (m) count++;
        if (t) count++;
        if (f) count++;

        const badge = document.getElementById('active-filters-count');
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }
    // Chamar uma vez no início ou quando mudar filtros
    updateFilterBadge();

    // Máquinas
    const filterClMaq = document.getElementById('filter-cliente-maquinas');
    if (filterClMaq) filterClMaq.addEventListener('change', loadMaquinas);

    // Abertura de Modals Estáticos
    const addClientBtn = document.getElementById('btn-open-add-client');
    if (addClientBtn) addClientBtn.addEventListener('click', () => openModal('modal-add-client'));

    const addMaqBtn = document.getElementById('btn-open-add-maquina');
    if (addMaqBtn) addMaqBtn.addEventListener('click', () => openModal('modal-add-maquina'));

    const addTechBtn = document.getElementById('btn-open-add-tecnico');
    if (addTechBtn) addTechBtn.addEventListener('click', () => openModal('modal-add-tecnico'));

    // NOVO: Abrir Manual Report
    const openReportBtn = document.getElementById('btn-open-report-avaria');
    if (openReportBtn) {
        openReportBtn.addEventListener('click', () => {
            loadClientes();
            loadTecnicos();
            openModal('modal-report-avaria');
        });
    }

    // NOVO: Filtrar máquinas no modal de reporte
    const reportClientSelect = document.getElementById('report-avaria-cliente');
    if (reportClientSelect) reportClientSelect.addEventListener('change', loadMachinesForReport);

    // NOVO: Submissão Form Reporte Admin
    const reportForm = document.getElementById('form-report-avaria');
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                maquina_id: document.getElementById('report-avaria-maquina').value,
                tipo_avaria: parseInt(document.getElementById('report-avaria-tipo').value),
                tecnico_id: document.getElementById('report-avaria-tecnico').value || null,
                notas: document.getElementById('report-avaria-notas').value
            };

            if (!data.maquina_id) return showNotification("Selecione uma máquina válida", true);

            try {
                await apiFetch('/avarias', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                showNotification('Avaria reportada com sucesso!');
                closeModal('modal-report-avaria');
                reportForm.reset();
                document.getElementById('report-avaria-maquina').disabled = true;
                loadAvarias();
            } catch (e) {
                showNotification(e.message, true);
            }
        });
    }

    // Fecho de Modals
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-modal');
            if (modalId) closeModal(modalId);
        });
    });

    // Impressão QR
    const printBtn = document.getElementById('btn-print-qr');
    if (printBtn) printBtn.addEventListener('click', () => window.print());

    // Iniciar Auto-Refresh se estivermos no Dashboard
    startAutoRefresh();
    updateRefreshStatus();

    // Toggle Sidebar Mobile
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => {
            const sidebar = document.querySelector('.sidebar');
            sidebar.classList.toggle('active');
        });
    }

    // Fechar Sidebar Mobile
    const btnCloseSidebar = document.getElementById('btn-close-sidebar');
    if (btnCloseSidebar) {
        btnCloseSidebar.addEventListener('click', () => {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) sidebar.classList.remove('active');
        });
    }

    // Fechar sidebar ao clicar num link (mobile)
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar) sidebar.classList.remove('active');
            }
        });
    });
};

// Fechar modals em background click
window.onclick = function (event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.add('hidden');
    }
}
