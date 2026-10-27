import { z } from 'zod';

export const WorkspaceRoomIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'workspaceId must be a valid MongoDB ObjectId');
export const CollaborationNodeIdSchema = z.string().trim().min(1).max(160);
export const CollaborationVectorSchema = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
});

export const WorkspaceJoinSchema = WorkspaceRoomIdSchema;
export const WorkspaceLeaveSchema = WorkspaceRoomIdSchema;

export const AgentPositionUpdateSchema = z.object({
    nodeId: CollaborationNodeIdSchema,
    position: CollaborationVectorSchema,
}).strict();

export const AgentMessageAddSchema = z.object({
    nodeId: CollaborationNodeIdSchema,
    message: z.unknown(),
}).strict();

export const AgentToggleMinimizeSchema = z.object({
    nodeId: CollaborationNodeIdSchema,
}).strict();

export const UserCursorUpdateSchema = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    userId: z.string().trim().min(1).max(160).optional(),
}).strict();

export type WorkspaceRoomId = z.infer<typeof WorkspaceRoomIdSchema>;
export type AgentPositionUpdate = z.infer<typeof AgentPositionUpdateSchema>;
export type AgentMessageAdd = z.infer<typeof AgentMessageAddSchema>;
export type AgentToggleMinimize = z.infer<typeof AgentToggleMinimizeSchema>;
export type UserCursorUpdate = z.infer<typeof UserCursorUpdateSchema>;