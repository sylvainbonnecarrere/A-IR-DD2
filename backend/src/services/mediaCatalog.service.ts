import { IMediaReference } from '../models/MediaReference.model';
import {
    CreateMediaReferenceFromJournalParams,
    MediaReferenceRepository,
} from '../repositories/MediaReferenceRepository';

export class MediaCatalogService {
    constructor(
        private readonly mediaReferenceRepository: MediaReferenceRepository = new MediaReferenceRepository(),
    ) {}

    async registerJournalMedia(params: CreateMediaReferenceFromJournalParams): Promise<IMediaReference> {
        return this.mediaReferenceRepository.createFromJournalMedia(params);
    }
}