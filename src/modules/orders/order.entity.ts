import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type OrderStatus = 'draft' | 'confirmed' | 'closed';

@Entity({ name: 'orders' })
@Index(['tenantId', 'createdAt', 'id'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  @Index()
  tenantId!: string;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({ type: 'int' })
  version!: number;

  @Column({ name: 'total_cents', type: 'int', nullable: true })
  totalCents: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}


