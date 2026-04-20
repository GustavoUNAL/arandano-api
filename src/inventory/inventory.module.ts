import { Module } from '@nestjs/common';
import { PurchaseLotsModule } from '../purchase-lots/purchase-lots.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [PurchaseLotsModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
