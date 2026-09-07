export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  isPlatformAdmin?: boolean;
  platformView?: boolean;
  companyId: string;
  companyName: string;
  companySlug: string;
  role: string;
  permissions: string[];
};

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
  modules: string[];
  businessType?: string | null;
};

export type SystemSettings = {
  inaugurationDate: string | null;
};

export type CompanyUsageSummary = {
  plan: 'TRIAL' | 'PRO' | 'BUSINESS';
  storageUsedBytes: number;
  storageLimitBytes: number;
  percent: number;
  products: number;
  sales: number;
  purchases: number;
  inventory: number;
  appointments: number;
  overLimit: boolean;
  offerPro: boolean;
  limitLabel: string | null;
};

export type AuthUserResponse = JwtPayload & {
  companies: CompanySummary[];
  systemSettings?: SystemSettings;
  usage?: CompanyUsageSummary | null;
};
