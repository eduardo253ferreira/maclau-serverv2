// public/js/report.js

const urlParams = new URLSearchParams(window.location.search);
const machineUUID = urlParams.get('machine');

const API_BASE = '/api/public';

// Elementos da UIs
const loader = document.getElementById('loader');
const reportView = document.getElementById('report-view');
const successView = document.getElementById('success-view');
const errorView = document.getElementById('error-view');
const machineNameEl = document.getElementById('machine-name');
const errorMessageEl = document.getElementById('error-message');

async function loadMachineInfo() {
    if (!machineUUID) {
        showError("Nenhum código de máquina foi fornecido no endereço.");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/maquinas/${machineUUID}`);
        if (!response.ok) {
            throw new Error("A máquina não foi encontrada.");
        }
        const data = await response.json();
        
        // Hide loader & Show report view
        loader.classList.add('hidden');
        machineNameEl.textContent = data.nome;
        reportView.classList.remove('hidden');

    } catch (e) {
        showError(e.message);
    }
}

async function submitAvaria(tipo) {
    if (!machineUUID) return;

    // Desabilitar botões
    const btns = document.querySelectorAll('.btn-avaria');
    btns.forEach(b => { b.disabled = true; b.style.opacity = '0.7'; });

    try {
        const response = await fetch(`${API_BASE}/avarias`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maquina_id: machineUUID, tipo_avaria: tipo })
        });

        if (!response.ok) {
            throw new Error("Erro ao reportar. Tente novamente.");
        }
        
        reportView.classList.add('hidden');
        successView.classList.remove('hidden');

    } catch (e) {
        alert(e.message);
        btns.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
    }
}

function showError(msg) {
    loader.classList.add('hidden');
    errorMessageEl.textContent = msg;
    errorView.classList.remove('hidden');
}

// Iniciar app
window.onload = () => {
    loadMachineInfo();

    // CSP Listeners
    document.querySelectorAll('.btn-avaria').forEach(btn => {
        btn.addEventListener('click', () => {
            const tipo = parseInt(btn.getAttribute('data-tipo'));
            if (tipo) submitAvaria(tipo);
        });
    });
};
