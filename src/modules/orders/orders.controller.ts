import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { TenantGuard } from '../../tenant/tenant.guard';
import { Tenant } from '../../tenant/tenant.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { ConfirmOrderDto } from './dto/confirm-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.dto';

@UseGuards(TenantGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async createDraft(
    @Tenant() tenantId: string,
    @Body() body: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('x-request-id') traceId?: string,
  ) {
    return this.ordersService.createDraft(
      tenantId,
      idempotencyKey,
      body,
      traceId,
    );
  }

  @Patch(':id/confirm')
  async confirm(
    @Param('id') id: string,
    @Tenant() tenantId: string,
    @Body() body: ConfirmOrderDto,
    @Headers('if-match') ifMatch: string,
    @Headers('x-request-id') traceId?: string,
  ) {
    const version = parseInt(ifMatch.replace(/"/g, ''), 10);
    return this.ordersService.confirmOrder(
      id,
      tenantId,
      version,
      body.totalCents,
      traceId,
    );
  }

  @Post(':id/close')
  async close(
    @Param('id') id: string,
    @Tenant() tenantId: string,
    @Headers('x-request-id') traceId?: string,
  ) {
    return this.ordersService.closeOrder(id, tenantId, traceId);
  }

  @Get()
  async list(
    @Tenant() tenantId: string,
    @Query() query: ListOrdersQueryDto,
  ) {
    const limit = query.limit ?? 20;
    return this.ordersService.listOrders(tenantId, limit, query.cursor);
  }
}


