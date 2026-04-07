import { PaymentStatus, Prisma } from '@prisma/client';

export function decStr(
  v: Prisma.Decimal | null | undefined,
  fractionDigits = 2,
): string | null {
  if (v == null) return null;
  return v.toFixed(fractionDigits);
}

export function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

export function sumPaidAmount(
  payments: { status: PaymentStatus; amount: Prisma.Decimal }[],
): Prisma.Decimal {
  let s = new Prisma.Decimal(0);
  for (const p of payments) {
    if (p.status === PaymentStatus.PAID) s = s.add(p.amount);
  }
  return s;
}

export function sumPendingAmount(
  payments: { status: PaymentStatus; amount: Prisma.Decimal }[],
): Prisma.Decimal {
  let s = new Prisma.Decimal(0);
  for (const p of payments) {
    if (p.status === PaymentStatus.PENDING) s = s.add(p.amount);
  }
  return s;
}
