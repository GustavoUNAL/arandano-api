import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { SaleLineInputDto } from './sale-line-input.dto';

export class ReplaceSaleLinesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleLineInputDto)
  lines!: SaleLineInputDto[];
}
