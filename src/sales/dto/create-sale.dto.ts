import { SaleSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SaleLineInputDto } from './sale-line-input.dto';

export class CreateSaleDto {
  @IsDateString()
  saleDate!: string;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleLineInputDto)
  lines!: SaleLineInputDto[];
}
