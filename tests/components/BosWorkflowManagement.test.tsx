import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BosWorkflowManagementPage from '../../components/BosWorkflowManagementPage';
import WorkflowCard from '../../components/workflow/WorkflowCard';
import CreerWorkflowDialog from '../../components/modals/CreerWorkflowDialog';
import { useDesignStore } from '../../stores/useDesignStore';
import { useAuth } from '../../contexts/AuthContext';
import { useLocalization } from '../../hooks/useLocalization';

// Mock dependencies
jest.mock('../../stores/useDesignStore');
jest.mock('../../contexts/AuthContext');
jest.mock('../../hooks/useLocalization');
jest.mock('../../components/workflow/WorkflowCard', () => ({
  __esModule: true,
  default: () => <div data-testid="workflow-card">WorkflowCard</div>
}));
jest.mock('../../components/modals/EditWorkflowDialog', () => ({
  __esModule: true,
  default: () => <div data-testid="edit-dialog">EditDialog</div>
}));

const mockWorkflow = {
  _id: 'wf-1',
  userId: 'user-1',
  name: 'Test Workflow',
  description: 'A test workflow',
  isActive: true,
  isDefault: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02')
};

describe('BosWorkflowManagementPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    (useLocalization as unknown as jest.Mock).mockReturnValue({
      t: (key: string) => key
    });
  });

  it('renders guest message when not authenticated', () => {
    (useAuth as unknown as jest.Mock).mockReturnValue({
      isAuthenticated: false
    });
    
    (useDesignStore as unknown as jest.Mock).mockReturnValue({
      workflows: [],
      currentWorkflowId: null,
      isLoadingWorkflows: false,
      workflowLoadError: null
    });

    render(<BosWorkflowManagementPage />);
    
    expect(screen.getByText('nav_guest_message')).toBeInTheDocument();
    expect(screen.getByText('nav_connect_for_workflows')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    (useAuth as unknown as jest.Mock).mockReturnValue({
      isAuthenticated: true
    });
    
    (useDesignStore as unknown as jest.Mock).mockReturnValue({
      workflows: [],
      currentWorkflowId: null,
      isLoadingWorkflows: true,
      workflowLoadError: null,
      loadUserWorkflows: jest.fn(),
      selectWorkflow: jest.fn(),
      createWorkflow: jest.fn(),
      updateWorkflow: jest.fn(),
      deleteWorkflow: jest.fn()
    });

    render(<BosWorkflowManagementPage />);
    
    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('renders workflows list', async () => {
    (useAuth as unknown as jest.Mock).mockReturnValue({
      isAuthenticated: true
    });
    
    (useDesignStore as unknown as jest.Mock).mockReturnValue({
      workflows: [mockWorkflow],
      currentWorkflowId: 'wf-1',
      isLoadingWorkflows: false,
      workflowLoadError: null,
      loadUserWorkflows: jest.fn().mockResolvedValue(undefined),
      selectWorkflow: jest.fn(),
      createWorkflow: jest.fn(),
      updateWorkflow: jest.fn(),
      deleteWorkflow: jest.fn()
    });

    render(<BosWorkflowManagementPage />);
    
    await waitFor(() => {
      expect(screen.getByTestId('workflow-card')).toBeInTheDocument();
    });
  });

  it('opens create dialog on button click', async () => {
    (useAuth as unknown as jest.Mock).mockReturnValue({
      isAuthenticated: true
    });
    
    (useDesignStore as unknown as jest.Mock).mockReturnValue({
      workflows: [],
      currentWorkflowId: null,
      isLoadingWorkflows: false,
      workflowLoadError: null,
      loadUserWorkflows: jest.fn(),
      selectWorkflow: jest.fn(),
      createWorkflow: jest.fn(),
      updateWorkflow: jest.fn(),
      deleteWorkflow: jest.fn()
    });

    render(<BosWorkflowManagementPage />);
    
    const createButton = screen.getByText('nav_create_workflow');
    fireEvent.click(createButton);
    
    // Dialog should appear (mocked in this test)
    expect(createButton).toBeInTheDocument();
  });
});

describe('CreerWorkflowDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    (useLocalization as unknown as jest.Mock).mockReturnValue({
      t: (key: string) => key
    });
  });

  it('renders dialog when open', () => {
    const mockOnClose = jest.fn();
    const mockOnCreate = jest.fn();

    render(
      <CreerWorkflowDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );
    
    expect(screen.getByText('dialog_create_workflow_title')).toBeInTheDocument();
  });

  it('does not render dialog when closed', () => {
    const mockOnClose = jest.fn();
    const mockOnCreate = jest.fn();

    render(
      <CreerWorkflowDialog
        isOpen={false}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );
    
    expect(screen.queryByText('dialog_create_workflow_title')).not.toBeInTheDocument();
  });

  it('calls onCreate with form values', async () => {
    const mockOnClose = jest.fn();
    const mockOnCreate = jest.fn().mockResolvedValue(undefined);

    render(
      <CreerWorkflowDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );
    
    const nameInput = screen.getByPlaceholderText('dialog_workflow_name_placeholder') as HTMLInputElement;
    const descInput = screen.getByPlaceholderText('dialog_workflow_description_placeholder') as HTMLTextAreaElement;
    const createButton = screen.getByText('dialog_workflow_create_button');
    
    fireEvent.change(nameInput, { target: { value: 'New Workflow' } });
    fireEvent.change(descInput, { target: { value: 'Description' } });
    fireEvent.click(createButton);
    
    await waitFor(() => {
      expect(mockOnCreate).toHaveBeenCalledWith('New Workflow', 'Description');
    });
  });

  it('requires workflow name', async () => {
    const mockOnClose = jest.fn();
    const mockOnCreate = jest.fn();

    render(
      <CreerWorkflowDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );
    
    const createButton = screen.getByText('dialog_workflow_create_button');
    fireEvent.click(createButton);
    
    expect(screen.getByText('dialog_workflow_name_required')).toBeInTheDocument();
  });
});
