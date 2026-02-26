import { closeTestApp } from './test-app';

export default async function globalTeardown(): Promise<void> {
  await closeTestApp();
}
