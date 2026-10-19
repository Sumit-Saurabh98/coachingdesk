import { InMemoryEnrollmentRepository } from '../enrollment.repository';
import { describeEnrollmentRepositoryContract } from './enrollment-repository.contract';

describeEnrollmentRepositoryContract(
  'InMemoryEnrollmentRepository',
  () => new InMemoryEnrollmentRepository(),
);
