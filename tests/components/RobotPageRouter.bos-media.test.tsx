import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RobotPageRouter } from '../../components/RobotPageRouter';
import { useLocalization } from '../../hooks/useLocalization';
import { useDesignStore } from '../../stores/useDesignStore';

jest.mock('../../hooks/useLocalization');
jest.mock('../../stores/useDesignStore');
jest.mock('../../components/WorkflowCanvas', () => ({
  __esModule: true,
  default: () => <div data-testid="workflow-canvas" />,
}));
jest.mock('../../components/modals/BosMediaModal', () => ({
  __esModule: true,
  default: ({ isOpen, workflowId, workflowName }: { isOpen: boolean; workflowId: string | null; workflowName?: string | null }) => (
    isOpen ? <div data-testid="bos-media-modal">{`${workflowId}:${workflowName}`}</div> : null
  ),
}));

describe('RobotPageRouter BOS media button', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const designStoreState = {
      workflows: [
        {
          _id: 'wf-1',
          name: 'Workflow Alpha',
        },
      ],
      currentWorkflowId: 'wf-1',
    };

    (useLocalization as unknown as jest.Mock).mockReturnValue({
      t: (key: string, fallback?: string) => fallback || key,
    });

    (useDesignStore as unknown as jest.Mock).mockImplementation((selector?: (state: typeof designStoreState) => unknown) => (
      selector ? selector(designStoreState) : designStoreState
    ));
  });

  it('shows the media button on the BOS workflow map and opens the modal for the active workflow', async () => {
    render(
      <RobotPageRouter
        currentPath="/bos/dashboard"
        llmConfigs={[]}
        agents={[]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Gestion des fichiers' })).toBeInTheDocument();
    expect(await screen.findByTestId('workflow-canvas')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Gestion des fichiers' }));

    expect(await screen.findByTestId('bos-media-modal')).toHaveTextContent('wf-1:Workflow Alpha');
  });
});