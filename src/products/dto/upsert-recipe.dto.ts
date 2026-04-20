import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class RecipeIngredientLineDto {
  @IsString()
  @IsNotEmpty()
  inventoryItemId!: string;

  @IsNumber()
  @Min(0.0000001)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  unit!: string;

  /** Orden respecto a la hoja (mismo espacio que `costos.sort_order`). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;
}

export class RecipeCostLineDto {
  @IsString()
  @IsIn(['FIJO', 'VARIABLE'])
  kind!: 'FIJO' | 'VARIABLE';

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsString()
  @IsNotEmpty()
  unit!: string;

  @IsNumber()
  @Min(0)
  lineTotalCOP!: number;

  @IsOptional()
  @IsString()
  sheetUnitCost?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpsertRecipeDto {
  /** Unidades que rinde la receta (ej. 1 = una porción estándar). */
  @IsNumber()
  @Min(0.0000001)
  recipeYield!: number;

  /**
   * Porcentaje de administración (ej. 0.30 = 30%). Si no se envía, se conserva el actual
   * (o default 0.30 si es receta nueva).
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  adminRate?: number;

  /** Solo insumos de inventario físico (descuentan stock al vender). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientLineDto)
  ingredients?: RecipeIngredientLineDto[];

  /** Costeo de hoja: fijos vs variables (tabla `costos`). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeCostLineDto)
  costs?: RecipeCostLineDto[];
}
