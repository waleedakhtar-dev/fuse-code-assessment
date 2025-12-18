import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ConfirmOrderDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  totalCents!: number;
}


