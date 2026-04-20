import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePurchaseLotDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsDateString()
  @IsOptional()
  purchaseDate?: string;

  @IsString()
  @IsOptional()
  supplier?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  totalValue?: number;
}
