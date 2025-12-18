export interface EventEnvelope<T = any> {
  id: string;
  type: string;
  source: string;
  tenantId: string;
  time: string;
  schemaVersion: '1';
  traceId?: string;
  data: T;
}


