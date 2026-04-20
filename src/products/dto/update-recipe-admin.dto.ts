import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateRecipeAdminDto {
  /** Porcentaje (0.30 = 30%). */
  @IsNumber()
  @Min(0)
  adminRate!: number;

  /** Si se envía, recalcula la línea con esta tasa (default: usa la misma). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  recipeYield?: number;
}

