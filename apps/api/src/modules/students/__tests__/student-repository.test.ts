import { InMemoryStudentRepository } from '../student.repository';
import { describeStudentRepositoryContract } from './student-repository.contract';

describeStudentRepositoryContract(
  'InMemoryStudentRepository',
  () => new InMemoryStudentRepository(),
);
