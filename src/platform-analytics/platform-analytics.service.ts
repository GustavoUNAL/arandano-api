import { BadRequestException, Injectable } from '@nestjs/common';
import { OperatingExpenseKind } from '@prisma/client';
import { bogotaDateKey, bogotaDayBounds } from '../common/bogota-time';
import { splitPaymentChannels } from '../common/payment-channels';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../tenant/tenant.types';
import {
  type AnalyticsGranularity,
  bucketsToSeries,
  enumerateDayKeys,
  mergeIntoBuckets,
  parseDateRange,
  periodKey,
  periodLabel,
} from './analytics-period';

function monthStartUtc(ym: string): Date {
  return new Date(`${ym.slice(0, 7)}-01T00:00:00.000Z`);
}

@Injectable()
export class PlatformAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDataBounds(tenant: TenantContext) {
    const [sales, purchases, shifts, expenses] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { companyId: tenant.companyId },
        _min: { saleDate: true },
        _max: { saleDate: true },
      }),
      this.prisma.purchaseLot.aggregate({
        where: { companyId: tenant.companyId },
        _min: { purchaseDate: true },
        _max: { purchaseDate: true },
      }),
      this.prisma.staffShift.aggregate({
        where: { companyId: tenant.companyId },
        _min: { shiftDate: true },
        _max: { shiftDate: true },
      }),
      this.prisma.operatingExpense.aggregate({
        where: { companyId: tenant.companyId },
        _min: { expenseMonth: true },
        _max: { expenseMonth: true },
      }),
    ]);

    const mins = [
      sales._min.saleDate,
      purchases._min.purchaseDate,
      shifts._min.shiftDate,
      expenses._min.expenseMonth,
    ].filter((d): d is Date => d != null);

    const maxes = [
      sales._max.saleDate,
      purchases._max.purchaseDate,
      shifts._max.shiftDate,
      expenses._max.expenseMonth,
    ].filter((d): d is Date => d != null);

    if (!mins.length) {
      const { fromKey, toKey } = parseDateRange();
      return { dateFrom: fromKey, dateTo: toKey };
    }

    return {
      dateFrom: bogotaDateKey(
        new Date(Math.min(...mins.map((d) => d.getTime()))),
      ),
      dateTo: bogotaDateKey(
        new Date(Math.max(...maxes.map((d) => d.getTime()))),
      ),
    };
  }

  async getFinancialOverview(
    tenant: TenantContext,
    opts: {
      dateFrom?: string;
      dateTo?: string;
      granularity?: AnalyticsGranularity;
    },
  ) {
    const granularity = opts.granularity ?? 'day';
    if (!['day', 'week', 'month'].includes(granularity)) {
      throw new BadRequestException('granularity debe ser day, week o month');
    }

    const { from, to, fromKey, toKey } = parseDateRange(
      opts.dateFrom,
      opts.dateTo,
    );

    const expenseFrom = monthStartUtc(fromKey);
    const expenseTo = monthStartUtc(toKey);

    const [sales, purchases, shifts, expenses, bounds] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          companyId: tenant.companyId,
          saleDate: { gte: from, lte: to },
        },
        select: {
          saleDate: true,
          total: true,
          paymentMethod: true,
          lines: { select: { profit: true } },
        },
      }),
      this.prisma.purchaseLot.findMany({
        where: {
          companyId: tenant.companyId,
          purchaseDate: { gte: from, lte: to },
        },
        select: { purchaseDate: true, totalValue: true },
      }),
      this.prisma.staffShift.findMany({
        where: {
          companyId: tenant.companyId,
          shiftDate: {
            gte: bogotaDayBounds(fromKey).from,
            lte: bogotaDayBounds(toKey).from,
          },
        },
        select: {
          shiftDate: true,
          hoursWorked: true,
          totalPayCOP: true,
        },
      }),
      this.prisma.operatingExpense.findMany({
        where: {
          companyId: tenant.companyId,
          expenseMonth: { gte: expenseFrom, lte: expenseTo },
        },
        select: {
          expenseMonth: true,
          kind: true,
          amountCOP: true,
        },
      }),
      this.getDataBounds(tenant),
    ]);

    const salesBuckets = new Map<
      string,
      {
        count: number;
        totalCOP: number;
        profitCOP?: number;
        hours?: number;
        cashCOP?: number;
        nequiCOP?: number;
        otherCOP?: number;
      }
    >();
    const purchaseBuckets = new Map<
      string,
      { count: number; totalCOP: number; profitCOP?: number; hours?: number }
    >();
    const staffBuckets = new Map<
      string,
      { count: number; totalCOP: number; profitCOP?: number; hours?: number }
    >();
    const utilitiesBuckets = new Map<
      string,
      { count: number; totalCOP: number; profitCOP?: number; hours?: number }
    >();

    let salesTotal = 0;
    let salesProfit = 0;
    let cashTotal = 0;
    let nequiTotal = 0;
    let otherPayTotal = 0;

    for (const row of sales) {
      const key = periodKey(row.saleDate, granularity);
      const total = Number(row.total);
      let lineProfit = 0;
      for (const line of row.lines) {
        if (line.profit != null) lineProfit += Number(line.profit);
      }
      const channels = splitPaymentChannels(row.paymentMethod ?? '', total);
      salesTotal += total;
      salesProfit += lineProfit;
      cashTotal += channels.cashCOP;
      nequiTotal += channels.nequiCOP;
      otherPayTotal += channels.otherCOP;
      mergeIntoBuckets(salesBuckets, key, {
        count: 1,
        totalCOP: total,
        profitCOP: lineProfit,
        cashCOP: channels.cashCOP,
        nequiCOP: channels.nequiCOP,
        otherCOP: channels.otherCOP,
      });
    }

    let purchasesTotal = 0;
    for (const row of purchases) {
      const key = periodKey(row.purchaseDate, granularity);
      const total = Number(row.totalValue ?? 0);
      purchasesTotal += total;
      mergeIntoBuckets(purchaseBuckets, key, { count: 1, totalCOP: total });
    }

    let staffPayTotal = 0;
    let staffHours = 0;
    for (const row of shifts) {
      const key = periodKey(row.shiftDate, granularity);
      const pay = Number(row.totalPayCOP ?? 0);
      const hours = Number(row.hoursWorked ?? 0);
      staffPayTotal += pay;
      staffHours += hours;
      mergeIntoBuckets(staffBuckets, key, {
        count: 1,
        totalCOP: pay,
        hours,
      });
    }

    let utilitiesTotal = 0;
    let aguaTotal = 0;
    let energiaTotal = 0;
    let internetTotal = 0;
    let otherUtilityTotal = 0;

    for (const row of expenses) {
      const key = periodKey(row.expenseMonth, granularity);
      const amount = Number(row.amountCOP ?? 0);
      utilitiesTotal += amount;
      if (row.kind === OperatingExpenseKind.AGUA) aguaTotal += amount;
      else if (row.kind === OperatingExpenseKind.ENERGIA) energiaTotal += amount;
      else if (row.kind === OperatingExpenseKind.INTERNET)
        internetTotal += amount;
      else otherUtilityTotal += amount;
      mergeIntoBuckets(utilitiesBuckets, key, { count: 1, totalCOP: amount });
    }

    const allPeriods = new Set<string>([
      ...salesBuckets.keys(),
      ...purchaseBuckets.keys(),
      ...staffBuckets.keys(),
      ...utilitiesBuckets.keys(),
    ]);

    // Semana o rangos cortos por día: mostrar todos los días aunque estén en cero.
    if (granularity === 'day') {
      for (const day of enumerateDayKeys(fromKey, toKey)) {
        allPeriods.add(day);
      }
    }

    const combined = [...allPeriods]
      .sort((a, b) => a.localeCompare(b))
      .map((period) => {
        const s = salesBuckets.get(period);
        const p = purchaseBuckets.get(period);
        const st = staffBuckets.get(period);
        const u = utilitiesBuckets.get(period);
        const salesCOP = s?.totalCOP ?? 0;
        const purchasesCOP = p?.totalCOP ?? 0;
        const staffCOP = st?.totalCOP ?? 0;
        const utilitiesCOP = u?.totalCOP ?? 0;
        const outflowsCOP = purchasesCOP + staffCOP + utilitiesCOP;
        return {
          period,
          label: periodLabel(period, granularity),
          salesCount: s?.count ?? 0,
          salesCOP: Math.round(salesCOP),
          salesProfitCOP: Math.round(s?.profitCOP ?? 0),
          grossProfitCOP: Math.round(salesCOP - purchasesCOP),
          purchasesCount: p?.count ?? 0,
          purchasesCOP: Math.round(purchasesCOP),
          cashCOP: Math.round(s?.cashCOP ?? 0),
          nequiCOP: Math.round(s?.nequiCOP ?? 0),
          otherPayCOP: Math.round(s?.otherCOP ?? 0),
          staffShifts: st?.count ?? 0,
          staffHours: Math.round((st?.hours ?? 0) * 100) / 100,
          staffPayCOP: Math.round(staffCOP),
          utilitiesCOP: Math.round(utilitiesCOP),
          outflowsCOP: Math.round(outflowsCOP),
          netCOP: Math.round(salesCOP - outflowsCOP),
        };
      });

    const outflowsTotal = purchasesTotal + staffPayTotal + utilitiesTotal;

    return {
      granularity,
      dateFrom: fromKey,
      dateTo: toKey,
      dataBounds: bounds,
      sales: {
        series: bucketsToSeries(salesBuckets, granularity),
        totals: {
          count: sales.length,
          totalCOP: Math.round(salesTotal),
          profitCOP: Math.round(salesProfit),
          cashCOP: Math.round(cashTotal),
          nequiCOP: Math.round(nequiTotal),
          otherPayCOP: Math.round(otherPayTotal),
        },
      },
      purchases: {
        series: bucketsToSeries(purchaseBuckets, granularity),
        totals: {
          count: purchases.length,
          totalCOP: Math.round(purchasesTotal),
        },
      },
      staff: {
        series: bucketsToSeries(staffBuckets, granularity),
        totals: {
          shiftCount: shifts.length,
          hours: Math.round(staffHours * 100) / 100,
          totalPayCOP: Math.round(staffPayTotal),
        },
      },
      utilities: {
        series: bucketsToSeries(utilitiesBuckets, granularity),
        totals: {
          count: expenses.length,
          totalCOP: Math.round(utilitiesTotal),
          aguaCOP: Math.round(aguaTotal),
          energiaCOP: Math.round(energiaTotal),
          internetCOP: Math.round(internetTotal),
          otherCOP: Math.round(otherUtilityTotal),
        },
      },
      combined,
      summary: {
        salesCOP: Math.round(salesTotal),
        salesProfitCOP: Math.round(salesProfit),
        grossProfitCOP: Math.round(salesTotal - purchasesTotal),
        purchasesCOP: Math.round(purchasesTotal),
        cashCOP: Math.round(cashTotal),
        nequiCOP: Math.round(nequiTotal),
        otherPayCOP: Math.round(otherPayTotal),
        staffPayCOP: Math.round(staffPayTotal),
        utilitiesCOP: Math.round(utilitiesTotal),
        aguaCOP: Math.round(aguaTotal),
        energiaCOP: Math.round(energiaTotal),
        internetCOP: Math.round(internetTotal),
        inflowsCOP: Math.round(salesTotal),
        outflowsCOP: Math.round(outflowsTotal),
        netCOP: Math.round(salesTotal - outflowsTotal),
      },
    };
  }
}
