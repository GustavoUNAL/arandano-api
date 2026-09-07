import { IsIn, IsString } from 'class-validator';
import { BUSINESS_TYPES } from '../business-types';

export class SetBusinessTypeDto {
  @IsString()
  @IsIn([...BUSINESS_TYPES])
  businessType!: string;
}
