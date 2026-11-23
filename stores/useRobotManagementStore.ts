import { create } from 'zustand';
import { RobotId } from '../types';

interface RobotManagementStore {
  activeInterface: RobotId;
  robotInterfaces: Record<
    RobotId,
    {
      isActive: boolean;
      lastUsed: string;
      capabilities: string[];
    }
  >;

  // Interface Management
  setActiveInterface: (robotId: RobotId) => void;
  getActiveInterface: () => RobotId;

  // Robot Status
  updateRobotStatus: (robotId: RobotId, status: Record<string, unknown>) => void;
  getRobotCapabilities: (robotId: RobotId) => string[];
}

export const useRobotManagementStore = create<RobotManagementStore>((set, get) => ({
  activeInterface: RobotId.Archi, // Default to Archi
  robotInterfaces: {
    [RobotId.Archi]: {
      isActive: true,
      lastUsed: new Date().toISOString(),
      capabilities: ['agent_creation', 'workflow_management', 'orchestration'],
    },
    [RobotId.Bos]: {
      isActive: false,
      lastUsed: '',
      capabilities: ['monitoring', 'supervision', 'cost_tracking'],
    },
    [RobotId.Com]: {
      isActive: false,
      lastUsed: '',
      capabilities: ['api_connections', 'authentication', 'integrations'],
    },
    [RobotId.Phil]: {
      isActive: false,
      lastUsed: '',
      capabilities: ['data_transformation', 'file_handling', 'validation'],
    },
    [RobotId.Tim]: {
      isActive: false,
      lastUsed: '',
      capabilities: ['event_triggers', 'scheduling', 'rate_limiting'],
    },
  },

  setActiveInterface: (robotId: RobotId) => {
    set((state) => ({
      activeInterface: robotId,
      robotInterfaces: {
        ...state.robotInterfaces,
        [robotId]: {
          ...state.robotInterfaces[robotId],
          isActive: true,
          lastUsed: new Date().toISOString(),
        },
      },
    }));
  },

  getActiveInterface: () => get().activeInterface,

  updateRobotStatus: (robotId: RobotId, status: Record<string, unknown>) => {
    set((state) => ({
      robotInterfaces: {
        ...state.robotInterfaces,
        [robotId]: {
          ...state.robotInterfaces[robotId],
          ...status,
        },
      },
    }));
  },

  getRobotCapabilities: (robotId: RobotId) => {
    return get().robotInterfaces[robotId]?.capabilities || [];
  },
}));
