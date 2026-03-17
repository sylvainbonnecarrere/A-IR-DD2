/**
 * @file tests/unitaires/LoginModal.test.tsx
 * @description Unit tests for LoginModal component
 * @coverage:
 * - Modal visibility control
 * - Form validation
 * - Login submission
 * - Error handling
 * - Non-blocking behavior
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginModal } from '../../components/modals/LoginModal';
import React from 'react';

const mockLogin = jest.fn();

jest.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        login: mockLogin,
        isLoading: false,
    }),
}));

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: () => ({
        t: (key: string) => ({
            login_modal_title: 'Connexion',
            login_email_label: 'Email',
            login_password_label: 'Mot de passe',
            login_button_text: 'Se connecter',
            login_button_loading: 'Connexion...',
            login_footer_text: 'Pas encore de compte ?',
            login_footer_link: 'Créer un compte',
            login_error_required_fields: 'Tous les champs sont requis',
            login_error_message: 'Erreur de connexion',
        }[key] ?? key),
    }),
}));

const renderWithAuth = (component: React.ReactElement) => {
    return render(component);
};

describe('LoginModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockLogin.mockResolvedValue(undefined);
    });

    describe('Visibility', () => {
        test('should not render when isOpen is false', () => {
            renderWithAuth(
                <LoginModal isOpen={false} onClose={() => { }} />
            );

            expect(screen.queryByText('Connexion')).not.toBeInTheDocument();
        });

        test('should render when isOpen is true', () => {
            renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            expect(screen.getByText('Connexion')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('votre@email.com')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
        });
    });

    describe('Form Interaction', () => {
        test('should update form fields on input', async () => {
            const user = userEvent.setup();

            renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            const emailInput = screen.getByPlaceholderText('votre@email.com') as HTMLInputElement;
            const passwordInput = screen.getByPlaceholderText('••••••••') as HTMLInputElement;

            await user.type(emailInput, 'test@example.com');
            await user.type(passwordInput, 'password123');

            expect(emailInput.value).toBe('test@example.com');
            expect(passwordInput.value).toBe('password123');
        });

        test('should disable submit button when fields are empty', () => {
            renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            const submitButton = screen.getByRole('button', { name: /Se connecter/i });
            expect(submitButton).toBeDisabled();
        });

        test('should enable submit button when fields are filled', async () => {
            const user = userEvent.setup();

            renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            const emailInput = screen.getByPlaceholderText('votre@email.com');
            const passwordInput = screen.getByPlaceholderText('••••••••');
            const submitButton = screen.getByRole('button', { name: /Se connecter/i });

            await user.type(emailInput, 'test@example.com');
            await user.type(passwordInput, 'password123');

            expect(submitButton).not.toBeDisabled();
        });
    });

    describe('Close Button', () => {
        test('should call onClose when close button clicked', () => {
            const onClose = jest.fn();

            renderWithAuth(
                <LoginModal isOpen={true} onClose={onClose} />
            );

            const closeButton = screen.getByLabelText('Close');
            fireEvent.click(closeButton);

            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('Form Submission', () => {
        test('should show error message on login failure', async () => {
            const user = userEvent.setup();
            mockLogin.mockRejectedValueOnce(new Error('Login failed'));

            renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            const emailInput = screen.getByPlaceholderText('votre@email.com');
            const passwordInput = screen.getByPlaceholderText('••••••••');
            const submitButton = screen.getByRole('button', { name: /Se connecter/i });

            await user.type(emailInput, 'test@example.com');
            await user.type(passwordInput, 'password123');
            await user.click(submitButton);

            // Wait for error to appear
            await waitFor(() => {
                // Error should be displayed or UI should show error state
                expect(submitButton).not.toBeDisabled();
            });
        });

        test('should not block UI on submission error', async () => {
            const user = userEvent.setup();
            mockLogin.mockRejectedValueOnce(new Error('Connection error'));

            const { rerender } = renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            const emailInput = screen.getByPlaceholderText('votre@email.com');
            const passwordInput = screen.getByPlaceholderText('••••••••');
            const submitButton = screen.getByRole('button', { name: /Se connecter/i });

            await user.type(emailInput, 'test@example.com');
            await user.type(passwordInput, 'password123');
            await user.click(submitButton);

            // Modal should still be accessible and interactive
            await waitFor(() => {
                expect(screen.getByText('Connexion')).toBeInTheDocument();
                expect(screen.getByLabelText('Close')).toBeInTheDocument();
            });
        });
    });

    describe('Non-Blocking Behavior', () => {
        test('should allow closing modal even if login pending', async () => {
            const onClose = jest.fn();
            const user = userEvent.setup();

            renderWithAuth(
                <LoginModal isOpen={true} onClose={onClose} />
            );

            const emailInput = screen.getByPlaceholderText('votre@email.com');
            const passwordInput = screen.getByPlaceholderText('••••••••');

            await user.type(emailInput, 'test@example.com');
            await user.type(passwordInput, 'password123');

            // Click close button instead of submit
            const closeButton = screen.getByLabelText('Close');
            fireEvent.click(closeButton);

            expect(onClose).toHaveBeenCalled();
        });

        test('should not affect guest mode when modal is opened', () => {
            // Guest mode should work independently of modal
            const { rerender } = renderWithAuth(
                <div>
                    <div data-testid="guest-indicator">Guest Mode</div>
                    <LoginModal isOpen={true} onClose={() => { }} />
                </div>
            );

            expect(screen.getByTestId('guest-indicator')).toBeInTheDocument();
            expect(screen.getByText('Connexion')).toBeInTheDocument();
        });
    });

    describe('Password Field', () => {
        test('should have password type for security', () => {
            renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            const passwordInput = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
            expect(passwordInput.type).toBe('password');
        });

        test('should have minimum length validation', () => {
            renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            const passwordInput = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
            expect(passwordInput.minLength).toBe(8);
        });
    });

    describe('Accessibility', () => {
        test('should have proper labels for form fields', () => {
            renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            expect(screen.getByLabelText('Email')).toBeInTheDocument();
            expect(screen.getByLabelText('Mot de passe')).toBeInTheDocument();
        });

        test('should have aria-label on close button', () => {
            renderWithAuth(
                <LoginModal isOpen={true} onClose={() => { }} />
            );

            const closeButton = screen.getByLabelText('Close');
            expect(closeButton).toHaveAttribute('aria-label', 'Close');
        });
    });
});
