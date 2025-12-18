import { Global, Module } from '@nestjs/common';
import { EventsPublisher } from './events.publisher';

@Global()
@Module({
  providers: [EventsPublisher],
  exports: [EventsPublisher],
})
export class EventsModule {}


