import mongoose from 'mongoose';
import { UserTool } from '../models/UserTool.model';
import { LegacyFunctionLike, mapLegacyFunctionToUserToolFields } from '../utils/userToolLegacyMapper';

function getLegacyFunctionId(legacy: LegacyFunctionLike): mongoose.Types.ObjectId {
    if (!legacy._id) {
        throw new Error('Cannot sync legacy function without _id');
    }

    const value = legacy._id instanceof mongoose.Types.ObjectId
        ? legacy._id
        : new mongoose.Types.ObjectId(String(legacy._id));

    return value;
}

export class LegacyFunctionToolProjectionService {
    async upsertFromLegacyFunction(legacy: LegacyFunctionLike): Promise<void> {
        const legacyId = getLegacyFunctionId(legacy);
        const existingTool = await UserTool.findById(legacyId).lean();
        const fields = mapLegacyFunctionToUserToolFields(legacy, existingTool);
        const createdAt = legacy.createdAt instanceof Date ? legacy.createdAt : new Date(legacy.createdAt ?? Date.now());
        const updatedAt = legacy.updatedAt instanceof Date ? legacy.updatedAt : new Date(legacy.updatedAt ?? Date.now());

        await UserTool.updateOne(
            { _id: legacyId },
            {
                $set: {
                    ...fields,
                    updatedAt
                },
                $setOnInsert: {
                    createdAt
                }
            },
            { upsert: true }
        );
    }

    async deleteByLegacyFunctionId(functionId: string): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) {
            return;
        }

        await UserTool.deleteOne({ _id: new mongoose.Types.ObjectId(functionId) });
    }
}

export const legacyFunctionToolProjectionService = new LegacyFunctionToolProjectionService();

// Compatibility wrappers kept only for tests and the contained legacy service.
export async function syncUserToolMirrorFromLegacyFunction(legacy: LegacyFunctionLike): Promise<void> {
    return legacyFunctionToolProjectionService.upsertFromLegacyFunction(legacy);
}

export async function deleteUserToolMirror(functionId: string): Promise<void> {
    return legacyFunctionToolProjectionService.deleteByLegacyFunctionId(functionId);
}