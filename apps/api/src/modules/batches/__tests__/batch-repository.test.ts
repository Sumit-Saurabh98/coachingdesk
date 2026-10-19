import { InMemoryBatchRepository } from '../batch.repository';
import { describeBatchRepositoryContract } from './batch-repository.contract';

describeBatchRepositoryContract('InMemoryBatchRepository', () => new InMemoryBatchRepository());
