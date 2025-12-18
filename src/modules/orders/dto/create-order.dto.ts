import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty({ description: 'Reserved for future fields' })
  readonly dummy?: string;
}


