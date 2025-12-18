import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';

@Entity({ name: 'outbox' })
export class Outbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_type', type: 'text' })
  @Index()
  eventType!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @Index()
  orderId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  @Index()
  tenantId!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, any>;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}


