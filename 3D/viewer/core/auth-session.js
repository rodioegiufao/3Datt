const AUTH_ENDPOINT = "/api/auth";
const AUTH_TIMEOUT_MS = 4000;

export async function getViewerSession() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
    try {
        const response = await fetch(AUTH_ENDPOINT, {
            credentials: "same-origin",
            signal: controller.signal,
            headers: { Accept: "application/json" }
        });
        if (!response.ok) return null;
        const { user } = await response.json();
        return user || null;
    } finally {
        window.clearTimeout(timeout);
    }
}

export function redirectToLogin() {
    const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`/?login=necessario&redirect=${encodeURIComponent(destination)}`);
}