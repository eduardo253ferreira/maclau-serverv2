// public/js/relatorio.js

const urlParams = new URLSearchParams(window.location.search);
const reportId = urlParams.get('id');

async function loadReport() {
    const container = document.getElementById('report-content');
    if (!reportId) {
        container.innerHTML = '<div class="loader">Erro: ID da intervenção não fornecido na URL.</div>';
        return;
    }

    try {
        const token = localStorage.getItem('maclau_token');
        if (!token) {
            container.innerHTML = '<div class="loader">Erro: Sessão expirada ou não autenticado. Por favor, faça login novamente.</div>';
            return;
        }

        const res = await fetch(`/api/avarias/${reportId}/detalhes-relatorio`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            let serverError = "";
            try {
                const errorData = await res.json();
                serverError = errorData.error || errorData.message || "";
            } catch(e) {}
            
            const errorMsg = serverError || (res.status === 404 ? "Intervenção não encontrada." : `Erro ${res.status}: Problema no servidor.`);
            throw new Error(errorMsg);
        }

        const data = await res.json();
        renderReport(data);
    } catch (err) {
        console.error("Erro no Relatório:", err);
        container.innerHTML = `
            <div style="text-align:center; padding: 50px; color: #ef4444;">
                <i class="ph ph-warning-circle" style="font-size: 48px;"></i>
                <p style="margin-top:15px; font-weight:600;">Ocorreu um erro</p>
                <p style="font-size:14px; opacity:0.8;">${err.message}</p>
            </div>
        `;
    }
}

function renderReport(data) {
    const dateObj = new Date(data.data_hora_fim || data.data_hora);
    const dateStr = dateObj.toLocaleDateString('pt-PT');
    
    const html = `
        <header>
            <div class="logo-section" style="max-width: 180px; text-align: center;">
                <img src="/img/logo.png" alt="Maclau Logo" style="width: 100%; height: auto; margin-bottom: 2px;">
                <p style="font-size: 10px; line-height: 1.2;">Assistência Técnica Especializada</p>
                <p style="font-size: 10px; line-height: 1.2;">Manutenção Industrial e Comercial</p>
            </div>
            <div class="report-meta">
                <h2 style="font-size: 18px;">Relatório de Intervencão</h2>
                <p>ID: #${data.id.toString().padStart(5, '0')}</p>
                <p>Data: ${dateStr}</p>
            </div>
        </header>

        <div class="section-grid" style="margin-bottom: 20px; gap: 20px;">
            <div class="info-block">
                <h3><i class="ph ph-user"></i> Cliente</h3>
                <p><strong>${data.cliente_nome}</strong></p>
                <p>${data.cliente_email || 'Email não especificado'}</p>
                <p>${data.cliente_contato || 'Telefone não disponível'}</p>
            </div>
            <div class="info-block">
                <h3><i class="ph ph-wrench"></i> Intervenção</h3>
                <p><strong>Técnico:</strong> ${data.tecnico_nome}</p>
                <p><strong>Máquina:</strong> ${data.maquina_nome}</p>
                <p><strong>Tipo:</strong> ${data.tipo_avaria === 1 ? 'Elétrica' : (data.tipo_avaria === 3 ? 'Mecânica' : 'Outra')}</p>
                <p><strong>Horas de Trabalho:</strong> ${(data.horas_trabalho !== null && data.horas_trabalho !== undefined && data.horas_trabalho !== '') ? data.horas_trabalho + 'h' : '---'}</p>
            </div>
        </div>

        <div class="content-section" style="margin-bottom: 30px;">
            <h3><i class="ph ph-clipboard-text"></i> Descrição da Intervenção</h3>
            <div class="content-box" style="min-height: 80px;">${data.relatorio || 'Nenhuma descrição detalhada fornecida.'}</div>
        </div>

        ${data.pecas_substituidas ? `
        <div class="content-section" style="margin-bottom: 30px;">
            <h3><i class="ph ph-package"></i> Peças Substituídas</h3>
            <div class="content-box" style="min-height: 50px;">${data.pecas_substituidas}</div>
        </div>
        ` : ''}

        <footer>
            <div class="signature-block">
                <div class="signature-line">Assinatura do Técnico</div>
            </div>
            <div class="signature-block">
                <div class="signature-line">Assinatura do Cliente</div>
            </div>
        </footer>
    `;

    document.getElementById('report-content').innerHTML = html;
}

window.onload = () => {
    loadReport();

    document.getElementById('btn-print').addEventListener('click', () => window.print());
    document.getElementById('btn-close').addEventListener('click', () => window.close());
};
