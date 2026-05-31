import mongoose from 'mongoose';

export default class ArtifactRepository {
  private db: mongoose.Connection['db'];

  constructor() {
    this.db = mongoose.connection.db;
  }

  async saveArtifact(params: { workflowId?: string; instanceId?: string; path: string; kind: string; metadata?: Record<string, unknown> }) {
    const doc = {
      workflowId: params.workflowId ?? null,
      agentInstanceId: params.instanceId ?? null,
      path: params.path,
      kind: params.kind,
      metadata: params.metadata ?? {},
      createdAt: new Date(),
    } as any;

    const db = this.db as any;
    if (!db || !db.collection) throw new Error('Database connection not ready');
    await db.collection('media_references').insertOne(doc);
  }
}
