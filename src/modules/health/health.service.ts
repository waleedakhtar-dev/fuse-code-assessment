import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getReadiness() {
    const result: {
      status: 'ready' | 'not_ready';
      checks: { database: 'up' | 'down'; redis: 'up' | 'down' };
    } = {
      status: 'not_ready',
      checks: { database: 'down', redis: 'down' },
    };

    try {
      await this.dataSource.query('SELECT 1');
      result.checks.database = 'up';
    } catch {
      result.checks.database = 'down';
    }

    try {
      // simple ping using global token; we don't want to depend on Nest injection here
      const redis = (global as any).REDIS_CLIENT as {
        ping: () => Promise<string>;
      } | null;
      if (redis) {
        await redis.ping();
        result.checks.redis = 'up';
      } else {
        result.checks.redis = 'down';
      }
    } catch {
      result.checks.redis = 'down';
    }

    result.status =
      result.checks.database === 'up' && result.checks.redis === 'up'
        ? 'ready'
        : 'not_ready';

    return result;
  }
}


