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

export async function syncUserToolMirrorFromLegacyFunction(legacy: LegacyFunctionLike): Promise<void> {
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

export async function deleteUserToolMirror(functionId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(functionId)) {
        return;
    }

    await UserTool.deleteOne({ _id: new mongoose.Types.ObjectId(functionId) });
}