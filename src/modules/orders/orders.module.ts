import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './order.entity';
import { Outbox } from './outbox.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { EventsModule } from '../../events/events.module';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Outbox]), EventsModule],
  providers: [OrdersService],
  controllers: [OrdersController],
})
export class OrdersModule implements OnModuleInit {
  constructor(
    private readonly ordersService: OrdersService,
    @Inject('REDIS_CLIENT') private readonly redisClient: any,
  ) {}

  onModuleInit() {
    // expose redis globally for health checks
    (global as any).REDIS_CLIENT = this.redisClient;

    this.ordersService.setIdempotencyStore({
      get: async (tenantId: string, key: string) => {
        const raw = await this.redisClient.get(
          `idemp:${tenantId}:${key}`,
        );
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          bodyHash: string;
          response: any;
        };
        return parsed;
      },
      set: async (
        tenantId: string,
        key: string,
        bodyHash: string,
        response: any,
      ) => {
        const value = JSON.stringify({ bodyHash, response });
        await this.redisClient.set(
          `idemp:${tenantId}:${key}`,
          value,
          'EX',
          60 * 60,
        );
      },
    });
  }
}


