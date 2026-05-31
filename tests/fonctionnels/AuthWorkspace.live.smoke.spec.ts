import { expect, test } from '@playwright/test';

const REGISTER_BUTTON_RE = /Inscription|Register|Registrieren|Registrarse|Registrar-se|Зареєструватися/i;
const LOGIN_BUTTON_RE = /Connexion|Sign In|Anmelden|Iniciar Sesión|Fazer Login|Увійти/i;
const LOGOUT_BUTTON_RE = /Déconnexion|Sign Out|Abmelden|Cerrar Sesión|Sair|Вийти/i;
const REGISTER_SUBMIT_BUTTON_RE = /S'inscrire|Sign Up|Registrieren|Registrarse|Registrar-se|Зареєструватися/i;
const LOGIN_SUBMIT_BUTTON_RE = /Se connecter|Sign In|Anmelden|Iniciar Sesión|Fazer Login|Увійти/i;
const PASSWORD = 'Password123';
const GUEST_MARKER_KEY = 'guest_workflow_v1';

type StoredAuthData = {
    user: {
        id: string;
        email: string;
    };
    accessToken: string;
    refreshToken: string;
};

function buildQaEmail(): string {
    const stamp = Date.now();
    const suffix = Math.random().toString(36).slice(2, 8);
    return `live-smoke-${stamp}-${suffix}@test.com`;
}

test.describe('Live backend/browser smoke', () => {
    test('registers, purges guest state, logs back in, hydrates workspace, and survives reload', async ({ page, request }) => {
        const email = buildQaEmail();
        const registerModal = page.locator('div[role="dialog"], div.fixed.inset-0.z-50').last();

        await page.addInitScript(([guestMarkerKey]) => {
            window.localStorage.setItem(guestMarkerKey, JSON.stringify({ id: 'guest-workflow-marker' }));
        }, [GUEST_MARKER_KEY]);

        await page.goto('/');

        await page.getByRole('button', { name: REGISTER_BUTTON_RE }).click();
        await page.locator('#register-email').fill(email);
        await page.locator('#register-password').fill(PASSWORD);
        await page.locator('#register-confirm-password').fill(PASSWORD);
        await registerModal.getByRole('button', { name: REGISTER_SUBMIT_BUTTON_RE }).click();

        await expect(page.getByText(email)).toBeVisible();

        const postRegisterState = await page.evaluate(([guestMarkerKey]) => {
            return {
                authData: window.localStorage.getItem('auth_data_v1'),
                guestMarker: window.localStorage.getItem(guestMarkerKey),
            };
        }, [GUEST_MARKER_KEY]);

        expect(postRegisterState.authData).toBeTruthy();
        expect(postRegisterState.guestMarker).toBeNull();

        await page.getByRole('button', { name: LOGOUT_BUTTON_RE }).click();
        await expect(page.getByRole('button', { name: LOGIN_BUTTON_RE })).toBeVisible();

        await page.getByRole('button', { name: LOGIN_BUTTON_RE }).click();
        await page.locator('#login-email').fill(email);
        await page.locator('#login-password').fill(PASSWORD);
        await page.locator('div.fixed.inset-0.z-50').last().getByRole('button', { name: LOGIN_SUBMIT_BUTTON_RE }).click();

        await expect(page.getByText(email)).toBeVisible();

        const authData = await page.evaluate(() => {
            const raw = window.localStorage.getItem('auth_data_v1');
            return raw ? JSON.parse(raw) as StoredAuthData : null;
        });

        expect(authData).not.toBeNull();
        expect(authData?.user.email).toBe(email);

        const refreshResponse = await request.post('http://127.0.0.1:3001/api/auth/refresh', {
            data: { refreshToken: authData!.refreshToken },
        });
        expect(refreshResponse.ok()).toBeTruthy();

        const workspaceResponse = await request.get('http://127.0.0.1:3001/api/user/workspace', {
            headers: {
                Authorization: `Bearer ${authData!.accessToken}`,
            },
        });
        expect(workspaceResponse.ok()).toBeTruthy();

        const workspacePayload = await workspaceResponse.json();
        expect(workspacePayload.metadata?.hasWorkflow).toBe(true);
        expect(String(workspacePayload.workflow?.id ?? workspacePayload.workflow?._id ?? '')).not.toBe('');

        await page.reload();
        await expect(page.getByText(email)).toBeVisible();
    });
});