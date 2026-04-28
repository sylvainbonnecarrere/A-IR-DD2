import { authSessionStorage, AUTH_STORAGE_KEY } from '../../utils/authSessionStorage';

const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value.toString();
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
});

describe('authSessionStorage', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.restoreAllMocks();
    });

    test('returns missing when no auth payload is stored', () => {
        expect(authSessionStorage.read()).toEqual({ status: 'missing' });
    });

    test('writes and reads a valid auth payload', () => {
        const payload = {
            user: { id: 'user-1', email: 'test@example.com', role: 'user' as const },
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
        };

        authSessionStorage.write(payload);

        expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe(JSON.stringify(payload));
        expect(authSessionStorage.read()).toEqual({ status: 'ok', data: payload });
    });

    test('returns invalid when the stored payload cannot be parsed', () => {
        localStorage.setItem(AUTH_STORAGE_KEY, '{invalid-json');

        expect(authSessionStorage.read()).toEqual({ status: 'invalid' });
    });

    test('returns invalid when storage access throws', () => {
        const getItemSpy = jest.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
            throw new Error('Storage read error');
        });

        expect(authSessionStorage.read()).toEqual({ status: 'invalid' });

        getItemSpy.mockRestore();
    });

    test('clears the stored auth payload', () => {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accessToken: 'a', refreshToken: 'r' }));

        authSessionStorage.clear();

        expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    });
});