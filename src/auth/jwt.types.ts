import { UserRole } from '@prisma/client';

export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
};

