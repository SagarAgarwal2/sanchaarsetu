import { simulateBackendBurst, simulateBackendEvent, simulateChangeDetected } from './api';

export async function simulateEvent(): Promise<void> {
  await simulateBackendEvent();
}

export async function simulateBurst(count = 8): Promise<void> {
  await simulateBackendBurst(count);
}

export async function simulateChange(payload: any): Promise<void> {
  await simulateChangeDetected(payload);
}
