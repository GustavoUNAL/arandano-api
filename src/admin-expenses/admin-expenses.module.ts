import { Module } from '@nestjs/common';
import { AdminExpensesController } from './admin-expenses.controller';
import { AdminExpensesService } from './admin-expenses.service';

@Module({
  controllers: [AdminExpensesController],
  providers: [AdminExpensesService],
})
export class AdminExpensesModule {}

