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
let currentDashboardFilter = 'all';
let timerInterval = null;
let refreshIntervalId = null;

function updateRefreshStatus() {
    const statusEl = document.getElementById('refresh-status');
    if (!statusEl) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    statusEl.innerHTML = `
        <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%;"></span>
        Sincronizado às ${timeStr}
    `;
}

function startAutoRefresh() {
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    refreshIntervalId = setInterval(() => {
        // Não atualizar se houver modais abertos ou se não estiver no dashboard
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        if (openModals.length > 0) return;

        const dashboardView = document.getElementById('view-dashboard');
        if (dashboardView && !dashboardView.classList.contains('hidden')) {
            loadMyTasks();
        }
    }, 30000); // 30 segundos
}

// --- Gestão de Cronómetro ---
function getTimerState() {
    const state = localStorage.getItem('maclau_timer');
    return state ? JSON.parse(state) : { taskId: null, taskType: null, startTime: null, accumulatedMs: 0 };
}

function saveTimerState(state) {
    localStorage.setItem('maclau_timer', JSON.stringify(state));
}

function startTimer(id, type) {
    let state = getTimerState();
    // Se for uma tarefa diferente, limpa o anterior (proteção)
    if (state.taskId && state.taskId != id) {
        state = { taskId: id, taskType: type, startTime: Date.now(), accumulatedMs: 0 };
    } else {
        state.taskId = id;
        state.taskType = type;
        state.startTime = Date.now();
    }
    saveTimerState(state);
    initGlobalTimer();
}

function pauseTimer() {
    const state = getTimerState();
    if (state.startTime) {
        state.accumulatedMs += (Date.now() - state.startTime);
        state.startTime = null;
        saveTimerState(state);
    }
}

function stopTimer() {
    localStorage.removeItem('maclau_timer');
}

function formatDuration(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function initGlobalTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const state = getTimerState();
        if (!state.taskId || !state.startTime) return;
        
        const el = document.getElementById(`timer-${state.taskType}-${state.taskId}`);
        if (el) {
            const currentMs = state.accumulatedMs + (Date.now() - state.startTime);
            el.textContent = formatDuration(currentMs);
        }
    }, 1000);
}

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
        const [resAvarias, resServicos] = await Promise.all([
            authFetch(`${API_BASE}/tecnico/avarias?_=${Date.now()}`),
            authFetch(`${API_BASE}/tecnico/servicos?_=${Date.now()}`)
        ]);

        const avarias = await resAvarias.json();
        const servicos = await resServicos.json();
        updateRefreshStatus();

        // Marcar o tipo para cada item
        const tasks = [
            ...avarias.map(a => ({ ...a, _type: 'avaria' })),
            ...servicos.map(s => ({ ...s, _type: 'servico' }))
        ];

        // Ordenar: Pausadas primeiro, depois por data decrescente
        tasks.sort((a, b) => {
            if (a.estado === 'pausada' && b.estado !== 'pausada') return -1;
            if (a.estado !== 'pausada' && b.estado === 'pausada') return 1;
            return new Date(b.data_hora) - new Date(a.data_hora);
        });

        const container = document.getElementById('repairs-container');
        const stats = document.getElementById('tech-stats');

        let filteredTasks = tasks;
        if (currentDashboardFilter !== 'all') {
            filteredTasks = tasks.filter(t => t._type === currentDashboardFilter);
        }

        const total = filteredTasks.length;
        stats.textContent = total === 1 ? "Tem 1 tarefa pendente." : `Tem ${total} tarefas pendentes.`;
        container.innerHTML = '';

        if (total === 0) {
            const msg = currentDashboardFilter === 'avaria' ? 'Não tem avarias pendentes.' : (currentDashboardFilter === 'servico' ? 'Não tem serviços pendentes.' : 'Não tem tarefas pendentes.');
            container.innerHTML = `<p style="text-align:center; color:var(--text-secondary); margin-top:20px;">${msg} Bom trabalho!</p>`;
            return;
        }

        filteredTasks.forEach(task => {
            const div = document.createElement('div');
            div.className = 'repair-item';

            let tagStr = '';
            let tagColor = 'var(--accent)';
            let titleStr = '';
            
            if (task._type === 'avaria') {
                tagStr = task.tipo_avaria === 1 ? 'ELÉTRICA' : (task.tipo_avaria === 3 ? 'MECÂNICA' : 'DESCONHECIDA');
                titleStr = task.maquina_nome;
            } else {
                tagStr = task.tipo_servico;
                tagColor = '#1E4419';
                titleStr = task.cliente_nome;
            }

            let statusLabel = 'Em Resolução';
            let statusColor = 'var(--warning)';
            if (task.estado === 'pendente') {
                statusLabel = 'Aguardando Início';
                statusColor = 'var(--danger)';
            } else if (task.estado === 'pausada') {
                const pDate = task.data_hora_pausa ? new Date(task.data_hora_pausa) : new Date();
                statusLabel = `Pausado às ${pDate.getHours().toString().padStart(2, '0')}:${pDate.getMinutes().toString().padStart(2, '0')}h ${pDate.toLocaleDateString('pt-PT')}`;
                statusColor = '#ca8a04';
            }

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                    <div style="display:flex; gap:5px;">
                        <span style="font-size:11px; font-weight:700; background:var(--accent-light); color:${tagColor}; padding:3px 8px; border-radius:4px;">${tagStr}</span>
                        ${task._type === 'servico' ? `<span style="font-size:11px; font-weight:700; background:#f1f5f9; color:#475569; padding:3px 8px; border-radius:4px;">${task.tipo_camiao}</span>` : ''}
                    </div>
                    <span style="font-size:12px; font-weight:700; color:${statusColor};">${statusLabel}</span>
                </div>
                <h3 class="task-machine-name" style="margin-bottom:5px;">${escapeHTML(titleStr)}</h3>
                <p class="task-client-name" style="font-size:14px; color:var(--text-secondary);">${task._type === 'avaria' ? escapeHTML(task.cliente_nome) : 'Serviço Externo'}</p>
                <div style="font-size:12px; color:var(--text-secondary); margin-top:10px;">Reportado em: ${new Date(task.data_hora).toLocaleString('pt-PT')}</div>
                ${task.notas ? `<div style="margin-top:10px; padding:10px; background:var(--surface-color); border-radius:6px; font-size:13px; border-left:3px solid var(--accent);"><strong style="color:var(--text-main);">Notas do Admin:</strong><br>${escapeHTML(task.notas)}</div>` : ''}
                
                ${task.estado === 'em resolução' ? `
                <div class="timer-badge">
                    <div class="timer-pulse"></div>
                    <span id="timer-${task._type}-${task.id}">00:00:00</span>
                </div>
                ` : ''}

                <div class="repair-actions" style="gap:10px; margin-top:15px;">
                </div>
            `;

            const actionsDiv = div.querySelector('.repair-actions');

            if (task.estado === 'em resolução') {
                const btnPausar = document.createElement('button');
                btnPausar.className = 'btn-status';
                btnPausar.style.backgroundColor = '#e2e8f0';
                btnPausar.style.color = '#475569';
                btnPausar.innerHTML = '<i class="ph ph-pause"></i> Pausar';
                btnPausar.onclick = () => {
                    document.getElementById('pausar-avaria-id').value = task.id;
                    document.getElementById('pausar-type').value = task._type;
                    document.getElementById('pausar-motivo').value = '';
                    document.getElementById('modal-pausar').classList.remove('hidden');
                };
                actionsDiv.appendChild(btnPausar);
            }

            const btn = document.createElement('button');
            const ehAguardando = (task.estado === 'pendente' || task.estado === 'pausada');
            btn.className = 'btn-status ' + (ehAguardando ? 'btn-resolucao' : 'btn-resolvida');
            btn.innerHTML = ehAguardando ? '<i class="ph ph-play"></i> ' + (task.estado === 'pausada' ? 'Retomar' : 'Começar') : '<i class="ph ph-check"></i> Concluir';
            btn.onclick = () => updateStatus(task.id, ehAguardando ? 'em resolução' : 'resolvida', task.relatorio, task._type);
            actionsDiv.appendChild(btn);

            container.appendChild(div);
        });
    } catch (e) {
        showNotification("Erro ao carregar tarefas.", true);
    }
}

async function updateStatus(id, newStatus, currentText = '', type = 'avaria') {
    try {
        const endpoint = type === 'servico' ? `${API_BASE}/servicos/${id}/status` : `${API_BASE}/avarias/${id}/status`;
        const res = await authFetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: newStatus })
        });

        if (res.ok) {
            if (newStatus === 'resolvida') {
                pauseTimer();
                openRelatorioModal(id, true, currentText, false, '', '', '', type);
            } else {
                if (newStatus === 'em resolução') startTimer(id, type);
                showNotification(newStatus === 'pausada' ? "Tarefa pausada." : "Tarefa iniciada!");
                loadMyTasks();
            }
        } else {
            throw new Error("Erro ao atualizar estado.");
        }
    } catch (e) {
        showNotification(e.message, true);
    }
}

// --- Funções de Relatório ---

// --- Gestão de Fotos ---
window.deletePhoto = async function(photoId) {
    if (!confirm("Tem a certeza que deseja remover esta foto?")) return;
    
    try {
        const res = await authFetch(`${API_BASE}/tecnico/fotos/${photoId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Erro ao remover foto");
        
        showNotification("Foto removida.");
        // Recarregar o modal
        const id = document.getElementById('relatorio-avaria-id').value;
        const type = document.getElementById('relatorio-type').value;
        const currentText = document.getElementById('relatorio-texto').value;
        const currentPecas = document.getElementById('relatorio-pecas').value;
        const currentHoras = document.getElementById('relatorio-horas').value;
        
        const canvasCli = document.getElementById('signature-pad');
        const canvasTec = document.getElementById('signature-pad-tech');
        const currentSig = isCanvasBlank(canvasCli) ? '' : canvasCli.toDataURL('image/png');
        const currentSigTech = isCanvasBlank(canvasTec) ? '' : canvasTec.toDataURL('image/png');

        openRelatorioModal(id, false, currentText, false, currentPecas, currentHoras, currentSig, type, currentSigTech);
    } catch (err) {
        showNotification(err.message, true);
    }
};

function renderPhotosPreview(fotos, disabled = false) {
    const container = document.getElementById('fotos-preview');
    if (!container) return;
    container.innerHTML = '';
    
    fotos.forEach(f => {
        const div = document.createElement('div');
        div.className = 'foto-preview-item';
        div.style.position = 'relative';
        div.style.width = '100px';
        div.style.height = '100px';
        div.style.borderRadius = '8px';
        div.style.overflow = 'hidden';
        div.style.border = '2px solid #e2e8f0';
        div.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
        
        const img = document.createElement('img');
        img.src = f.caminho;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        div.appendChild(img);
        
        if (!disabled) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerHTML = '<i class="ph ph-x" style="font-weight:bold;"></i>';
            btn.style.position = 'absolute';
            btn.style.top = '4px';
            btn.style.right = '4px';
            btn.style.background = '#ef4444';
            btn.style.color = 'white';
            btn.style.border = 'none';
            btn.style.borderRadius = '50%';
            btn.style.width = '24px';
            btn.style.height = '24px';
            btn.style.cursor = 'pointer';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.zIndex = '999';
            btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.deletePhoto(f.id);
            };
            
            div.appendChild(btn);
        }
        
        container.appendChild(div);
    });
}

async function uploadPhotos(files) {
    const id = document.getElementById('relatorio-avaria-id').value;
    const type = document.getElementById('relatorio-type').value;
    
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('fotos', files[i]);
    }
    
    if (type === 'servico') formData.append('servico_id', id);
    else formData.append('avaria_id', id);
    
    try {
        const res = await fetch(`${API_BASE}/tecnico/upload-fotos`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwtToken}` },
            body: formData
        });
        
        if (!res.ok) throw new Error("Erro ao carregar fotos");
        
        showNotification("Fotos carregadas com sucesso!");
        // Recarregar o modal para ver as novas fotos
        const currentText = document.getElementById('relatorio-texto').value;
        const currentPecas = document.getElementById('relatorio-pecas').value;
        const currentHoras = document.getElementById('relatorio-horas').value;
        
        const canvasCli = document.getElementById('signature-pad');
        const canvasTec = document.getElementById('signature-pad-tech');
        const currentSig = isCanvasBlank(canvasCli) ? '' : canvasCli.toDataURL('image/png');
        const currentSigTech = isCanvasBlank(canvasTec) ? '' : canvasTec.toDataURL('image/png');

        openRelatorioModal(id, false, currentText, false, currentPecas, currentHoras, currentSig, type, currentSigTech);
        
    } catch (err) {
        showNotification(err.message, true);
    }
}

async function openRelatorioModal(id, isStatusChange = false, currentText = '', isSubmitted = false, currentPecas = '', currentHoras = '', currentSignature = '', type = 'avaria', currentSignatureTech = '') {
    document.getElementById('relatorio-avaria-id').value = id;
    document.getElementById('relatorio-type').value = type;
    document.getElementById('relatorio-status-change').value = isStatusChange ? '1' : '0';

    // UI Elements
    const btnSubmit = document.getElementById('btn-submit-report');
    const btnSave = document.getElementById('btn-save-draft');
    const warning = document.getElementById('relatorio-warning');
    const textarea = document.getElementById('relatorio-texto');
    const pecasArea = document.getElementById('relatorio-pecas');
    const horasInput = document.getElementById('relatorio-horas');

    // Fetch Details to populate A4 Sheet
    try {
        const endpoint = type === 'servico' ? `/api/servicos/${id}/detalhes-relatorio` : `/api/avarias/${id}/detalhes-relatorio`;
        const res = await authFetch(endpoint);
        if (!res.ok) throw new Error("Erro ao carregar detalhes");
        const data = await res.json();

        // Populate Headers and Info
        document.getElementById('a4-report-id').textContent = `ID: #${data.id.toString().padStart(5, '0')}`;
        const dateObj = new Date(data.data_hora_fim || data.data_hora);
        document.getElementById('a4-report-date').textContent = `Data: ${dateObj.toLocaleDateString('pt-PT')}`;
        document.getElementById('a4-report-type').innerHTML = data.relatorio_submetido === 1 ? 'Relatório de Intervenção' : '<span style="color:#ca8a04;">Relatório (Rascunho)</span>';

        document.getElementById('a4-cliente-nome').textContent = data.cliente_nome || '---';
        document.getElementById('a4-cliente-email').textContent = data.cliente_email || '---';
        document.getElementById('a4-cliente-contato').textContent = data.cliente_contato || '---';

        document.getElementById('a4-tecnico-nome').textContent = data.tecnico_nome || '---';
        
        const machineRow = document.getElementById('a4-machine-row');
        const serviceRow = document.getElementById('a4-service-row');
        const detailsTitle = document.getElementById('a4-details-title');

        if (type === 'avaria') {
            detailsTitle.innerHTML = '<i class="ph ph-wrench"></i> Máquina';
            machineRow.style.display = 'block';
            serviceRow.style.display = 'none';
            document.getElementById('a4-maquina-nome').textContent = data.maquina_nome || '---';
            document.getElementById('a4-tipo-avaria').textContent = data.tipo_avaria === 1 ? 'Elétrica' : (data.tipo_avaria === 3 ? 'Mecânica' : 'Outra');
        } else {
            detailsTitle.innerHTML = '<i class="ph ph-truck"></i> Serviço';
            machineRow.style.display = 'none';
            serviceRow.style.display = 'block';
            document.getElementById('a4-tipo-servico').textContent = data.tipo_servico || '---';
            document.getElementById('a4-tipo-camiao').textContent = data.tipo_camiao || '---';
        }

        // Populate Editable Fields
        textarea.value = currentText || data.relatorio || '';
        pecasArea.value = currentPecas || data.pecas_substituidas || '';
        
        let hoursVal = currentHoras || data.horas_trabalho || '';
        // Se estivermos a concluir agora e o campo estiver vazio, usa o cronómetro
        if (!hoursVal && isStatusChange) {
            const state = getTimerState();
            if (state.taskId == id && state.taskType == type) {
                const totalMs = state.accumulatedMs + (state.startTime ? (Date.now() - state.startTime) : 0);
                const totalHours = totalMs / (1000 * 60 * 60);
                if (totalHours > 0.01) { // Apenas se tiver pelo menos ~30 segundos
                    hoursVal = totalHours.toFixed(2);
                }
            }
        }
        horasInput.value = hoursVal;

        // Handle Signatures
        clearSignature();
        clearSignatureTech();
        
        const sigToUse = currentSignature || data.assinatura_cliente;
        if (sigToUse) {
            const img = new Image();
            img.onload = () => sigCtx.drawImage(img, 0, 0);
            img.src = sigToUse;
        }

        const sigTechToUse = currentSignatureTech || data.assinatura_tecnico;
        if (sigTechToUse) {
            const imgTech = new Image();
            imgTech.onload = () => sigCtxTech.drawImage(imgTech, 0, 0);
            imgTech.src = sigTechToUse;
        }

        // Constraints
        const disabled = data.relatorio_submetido === 1;
        textarea.disabled = disabled;
        pecasArea.disabled = disabled;
        horasInput.disabled = disabled;
        btnSubmit.style.display = disabled ? 'none' : 'block';
        btnSave.style.display = disabled ? 'none' : 'block';
        warning.style.display = disabled ? 'none' : 'block';

        // Renderizar fotos
        renderPhotosPreview(data.fotos || [], disabled);
        
        // Esconder botão de adicionar fotos se desativado
        const btnAddPhotos = document.getElementById('btn-add-fotos');
        if (btnAddPhotos) btnAddPhotos.style.display = disabled ? 'none' : 'block';

        document.getElementById('modal-relatorio').classList.remove('hidden');
    } catch (e) {
        showNotification("Erro ao carregar dados do relatório.", true);
    }
}

async function saveRelatorioDraft() {
    const id = document.getElementById('relatorio-avaria-id').value;
    const type = document.getElementById('relatorio-type').value;
    const relatorio = document.getElementById('relatorio-texto').value;
    const pecas_substituidas = document.getElementById('relatorio-pecas').value;
    const horas_raw = document.getElementById('relatorio-horas').value;
    const horas_trabalho = horas_raw ? horas_raw.replace(',', '.') : '';
    const isStatusChange = document.getElementById('relatorio-status-change').value === '1';
    
    const canvasCli = document.getElementById('signature-pad');
    const canvasTec = document.getElementById('signature-pad-tech');
    
    const assinatura_cliente = isCanvasBlank(canvasCli) ? null : canvasCli.toDataURL('image/png');
    const assinatura_tecnico = isCanvasBlank(canvasTec) ? null : canvasTec.toDataURL('image/png');

    console.log("Tentando salvar rascunho. Assinatura técnico presente:", !!assinatura_tecnico);

    try {
        const endpoint = type === 'servico' ? `${API_BASE}/tecnico/servicos/${id}/relatorio` : `${API_BASE}/tecnico/avarias/${id}/relatorio`;
        const res = await authFetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico })
        });

        if (res.ok) {
            showNotification("Rascunho salvo com sucesso.");
            document.getElementById('modal-relatorio').classList.add('hidden');
            if (isStatusChange) loadMyTasks();
            else loadHistorico();
        } else {
            const data = await res.json();
            throw new Error(data.error || "Erro ao salvar rascunho");
        }
    } catch (e) {
        showNotification(e.message, true);
    }
}

async function submitRelatorio() {
    const id = document.getElementById('relatorio-avaria-id').value;
    const type = document.getElementById('relatorio-type').value;
    const relatorio = document.getElementById('relatorio-texto').value;
    const pecas_substituidas = document.getElementById('relatorio-pecas').value;
    const horas_raw = document.getElementById('relatorio-horas').value;
    const horas_trabalho = horas_raw ? horas_raw.replace(',', '.') : '';
    const isStatusChange = document.getElementById('relatorio-status-change').value === '1';
    
    const canvasCli = document.getElementById('signature-pad');
    const canvasTec = document.getElementById('signature-pad-tech');
    
    const assinatura_cliente = isCanvasBlank(canvasCli) ? null : canvasCli.toDataURL('image/png');
    const assinatura_tecnico = isCanvasBlank(canvasTec) ? null : canvasTec.toDataURL('image/png');

    if (!confirm("Deseja submeter este relatório? Após submeter não poderá fazer mais alterações e o Administrador terá acesso ao mesmo.")) return;

    try {
        // Primeiro salvamos o texto atual
        const draftEndpoint = type === 'servico' ? `${API_BASE}/tecnico/servicos/${id}/relatorio` : `${API_BASE}/tecnico/avarias/${id}/relatorio`;
        await authFetch(draftEndpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico })
        });

        // Depois submetemos
        const submitEndpoint = type === 'servico' ? `${API_BASE}/tecnico/servicos/${id}/submeter-relatorio` : `${API_BASE}/tecnico/avarias/${id}/submeter-relatorio`;
        const res = await authFetch(submitEndpoint, {
            method: 'POST'
        });

        if (res.ok) {
            stopTimer(); // Limpa cronómetro após submeter com sucesso
            showNotification("Relatório submetido com sucesso!");
            document.getElementById('modal-relatorio').classList.add('hidden');
            if (isStatusChange) loadMyTasks();
            else loadHistorico();
        } else {
            const data = await res.json();
            throw new Error(data.error || "Erro ao submeter");
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
        const [resAvarias, resServicos] = await Promise.all([
            authFetch(`${API_BASE}/tecnico/historico`),
            authFetch(`${API_BASE}/tecnico/servicos/historico`)
        ]);

        const avarias = await resAvarias.json();
        const servicos = await resServicos.json();

        // Marcar tipos
        historicoData = [
            ...avarias.map(a => ({ ...a, _type: 'avaria' })),
            ...servicos.map(s => ({ ...s, _type: 'servico' }))
        ];

        // Ordenar por data de fim decrescente
        historicoData.sort((a, b) => new Date(b.data_hora_fim || b.data_hora) - new Date(a.data_hora_fim || a.data_hora));

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
    } catch (e) {
        showNotification("Erro ao carregar histórico", true);
    }
}

window.renderHistorico = function () {
    const tbody = document.getElementById('table-historico-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filter = document.getElementById('filter-hist-cliente')?.value;

    let filteredData = historicoData;
    if (filter) {
        filteredData = historicoData.filter(a => a.cliente_nome === filter);
    }

    filteredData.forEach(a => {
        const dateStr = a.data_hora_fim ? new Date(a.data_hora_fim).toLocaleString('pt-PT') : new Date(a.data_hora).toLocaleString('pt-PT');

        const tr = document.createElement('tr');

        let maqNome = a.maquina_nome || '-';
        if (a._type === 'servico') {
            maqNome = `<span style="color:var(--accent); font-weight:700;">[SERVIÇO]</span> ${escapeHTML(a.tipo_servico)}`;
        }

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td class="col-client"></td>
            <td class="col-machine">${maqNome}</td>
            <td>${(a.horas_trabalho !== null && a.horas_trabalho !== undefined && a.horas_trabalho !== '') ? a.horas_trabalho + 'h' : '-'}</td>
            <td class="col-report"><div style="display:flex; gap:5px;"></div></td>
        `;

        tr.querySelector('.col-client').textContent = a.cliente_nome || '-';
        if (a._type === 'avaria') {
            tr.querySelector('.col-machine').textContent = a.maquina_nome || '-';
        }

        const colReport = tr.querySelector('.col-report div');

        if (a.relatorio_submetido !== 1) {
            const btn = document.createElement('button');
            btn.className = 'btn-status';
            btn.style.padding = '5px 10px';
            btn.style.fontSize = '12px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.gap = '5px';
            btn.style.border = 'none';
            btn.style.borderRadius = '6px';
            btn.style.cursor = 'pointer';
            btn.style.fontWeight = '600';

            btn.style.background = '#fef9c3';
            btn.style.color = '#854d0e';
            btn.innerHTML = '<i class="ph ph-pencil-line"></i> Editar';

            btn.onclick = () => openReportFromHistory(a.id);
            colReport.appendChild(btn);
        }

        if (a.relatorio_submetido === 1) {
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
            btnPdf.style.background = '#dc2626';
            btnPdf.style.color = '#ffffff';
            btnPdf.innerHTML = '<i class="ph ph-file-pdf"></i> PDF';
            btnPdf.onclick = () => viewPDF(a.id, a._type);
            colReport.appendChild(btnPdf);
        }

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
        if (view) view.classList.remove('hidden');

        if (target === 'dashboard') loadMyTasks();
        if (target === 'agendamentos') loadAgendamentos();
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

window.onload = () => {
    showView();
    initSignaturePad();
    initGlobalTimer();
    startAutoRefresh();

    const inputFotos = document.getElementById('relatorio-fotos');
    if (inputFotos) {
        inputFotos.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadPhotos(e.target.files);
            }
        });
    }

    const btnAddFotos = document.getElementById('btn-add-fotos');
    if (btnAddFotos) {
        btnAddFotos.addEventListener('click', () => {
            document.getElementById('relatorio-fotos').click();
        });
    }

    // CSP Listeners
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    const histFilter = document.getElementById('filter-hist-cliente');
    if (histFilter) histFilter.addEventListener('change', renderHistorico);

    // Toggle Sidebar Mobile
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => {
            const sidebar = document.querySelector('.sidebar');
            sidebar.classList.toggle('active');
        });
    }

    // Dashboard Toggle Listeners
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentDashboardFilter = e.target.getAttribute('data-filter');
            loadMyTasks();
        });
    });

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

    // Relatorio Listeners
    const btnSaveDraft = document.getElementById('btn-save-draft');
    if (btnSaveDraft) btnSaveDraft.addEventListener('click', saveRelatorioDraft);

    const btnSubmitReport = document.getElementById('btn-submit-report');
    if (btnSubmitReport) {
        btnSubmitReport.addEventListener('click', (e) => {
            e.preventDefault();
            submitRelatorio();
        });
    }

    const formPausar = document.getElementById('form-pausar');
    if (formPausar) {
        formPausar.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('pausar-avaria-id').value;
            const type = document.getElementById('pausar-type').value;
            const motivo = document.getElementById('pausar-motivo').value;

            try {
                const endpoint = type === 'servico' ? `${API_BASE}/servicos/${id}/status` : `${API_BASE}/avarias/${id}/status`;
                const res = await authFetch(endpoint, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ estado: 'pausada', motivo_pausa: motivo })
                });

                if (res.ok) {
                    pauseTimer(); // Para o cronómetro ao pausar
                    showNotification("Tarefa pausada.");
                    document.getElementById('modal-pausar').classList.add('hidden');
                    loadMyTasks();
                } else {
                    const data = await res.json();
                    throw new Error(data.error || "Erro ao pausar.");
                }
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }

    const closeBtns = document.querySelectorAll('.close-btn');
    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-modal');
            if (modalId) {
                document.getElementById(modalId).classList.add('hidden');
                // Se era o modal de relatório vindo de uma conclusão, recarrega tarefas
                if (modalId === 'modal-relatorio' && document.getElementById('relatorio-status-change').value === '1') {
                    loadMyTasks();
                }
            }
        });
    });
};

function escapeJS(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

window.openReportFromHistory = function (id) {
    const item = historicoData.find(a => a.id === id);
    if (!item) return;
    openRelatorioModal(item.id, false, item.relatorio, item.relatorio_submetido === 1, item.pecas_substituidas, item.horas_trabalho, item.assinatura_cliente, item._type);
};

// --- Assinatura Digital ---
let sigCanvas, sigCtx, isDrawing = false;
let sigCanvasTech, sigCtxTech, isDrawingTech = false;

function initSignaturePad() {
    // Cliente
    sigCanvas = document.getElementById('signature-pad');
    if (sigCanvas) {
        sigCtx = sigCanvas.getContext('2d');
        sigCtx.lineWidth = 2;
        sigCtx.lineCap = 'round';
        sigCtx.strokeStyle = '#000000';
        sigCanvas.addEventListener('mousedown', startDrawing);
        sigCanvas.addEventListener('mousemove', draw);
        sigCanvas.addEventListener('mouseup', stopDrawing);
        sigCanvas.addEventListener('mouseout', stopDrawing);
        sigCanvas.addEventListener('touchstart', startDrawing, { passive: false });
        sigCanvas.addEventListener('touchmove', draw, { passive: false });
        sigCanvas.addEventListener('touchend', stopDrawing);
        sigCanvas.addEventListener('touchcancel', stopDrawing);
        document.getElementById('btn-clear-signature').addEventListener('click', clearSignature);
    }

    // Técnico
    sigCanvasTech = document.getElementById('signature-pad-tech');
    if (sigCanvasTech) {
        sigCtxTech = sigCanvasTech.getContext('2d');
        sigCtxTech.lineWidth = 2;
        sigCtxTech.lineCap = 'round';
        sigCtxTech.strokeStyle = '#000000';
        sigCanvasTech.addEventListener('mousedown', startDrawingTech);
        sigCanvasTech.addEventListener('mousemove', drawTech);
        sigCanvasTech.addEventListener('mouseup', stopDrawingTech);
        sigCanvasTech.addEventListener('mouseout', stopDrawingTech);
        sigCanvasTech.addEventListener('touchstart', startDrawingTech, { passive: false });
        sigCanvasTech.addEventListener('touchmove', drawTech, { passive: false });
        sigCanvasTech.addEventListener('touchend', stopDrawingTech);
        sigCanvasTech.addEventListener('touchcancel', stopDrawingTech);
        document.getElementById('btn-clear-signature-tech').addEventListener('click', clearSignatureTech);
    }
}

// Lógica Cliente
function getPos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    const scaleX = sigCanvas.width / (rect.width || 1);
    const scaleY = sigCanvas.height / (rect.height || 1);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}
function startDrawing(e) {
    if (document.getElementById('relatorio-texto').disabled) return;
    if (e.cancelable) e.preventDefault();
    isDrawing = true;
    const pos = getPos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
}
function draw(e) {
    if (!isDrawing) return;
    if (e.type.includes('touch')) e.preventDefault();
    const pos = getPos(e);
    sigCtx.lineTo(pos.x, pos.y);
    sigCtx.stroke();
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
}
function stopDrawing() { isDrawing = false; sigCtx.beginPath(); }
function clearSignature() {
    if (!sigCanvas || !sigCtx) return;
    if (document.getElementById('relatorio-texto').disabled) return;
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
}

// Lógica Técnico
function getPosTech(e) {
    const rect = sigCanvasTech.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    const scaleX = sigCanvasTech.width / (rect.width || 1);
    const scaleY = sigCanvasTech.height / (rect.height || 1);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}
function startDrawingTech(e) {
    if (document.getElementById('relatorio-texto').disabled) return;
    if (e.cancelable) e.preventDefault();
    isDrawingTech = true;
    const pos = getPosTech(e);
    sigCtxTech.beginPath();
    sigCtxTech.moveTo(pos.x, pos.y);
}
function drawTech(e) {
    if (!isDrawingTech) return;
    if (e.type.includes('touch')) e.preventDefault();
    const pos = getPosTech(e);
    sigCtxTech.lineTo(pos.x, pos.y);
    sigCtxTech.stroke();
    sigCtxTech.beginPath();
    sigCtxTech.moveTo(pos.x, pos.y);
}
function stopDrawingTech() { isDrawingTech = false; sigCtxTech.beginPath(); }
function clearSignatureTech() {
    if (!sigCanvasTech || !sigCtxTech) return;
    if (document.getElementById('relatorio-texto').disabled) return;
    sigCtxTech.clearRect(0, 0, sigCanvasTech.width, sigCanvasTech.height);
}

function isCanvasBlank(canvas) {
    if (!canvas) return true;
    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    return canvas.toDataURL() === blank.toDataURL();
}

window.viewPDF = function (id, type = 'avaria') {
    window.open(`/relatorio.html?id=${id}&type=${type}`, '_blank');
};
async function loadAgendamentos() {
    try {
        const res = await authFetch(`${API_BASE}/tecnico/agendamentos`);
        const agendamentos = await res.json();
        const container = document.getElementById('agendamentos-container');
        container.innerHTML = '';

        if (agendamentos.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:20px;">Não tem intervenções agendadas para o futuro.</p>';
            return;
        }

        agendamentos.forEach(a => {
            const div = document.createElement('div');
            div.className = 'repair-item';
            div.style.borderLeft = `5px solid ${a.type === 'avaria' ? '#ef4444' : '#3b82f6'}`;

            const dateStr = new Date(a.data_agendada).toLocaleString('pt-PT', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                    <span style="font-size:11px; font-weight:700; background:var(--accent-light); color:var(--accent); padding:3px 8px; border-radius:4px;">
                        ${a.type === 'avaria' ? 'AVARIA' : 'SERVIÇO'}
                    </span>
                    <span style="font-size:12px; font-weight:700; color:var(--text-secondary);">${a.estado.toUpperCase()}</span>
                </div>
                <h3 style="margin-bottom:5px;">${escapeHTML(a.title)}</h3>
                <p style="font-size:14px; color:var(--text-secondary);">${escapeHTML(a.cliente_nome)}</p>
                <div style="margin-top:10px; font-weight:600; color:var(--accent); display:flex; align-items:center; gap:5px;">
                    <i class="ph ph-calendar-blank"></i> ${dateStr}
                </div>
                ${a.notas ? `<div style="margin-top:10px; padding:10px; background:var(--surface-color); border-radius:6px; font-size:13px;"><strong style="color:var(--text-main);">Notas:</strong><br>${escapeHTML(a.notas)}</div>` : ''}
            `;
            container.appendChild(div);
        });
    } catch (e) {
        showNotification("Erro ao carregar agendamentos.", true);
    }
}
