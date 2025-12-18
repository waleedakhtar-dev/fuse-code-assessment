import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderStatus } from './order.entity';
import { Outbox } from './outbox.entity';
import { EventsPublisher } from '../../events/events.publisher';
import { DomainHttpException } from '../../common/errors/error-response';
import { HttpStatus } from '@nestjs/common';

interface IdempotencyStore {
  get(
    tenantId: string,
    key: string,
  ): Promise<{ bodyHash: string; response: any } | null>;
  set(
    tenantId: string,
    key: string,
    bodyHash: string,
    response: any,
  ): Promise<void>;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    @InjectRepository(Outbox)
    private readonly outboxRepo: Repository<Outbox>,
    private readonly dataSource: DataSource,
    private readonly eventsPublisher: EventsPublisher,
  ) {}

  // Idempotency will be wired from module using Redis client
  private idempotencyStore!: IdempotencyStore;

  setIdempotencyStore(store: IdempotencyStore) {
    this.idempotencyStore = store;
  }

  private hashBody(body: any): string {
    return JSON.stringify(body ?? {});
  }

  async createDraft(
    tenantId: string,
    idempotencyKey: string,
    body: any,
    traceId?: string,
  ) {
    const bodyHash = this.hashBody(body);
    const existing = await this.idempotencyStore.get(tenantId, idempotencyKey);
    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        throw new DomainHttpException(
          'IDEMPOTENCY_KEY_CONFLICT',
          'Idempotency key already used with different request body',
          HttpStatus.CONFLICT,
          '/api/v1/orders',
        );
      }
      return existing.response;
    }

    const order = this.ordersRepo.create({
      tenantId,
      status: 'draft',
      version: 1,
      totalCents: null,
    });
    await this.ordersRepo.save(order);

    const response = {
      id: order.id,
      tenantId: order.tenantId,
      status: order.status,
      version: order.version,
      createdAt: order.createdAt.toISOString(),
    };

    await this.idempotencyStore.set(
      tenantId,
      idempotencyKey,
      bodyHash,
      response,
    );

    await this.eventsPublisher.publish(
      'orders.created',
      tenantId,
      {
        orderId: order.id,
        tenantId: order.tenantId,
        createdAt: order.createdAt.toISOString(),
      },
      traceId,
    );

    return response;
  }

  async confirmOrder(
    id: string,
    tenantId: string,
    expectedVersion: number,
    totalCents: number,
    traceId?: string,
  ) {
    const order = await this.ordersRepo.findOne({
      where: { id, tenantId },
    });
    if (!order) {
      throw new DomainHttpException(
        'ORDER_NOT_FOUND',
        `Order with ID ${id} not found`,
        HttpStatus.NOT_FOUND,
        `/api/v1/orders/${id}/confirm`,
        { orderId: id },
      );
    }

    if (order.version !== expectedVersion) {
      throw new DomainHttpException(
        'ORDER_VERSION_CONFLICT',
        'Order version is stale',
        HttpStatus.CONFLICT,
        `/api/v1/orders/${id}/confirm`,
        { currentVersion: order.version, expectedVersion },
      );
    }

    if (order.status !== 'draft') {
      throw new DomainHttpException(
        'ORDER_STATUS_INVALID',
        'Only draft orders can be confirmed',
        HttpStatus.BAD_REQUEST,
        `/api/v1/orders/${id}/confirm`,
        { status: order.status },
      );
    }

    order.status = 'confirmed';
    order.totalCents = totalCents;
    order.version += 1;
    await this.ordersRepo.save(order);

    await this.eventsPublisher.publish(
      'orders.confirmed',
      tenantId,
      {
        orderId: order.id,
        tenantId: order.tenantId,
        totalCents: order.totalCents,
        version: order.version,
      },
      traceId,
    );

    return {
      id: order.id,
      status: order.status as OrderStatus,
      version: order.version,
      totalCents: order.totalCents,
    };
  }

  async closeOrder(
    id: string,
    tenantId: string,
    traceId?: string,
  ): Promise<{ id: string; status: OrderStatus; version: number }> {
    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(Order);
      const outboxRepo = manager.getRepository(Outbox);

      const order = await orderRepo.findOne({
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        throw new DomainHttpException(
          'ORDER_NOT_FOUND',
          `Order with ID ${id} not found`,
          HttpStatus.NOT_FOUND,
          `/api/v1/orders/${id}/close`,
          { orderId: id },
        );
      }

      if (order.status !== 'confirmed') {
        throw new DomainHttpException(
          'ORDER_STATUS_INVALID',
          'Only confirmed orders can be closed',
          HttpStatus.BAD_REQUEST,
          `/api/v1/orders/${id}/close`,
          { status: order.status },
        );
      }

      order.status = 'closed';
      order.version += 1;
      await orderRepo.save(order);

      const closedAt = new Date();
      const outbox = outboxRepo.create({
        eventType: 'orders.closed',
        orderId: order.id,
        tenantId: order.tenantId,
        payload: {
          orderId: order.id,
          tenantId: order.tenantId,
          totalCents: order.totalCents,
          closedAt: closedAt.toISOString(),
        },
        publishedAt: null,
      });
      await outboxRepo.save(outbox);

      await this.eventsPublisher.publish(
        'orders.closed',
        tenantId,
        {
          orderId: order.id,
          tenantId: order.tenantId,
          totalCents: order.totalCents,
          closedAt: closedAt.toISOString(),
        },
        traceId,
      );

      return {
        id: order.id,
        status: order.status as OrderStatus,
        version: order.version,
      };
    });
  }

  async listOrders(
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: any[]; nextCursor?: string }> {
    const realLimit = limit || 20;
    let createdAt: Date | null = null;
    let id: string | null = null;
    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded) as { createdAt: string; id: string };
      createdAt = new Date(parsed.createdAt);
      id = parsed.id;
    }

    const qb = this.ordersRepo
      .createQueryBuilder('o')
      .where('o.tenant_id = :tenantId', { tenantId })
      .orderBy('o.created_at', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .limit(realLimit + 1);

    if (createdAt && id) {
      qb.andWhere(
        '(o.created_at < :createdAt OR (o.created_at = :createdAt AND o.id < :id))',
        { createdAt, id },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > realLimit;
    const slice = rows.slice(0, realLimit);

    const items = slice.map((o) => ({
      id: o.id,
      tenantId: o.tenantId,
      status: o.status,
      version: o.version,
      totalCents: o.totalCents,
      createdAt: o.createdAt.toISOString(),
    }));

    let nextCursor: string | undefined;
    if (hasMore) {
      const last = slice[slice.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        }),
      ).toString('base64');
    }

    return { items, nextCursor };
  }
}


