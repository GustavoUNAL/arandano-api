import { Module } from '@nestjs/common';
import { PurchaseLotsController } from './purchase-lots.controller';
import { PurchaseLotsService } from './purchase-lots.service';

@Module({
  controllers: [PurchaseLotsController],
  providers: [PurchaseLotsService],
  exports: [PurchaseLotsService],
})
export class PurchaseLotsModule {}
