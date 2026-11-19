import React from 'react';

import { render, screen } from '@testing-library/react';

import { RobotPageRouter } from '../../components/RobotPageRouter';

import { useLocalization } from '../../hooks/useLocalization';

import { useDesignStore } from '../../stores/useDesignStore';

jest.mock('../../hooks/useLocalization');
jest.mock('../../stores/useDesignStore');
jest.mock('../../components/WorkflowCanvas', () => ({
  __esModule: true,
  default: () => <div data-testid="workflow-canvas" />,
}));
jest.mock('../../components/workflow/WorkflowToolbar', () => ({
  __esModule: true,
  WorkflowToolbar: ({ className }: { className?: string }) => (
    <div data-testid="workflow-toolbar" className={className} />
  ),
}));
jest.mock('../../components/ArchiPrototypingPage', () => ({
  __esModule: true,
  ArchiPrototypingPage: () => <div data-testid="archi-page" />,
}));
jest.mock('../../components/modals/BosMediaModal', () => ({
  __esModule: true,
  default: () => null,
}));

describe('RobotPageRouter — WorkflowToolbar US-J7-13', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const designStoreState = {
      workflows: [{ _id: 'wf-1', name: 'Workflow Alpha' }],
      currentWorkflowId: 'wf-1',
    };

    (useLocalization as unknown as jest.Mock).mockReturnValue({
      t: (key: string, fallback?: string) => fallback || key,
    });

    (useDesignStore as unknown as jest.Mock).mockImplementation((selector?: (state: typeof designStoreState) => unknown) => (
      selector ? selector(designStoreState) : designStoreState
    ));
  });

  it.each(['/bos/dashboard', '/bos/supervision'])('monte la toolbar sur %s (le nom du workflow reste dans la toolbar, plus dans le header)', async (path) => {
    render(<RobotPageRouter currentPath={path} llmConfigs={[]} agents={[]} />);

    expect(await screen.findByTestId('workflow-toolbar')).toBeInTheDocument();
    // ⭐ retour graphique 2026-11-19 : le nom du workflow n'est plus dans le header (redondant avec la toolbar)
    expect(screen.queryByTestId('workflow-header-name')).toBeNull();
    expect(await screen.findByTestId('workflow-canvas')).toBeInTheDocument();
    // la toolbar est en flux (shrink-0), pas en overlay : le canvas reste dans le flux
    expect(screen.getByTestId('workflow-toolbar')).toHaveClass('shrink-0');
  });

  it('ne monte pas la toolbar sur la page archi', async () => {
    render(<RobotPageRouter currentPath="/archi" llmConfigs={[]} agents={[]} />);

    expect(await screen.findByTestId('archi-page')).toBeInTheDocument();
    expect(screen.queryByTestId('workflow-toolbar')).toBeNull();
    expect(screen.queryByTestId('workflow-header-name')).toBeNull();
  });

  it('sans workflow actif, la toolbar reste montée et le header ne porte aucun nom de workflow', async () => {
    (useDesignStore as unknown as jest.Mock).mockImplementation((selector?: (state: unknown) => unknown) => {
      const emptyState = { workflows: [], currentWorkflowId: null };
      return selector ? selector(emptyState) : emptyState;
    });

    render(<RobotPageRouter currentPath="/bos/dashboard" llmConfigs={[]} agents={[]} />);

    expect(await screen.findByTestId('workflow-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('workflow-header-name')).toBeNull();
  });
});
