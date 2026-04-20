import { AdminExpenseKind, AdminExpensePeriod } from '@prisma/client';
import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpsertAdminExpenseDto {
  @IsEnum(AdminExpenseKind)
  kind!: AdminExpenseKind;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(AdminExpensePeriod)
  @IsOptional()
  period?: AdminExpensePeriod;

  @IsNumber()
  @Min(0)
  amountCOP!: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

