import { GastoKind, GastoPeriod, GastoType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpsertGastoDto {
  @IsEnum(GastoKind)
  kind!: GastoKind;

  @IsEnum(GastoType)
  type!: GastoType;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(GastoPeriod)
  @IsOptional()
  period?: GastoPeriod;

  @IsNumber()
  @Min(0)
  amountCOP!: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

