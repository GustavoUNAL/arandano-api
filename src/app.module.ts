import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { ExplorerModule } from './explorer/explorer.module';
import { RecipesModule } from './recipes/recipes.module';
import { InventoryModule } from './inventory/inventory.module';
import { SalesModule } from './sales/sales.module';
import { PurchaseLotsModule } from './purchase-lots/purchase-lots.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ProductsModule,
    RecipesModule,
    InventoryModule,
    SalesModule,
    PurchaseLotsModule,
    ExplorerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
