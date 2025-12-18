import { Injectable, Logger } from '@nestjs/common';
import { EventEnvelope } from './event-envelope';
import { v4 as uuid } from 'uuid';

@Injectable()
export class EventsPublisher {
  private readonly logger = new Logger(EventsPublisher.name);

  // In a real implementation, inject Apache Pulsar client; here we just log
  async publish<T>(
    type: string,
    tenantId: string,
    data: T,
    traceId?: string,
  ): Promise<EventEnvelope<T>> {
    const envelope: EventEnvelope<T> = {
      id: uuid(),
      type,
      source: 'orders-service',
      tenantId,
      time: new Date().toISOString(),
      schemaVersion: '1',
      traceId,
      data,
    };

    this.logger.log(
      `Publishing event ${type} for tenant ${tenantId}: ${JSON.stringify(
        envelope,
      )}`,
    );

    // Stub for Pulsar publish
    return envelope;
  }
}


