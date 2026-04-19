// public/js/login.js
console.log("[MACLAU] Login script loaded");

// Verificação de sessão expirada: se o servidor nos mandou de volta com ?expired=1, limpamos o lixo local
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('expired')) {
    console.log("[MACLAU] Session expired or invalid code. Clearing local state.");
    localStorage.removeItem('maclau_token');
    localStorage.removeItem('maclau_role');
    localStorage.removeItem('maclau_user_id');
}

function initLogin() {
    console.log("[MACLAU] Initializing login form listener");
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log("[MACLAU] Login form submitted");
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                console.log("[MACLAU] Sending login request to /api/auth/login...");
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                console.log("[MACLAU] Server response status:", res.status);
                
                let data;
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    data = await res.json();
                } else {
                    const text = await res.text();
                    console.error("[MACLAU] Expected JSON but got:", text.substring(0, 100));
                    throw new Error("Resposta inválida do servidor (não é JSON).");
                }

                if (!res.ok) {
                    console.warn("[MACLAU] Login failed:", data.error);
                    showNotification(data.error || 'Erro ao efetuar login');
                    return;
                }

                console.log("[MACLAU] Login successful, redirecting to:", data.redirectUrl);
                localStorage.setItem('maclau_token', data.accessToken);
                localStorage.setItem('maclau_role', data.role);
                
                // Pequeno atraso para garantir que o utilizador vê a mensagem de sucesso se necessário
                // ou apenas procede para o redirect
                window.location.href = data.redirectUrl;

            } catch (err) {
                console.error("[MACLAU] Login error details:", err);
                showNotification('Erro de ligação ao servidor. Verifique a consola para detalhes.');
            }
        });
    } else {
        console.error("[MACLAU] Login form not found!");
    }
}

// Ensure init runs even if loaded late
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogin);
} else {
    initLogin();
}

function showNotification(msg) {
    const notif = document.getElementById('notification');
    if (!notif) return;
    notif.textContent = msg;
    notif.classList.remove('hidden');
    setTimeout(() => notif.classList.add('hidden'), 3000);
}
