// public/js/relatorio.js

const urlParams = new URLSearchParams(window.location.search);
const reportId = urlParams.get('id');
const reportType = urlParams.get('type') || 'avaria';

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

        const endpoint = reportType === 'servico' ? `/api/servicos/${reportId}/detalhes-relatorio` : `/api/avarias/${reportId}/detalhes-relatorio`;
        const res = await fetch(endpoint, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            let serverError = "";
            try {
                const errorData = await res.json();
                serverError = errorData.error || errorData.message || "";
            } catch (e) { }

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

    let interventionInfo = '';
    if (reportType === 'avaria') {
        interventionInfo = `
            <p><strong>Máquina:</strong> ${data.maquina_nome}</p>
            <p><strong>Tipo:</strong> ${data.tipo_avaria === 1 ? 'Elétrica' : (data.tipo_avaria === 3 ? 'Mecânica' : 'Outra')}</p>
        `;
    } else {
        interventionInfo = `
            <p><strong>Serviço:</strong> ${data.tipo_servico}</p>
            <p><strong>Camião:</strong> ${data.tipo_camiao}</p>
        `;
    }

    const html = `
        <header>
            <div class="logo-section" style="max-width: 180px; text-align: center;">
                <img src="/img/logo.png" alt="Maclau Logo" style="width: 100%; height: auto; margin-bottom: 2px;">
                <p style="font-size: 10px; line-height: 1.2;">Assistência Técnica Especializada</p>
                <p style="font-size: 10px; line-height: 1.2;">Manutenção Industrial e Comercial</p>
            </div>
            <div class="report-meta">
                <h2 style="font-size: 18px;">${data.relatorio_submetido === 1 ? 'Relatório de Intervenção' : '<span style="color: #ca8a04;">Relatório (Rascunho)</span>'}</h2>
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
                ${interventionInfo}
                <p><strong>Horas de Trabalho:</strong> ${(data.horas_trabalho !== null && data.horas_trabalho !== undefined && data.horas_trabalho !== '') ? data.horas_trabalho + 'h' : '---'}</p>
            </div>
        </div>

        ${data.notas ? `
        <div class="content-section" style="margin-bottom: 30px;">
            <h3><i class="ph ph-warning-circle"></i> Notas de Reporte (Admin)</h3>
            <div class="content-box" style="min-height: 50px;">${data.notas}</div>
        </div>
        ` : ''}

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

        ${data.fotos && data.fotos.length > 0 ? `
        <div style="page-break-before: always; padding-top: 20px;">
            <div class="header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--primary); padding-bottom: 20px; margin-bottom: 30px;">
                <div class="logo-section" style="max-width: 180px; text-align: center;">
                    <img src="/img/logo.png" alt="Maclau Logo" style="width: 100%; height: auto; margin-bottom: 2px;">
                    <p style="font-size: 10px; line-height: 1.2;">Assistência Técnica Especializada</p>
                    <p style="font-size: 10px; line-height: 1.2;">Manutenção Industrial e Comercial</p>
                </div>
                <div class="report-meta" style="text-align: right;">
                    <h2 style="font-size: 18px;">Fotos da Intervenção</h2>
                    <p>ID: #${data.id.toString().padStart(5, '0')}</p>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                ${data.fotos.map(f => `
                    <div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: white; break-inside: avoid; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <img src="${f.caminho}" style="width: 100%; height: 350px; object-fit: cover; display: block;">
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <footer style="margin-top: 50px;">
            <div class="signature-block">
                ${data.assinatura_tecnico 
                    ? `<img src="${data.assinatura_tecnico}" alt="Assinatura do Técnico" style="display:block; margin:0 auto; max-width:200px; max-height:80px;">` 
                    : `<div style="height:50px;"></div>`}
                <div class="signature-line"${data.assinatura_tecnico ? ' style="margin-top:5px; border-top-color:#94a3b8;"' : ''}>Técnico Responsável</div>
            </div>
            <div class="signature-block">
                ${data.assinatura_cliente 
                    ? `<img src="${data.assinatura_cliente}" alt="Assinatura do Cliente" style="display:block; margin:0 auto; max-width:200px; max-height:80px;">` 
                    : `<div style="height:50px;"></div>`}
                <div class="signature-line"${data.assinatura_cliente ? ' style="margin-top:5px; border-top-color:#94a3b8;"' : ''}>Assinatura do Cliente</div>
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
