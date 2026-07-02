import { expect, test } from '@playwright/test';

const REGISTER_BUTTON_RE = /Inscription|Register|Registrieren|Registrarse|Registrar-se|Зареєструватися/i;
const LOGIN_BUTTON_RE = /Connexion|Sign In|Anmelden|Iniciar Sesión|Fazer Login|Увійти/i;
const SETTINGS_BUTTON_RE = /Paramètres|Settings|Einstellungen|Configuración|Configurações|Налаштування/i;

async function describeTopElement(page: Parameters<typeof test>[1] extends never ? never : any, locatorText: string) {
  return page.evaluate((text) => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
    const target = candidates.find((element) => (element.innerText || '').trim().includes(text));
    if (!target) {
      return { targetFound: false };
    }

    const rect = target.getBoundingClientRect();
    const x = rect.left + (rect.width / 2);
    const y = rect.top + (rect.height / 2);
    const topElement = document.elementFromPoint(x, y) as HTMLElement | null;

    const formatElement = (element: HTMLElement | null) => {
      if (!element) {
        return null;
      }

      return {
        tag: element.tagName,
        className: element.className,
        id: element.id,
        text: (element.innerText || '').trim().slice(0, 120),
        pointerEvents: window.getComputedStyle(element).pointerEvents,
        position: window.getComputedStyle(element).position,
        zIndex: window.getComputedStyle(element).zIndex,
      };
    };

    return {
      targetFound: true,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      topElement: formatElement(topElement),
      targetElement: formatElement(target),
    };
  }, locatorText);
}

test.describe('Guest startup smoke', () => {
  test('guest shell stays clickable after startup', async ({ page }) => {
    await page.goto('/');

    const settingsButton = page.getByRole('button', { name: SETTINGS_BUTTON_RE });
    const loginButton = page.getByRole('button', { name: LOGIN_BUTTON_RE });
    const registerButton = page.getByRole('button', { name: REGISTER_BUTTON_RE });

    await expect(settingsButton).toBeVisible();
    await expect(loginButton).toBeVisible();
    await expect(registerButton).toBeVisible();

    await settingsButton.click({ trial: true, timeout: 5000 });
    await loginButton.click({ trial: true, timeout: 5000 });
    await registerButton.click({ trial: true, timeout: 5000 });

    await page.waitForTimeout(3000);

    const registerProbe = await describeTopElement(page, 'Inscription');
    console.log('[GuestStartup] Register probe:', JSON.stringify(registerProbe));

    await settingsButton.click({ trial: true, timeout: 5000 });
    await loginButton.click({ trial: true, timeout: 5000 });
    await registerButton.click({ trial: true, timeout: 5000 });
  });
});