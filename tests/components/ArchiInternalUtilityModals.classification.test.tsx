import React from 'react';
import { render, screen } from '@testing-library/react';
import { GovernanceTestModal } from '../../components/modals/GovernanceTestModal';
import { TodoModal } from '../../components/modals/TodoModal';

jest.mock('../../services/governanceService', () => ({
  useGovernance: () => ({
    validateOperation: () => ({ isValid: true }),
    canCreate: () => true,
    canModify: () => true,
    canDelete: () => true,
    getErrorMessage: () => 'Erreur',
  }),
}));

describe('Archi internal utility modals classification', () => {
  it('labels the governance test modal as an internal provisional tool', () => {
    render(<GovernanceTestModal isOpen={true} onClose={() => undefined} />);

    expect(screen.getByText('Test de Gouvernance V2 - Interne')).toBeInTheDocument();
    expect(screen.getByText('Outil interne / surface provisoire')).toBeInTheDocument();
    expect(screen.getByText(/avant industrialisation produit/i)).toBeInTheDocument();
  });

  it('labels the todo modal as an internal provisional tool with local-only state', () => {
    render(<TodoModal isOpen={true} onClose={() => undefined} />);

    expect(screen.getByText('Gestionnaire de Taches - Interne')).toBeInTheDocument();
    expect(screen.getByText('Outil interne / surface provisoire')).toBeInTheDocument();
    expect(screen.getByText(/locales a cette session UI/i)).toBeInTheDocument();
    expect(screen.getByText(/ni persistees ni synchronisees/i)).toBeInTheDocument();
  });
});