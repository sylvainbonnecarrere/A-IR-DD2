import { z } from 'zod';

export const CANONICAL_ROBOT_IDS = ['AR_001', 'BO_002', 'CO_003', 'PH_004', 'TI_005'] as const;

export type CanonicalRobotId = (typeof CANONICAL_ROBOT_IDS)[number];

export const DEFAULT_ROBOT_ID: CanonicalRobotId = 'AR_001';

export const CANONICAL_ROBOT_IDS_LABEL = CANONICAL_ROBOT_IDS.join(', ');

export const CanonicalRobotIdEnum = z.enum(CANONICAL_ROBOT_IDS);