import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurchaseLotLineInputDto {
  @IsOptional()
  @IsString()
  inventoryItemId?: string | null;

  @IsString()
  lineName!: string;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsNumber()
  @Min(0)
  quantityPurchased!: number;

  @IsString()
  unit!: string;

  @IsNumber()
  @Min(0)
  purchaseUnitCostCOP!: number;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class ReplacePurchaseLotLinesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLotLineInputDto)
  lines!: PurchaseLotLineInputDto[];

  /** Si se envía, debe coincidir con la suma de líneas (tolerancia 1 COP) para persistirse en el lote. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedTotalValueCOP?: number;
}
