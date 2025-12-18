import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './modules/health/health.module';
import { OrdersModule } from './modules/orders/orders.module';
import { RedisModule } from './config/redis.module';
import { TenantModule } from './tenant/tenant.module';
import { EventsModule } from './events/events.module';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import { Order } from './modules/orders/order.entity';
import { Outbox } from './modules/orders/outbox.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USER || 'orders',
        password: process.env.DB_PASSWORD || 'orders',
        database: process.env.DB_NAME || 'orders',
        entities: [Order, Outbox],
        synchronize: false,
      }),
    }),
    RedisModule,
    TenantModule,
    EventsModule,
    OrdersModule,
    HealthModule,
  ],
})
export class AppModule {}


