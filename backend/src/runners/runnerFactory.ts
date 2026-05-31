import { IRunner } from '../types/webFetchTypes';
import NativeRunner from './nativeRunner';

export class RunnerFactory {
  static create(runnerType: 'native' | 'docker' = 'native'): IRunner {
    if (runnerType === 'native') {
      return new NativeRunner(process.env.PYTHON_EXECUTABLE || 'python3');
    }

    // fallback placeholder - docker runner not implemented yet
    throw new Error('DockerRunner not implemented - feature-flag or fallback required');
  }
}

export default RunnerFactory;
