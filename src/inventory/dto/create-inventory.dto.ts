import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateInventoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** FK a `categories` con `type = INVENTORY` */
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  unit!: string;

  @IsNumber()
  @Min(0)
  unitCost!: number;

  @IsString()
  @IsOptional()
  supplier?: string;

  @IsString()
  @IsOptional()
  lot?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  minStock?: number;
}
