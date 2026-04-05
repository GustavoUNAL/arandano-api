import { SaleSource } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateSaleDto {
  @IsDateString()
  @IsOptional()
  saleDate?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsEnum(SaleSource)
  @IsOptional()
  source?: SaleSource;

  @IsString()
  @IsOptional()
  mesa?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  userId?: string;
}
