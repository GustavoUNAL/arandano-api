import { IsIn, IsString } from 'class-validator';

export class UpdateAccessRequestDto {
  @IsString()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status!: 'PENDING' | 'APPROVED' | 'REJECTED';
}
