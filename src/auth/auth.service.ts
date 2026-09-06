import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../billing/usage.service';
import { resolveCompanySystemSettings } from '../config/system-settings';
import type { AuthUserResponse, CompanySummary, JwtPayload } from './jwt.types';
import { slugifyCompanyLabel, uniqueShopSlug } from './company-slug';
import { isPlatformAdminEmail } from './platform-admins';
import {
  googleAuthorizeUrl,
  googleCallbackErrorCode,
  googleConfig,
  googleFrontRedirect,
  googleOAuthConfigured,
  googleTokenExchangeBody,
  parseGoogleReturnTo,
  pickActiveMembership,
  sanitizeCompanyIdHint,
  type GoogleOAuthState,
  type GoogleSignupTicket,
} from './google-oauth';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly usage: UsageService,
  ) {}

  private companySlugFromName(name: string, shopSlug: string | null): string {
    return shopSlug?.trim() || slugifyCompanyLabel(name);
  }

  private async ensurePlatformAdminFlag(user: {
    id: string;
    email: string;
    isPlatformAdmin?: boolean;
  }): Promise<boolean> {
    if (user.isPlatformAdmin) return true;
    if (!isPlatformAdminEmail(user.email)) return false;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { isPlatformAdmin: true },
    });
    return true;
  }

  private touchLastLogin(userId: string) {
    void this.prisma.user
      .update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      })
      .catch(() => undefined);
  }

  private withSystemSettings(user: AuthUserResponse): AuthUserResponse {
    if (!user.companyId?.trim() || user.platformView) {
      return { ...user, systemSettings: { inaugurationDate: null } };
    }
    return {
      ...user,
      systemSettings: resolveCompanySystemSettings(
        user.companyId,
        user.companySlug,
      ),
    };
  }

  private async withUsage(user: AuthUserResponse): Promise<AuthUserResponse> {
    if (!user.companyId?.trim() || user.platformView) return user;
    try {
      const usage = await this.usage.getUsage(user.companyId);
      return usage ? { ...user, usage } : user;
    } catch {
      return user;
    }
  }

  private async loadAllPermissions(): Promise<string[]> {
    const rows = await this.prisma.permission.findMany({
      select: { slug: true },
    });
    return rows.map((r) => r.slug);
  }

  private async loadMemberships(userId: string) {
    return this.prisma.companyMember.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            shopSlug: true,
            status: true,
            companyModules: {
              where: { isEnabled: true },
              include: { module: { select: { slug: true } } },
            },
          },
        },
        memberRoles: {
          include: {
            role: {
              select: {
                slug: true,
                rolePermissions: {
                  include: { permission: { select: { slug: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  private membershipToSummary(
    m: Awaited<ReturnType<typeof this.loadMemberships>>[0],
  ): CompanySummary {
    return {
      id: m.company.id,
      name: m.company.name,
      slug: this.companySlugFromName(m.company.name, m.company.shopSlug),
      role: m.memberRoles[0]?.role.slug ?? 'member',
      modules: m.company.companyModules.map((cm) => cm.module.slug),
    };
  }

  private extractPermissions(
    m: Awaited<ReturnType<typeof this.loadMemberships>>[0],
  ): string[] {
    return [
      ...new Set(
        m.memberRoles.flatMap((mr) =>
          mr.role.rolePermissions.map((rp) => rp.permission.slug),
        ),
      ),
    ];
  }

  private buildPayload(
    user: { id: string; email: string; name: string; isPlatformAdmin?: boolean },
    membership: Awaited<ReturnType<typeof this.loadMemberships>>[0],
  ): JwtPayload {
    return {
      sub: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: user.isPlatformAdmin ?? false,
      platformView: false,
      companyId: membership.company.id,
      companyName: membership.company.name,
      companySlug: this.companySlugFromName(
        membership.company.name,
        membership.company.shopSlug,
      ),
      role: membership.memberRoles[0]?.role.slug ?? 'member',
      permissions: this.extractPermissions(membership),
    };
  }

  private buildPlatformPayload(
    user: { id: string; email: string; name: string },
  ): JwtPayload {
    return {
      sub: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: true,
      platformView: true,
      companyId: '',
      companyName: '',
      companySlug: '',
      role: 'platform-admin',
      permissions: ['platform.admin'],
    };
  }

  private buildPlatformCompanyPayload(
    user: { id: string; email: string; name: string },
    company: { id: string; name: string; shopSlug: string | null },
    permissions: string[],
  ): JwtPayload {
    return {
      sub: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: true,
      platformView: false,
      companyId: company.id,
      companyName: company.name,
      companySlug: this.companySlugFromName(company.name, company.shopSlug),
      role: 'platform-admin',
      permissions,
    };
  }

  private async issueSession(
    user: { id: string; email: string; name: string; isPlatformAdmin?: boolean },
    membership: Awaited<ReturnType<typeof this.loadMemberships>>[0],
    allMemberships: Awaited<ReturnType<typeof this.loadMemberships>>,
  ) {
    const payload = this.buildPayload(user, membership);
    const accessToken = this.jwt.sign(payload);
    const companies = allMemberships
      .filter((m) => m.company.status === 'ACTIVE')
      .map((m) => this.membershipToSummary(m));
    return {
      accessToken,
      user: await this.withUsage(
        this.withSystemSettings({ ...payload, companies }),
      ),
    };
  }

  private issuePlatformSession(
    user: { id: string; email: string; name: string },
    allMemberships: Awaited<ReturnType<typeof this.loadMemberships>>,
  ) {
    const payload = this.buildPlatformPayload(user);
    const accessToken = this.jwt.sign(payload);
    const companies = allMemberships
      .filter((m) => m.company.status === 'ACTIVE')
      .map((m) => this.membershipToSummary(m));
    return {
      accessToken,
      user: this.withSystemSettings({ ...payload, companies }),
    };
  }

  private async issuePlatformCompanySession(
    user: { id: string; email: string; name: string },
    companyId: string,
    allMemberships: Awaited<ReturnType<typeof this.loadMemberships>>,
  ) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, status: 'ACTIVE' },
      select: { id: true, name: true, shopSlug: true },
    });
    if (!company) {
      throw new BadRequestException('Empresa no encontrada o inactiva');
    }
    const permissions = await this.loadAllPermissions();
    const payload = this.buildPlatformCompanyPayload(
      user,
      company,
      permissions,
    );
    const accessToken = this.jwt.sign(payload);
    const companies = allMemberships
      .filter((m) => m.company.status === 'ACTIVE')
      .map((m) => this.membershipToSummary(m));
    return {
      accessToken,
      user: await this.withUsage(
        this.withSystemSettings({ ...payload, companies }),
      ),
    };
  }

  private async assertPlatformAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, active: true, isPlatformAdmin: true },
    });
    if (!user?.active) {
      throw new ForbiddenException('Acceso reservado al administrador de plataforma');
    }
    const isAdmin = await this.ensurePlatformAdminFlag(user);
    if (!isAdmin) {
      throw new ForbiddenException('Acceso reservado al administrador de plataforma');
    }
    return { ...user, isPlatformAdmin: true };
  }

  private async provisionNewCompany(companyName: string, userId: string) {
    const shopSlug = await uniqueShopSlug(this.prisma, companyName);
    const company = await this.prisma.company.create({
      data: {
        name: companyName.trim(),
        shopSlug,
        status: 'ACTIVE',
      },
    });

    const modules = await this.prisma.module.findMany();
    if (!modules.length) {
      throw new BadRequestException(
        'La plataforma aún no está inicializada. Contactá soporte.',
      );
    }

    for (const mod of modules) {
      if (mod.slug === 'dental') continue;
      await this.prisma.companyModule.create({
        data: {
          companyId: company.id,
          moduleId: mod.id,
          isEnabled: true,
        },
      });
    }

    const ownerRole = await this.prisma.role.create({
      data: {
        companyId: company.id,
        slug: 'owner',
        name: 'Propietario',
        description: 'Acceso total dentro de la empresa',
        isSystem: true,
      },
    });

    const permissions = await this.prisma.permission.findMany();
    for (const permission of permissions) {
      await this.prisma.rolePermission.create({
        data: { roleId: ownerRole.id, permissionId: permission.id },
      });
    }

    const member = await this.prisma.companyMember.create({
      data: { companyId: company.id, userId, status: 'ACTIVE' },
    });

    await this.prisma.companyMemberRole.create({
      data: { companyMemberId: member.id, roleId: ownerRole.id },
    });

    return company;
  }

  private async verifyGoogleIdToken(idToken: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      throw new UnauthorizedException('Inicio con Google no configurado en el servidor');
    }
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) {
      throw new UnauthorizedException('Token de Google inválido');
    }
    const data = (await res.json()) as {
      aud?: string;
      email?: string;
      name?: string;
      email_verified?: string | boolean;
    };
    if (data.aud !== clientId || !data.email?.trim()) {
      throw new UnauthorizedException('Token de Google inválido');
    }
    const verified =
      data.email_verified === true || data.email_verified === 'true';
    if (!verified) {
      throw new UnauthorizedException('Email de Google no verificado');
    }
    return {
      email: data.email.trim().toLowerCase(),
      name: (data.name ?? data.email.split('@')[0] ?? 'Usuario').trim(),
    };
  }

  async login(
    emailRaw: string,
    password: string,
    preferredCompanyId?: string,
  ) {
    const email = (emailRaw ?? '').trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        passwordHash: true,
        isPlatformAdmin: true,
      },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const memberships = await this.loadMemberships(user.id);
    return this.issueExistingUserSession(
      user,
      memberships,
      preferredCompanyId,
    );
  }

  async register(
    name: string,
    emailRaw: string,
    password: string,
    companyName: string,
    acceptTerms: boolean,
    acceptPrivacy: boolean,
  ) {
    if (!acceptTerms || !acceptPrivacy) {
      throw new BadRequestException(
        'Para crear la cuenta tenés que aceptar los términos y el tratamiento de datos.',
      );
    }
    const email = emailRaw.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese email');
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name.trim(),
        active: true,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
      },
    });

    await this.provisionNewCompany(companyName, user.id);
    const memberships = await this.loadMemberships(user.id);
    const primary = memberships.find((m) => m.company.status === 'ACTIVE');
    if (!primary) {
      throw new BadRequestException('No se pudo crear la empresa');
    }

    return this.issueSession(user, primary, memberships);
  }

  async googleLogin(
    idToken: string,
    companyName?: string,
    preferredCompanyId?: string,
    opts?: { allowSignup?: boolean },
  ) {
    const profile = await this.verifyGoogleIdToken(idToken);
    const existing = await this.prisma.user.findUnique({
      where: { email: profile.email },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        isPlatformAdmin: true,
      },
    });

    if (existing) {
      if (!existing.active) {
        throw new UnauthorizedException({
          code: 'GOOGLE_INACTIVE',
          message: 'Usuario inactivo',
        });
      }
      const memberships = await this.loadMemberships(existing.id);
      const session = await this.issueExistingUserSession(
        existing,
        memberships,
        preferredCompanyId,
        { google: true },
      );
      return { kind: 'session' as const, ...session };
    }

    if (opts?.allowSignup === false) {
      throw new BadRequestException({
        code: 'GOOGLE_NO_ACCOUNT',
        message: 'No hay una cuenta VOS IA con este email. Solicitá acceso.',
      });
    }

    const signupToken = this.jwt.sign(
      {
        t: 'gs',
        email: profile.email,
        name: profile.name,
      } satisfies GoogleSignupTicket,
      { expiresIn: '20m' },
    );
    return {
      kind: 'signup' as const,
      signupToken,
      email: profile.email,
      name: profile.name,
    };
  }

  async completeGoogleSignup(input: {
    signupToken: string;
    companyName: string;
    acceptTerms: boolean;
    acceptPrivacy: boolean;
  }) {
    if (!input.acceptTerms || !input.acceptPrivacy) {
      throw new BadRequestException(
        'Para crear la cuenta tenés que aceptar los términos y el tratamiento de datos.',
      );
    }
    let ticket: GoogleSignupTicket;
    try {
      ticket = this.jwt.verify<GoogleSignupTicket>(input.signupToken);
    } catch {
      throw new UnauthorizedException(
        'La sesión con Google expiró. Volvé a entrar con Google.',
      );
    }
    if (ticket.t !== 'gs' || !ticket.email?.trim() || !ticket.name?.trim()) {
      throw new UnauthorizedException('El registro con Google no es válido.');
    }

    const email = ticket.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        isPlatformAdmin: true,
      },
    });
    if (existing) {
      if (!existing.active) {
        throw new UnauthorizedException({
          code: 'GOOGLE_INACTIVE',
          message: 'Usuario inactivo',
        });
      }
      const memberships = await this.loadMemberships(existing.id);
      return this.issueExistingUserSession(existing, memberships, undefined, {
        google: true,
      });
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(
      `google-oauth-${email}-${Date.now()}`,
      10,
    );
    const created = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name: ticket.name.trim(),
        active: true,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
      },
    });
    await this.provisionNewCompany(input.companyName.trim(), created.id);
    const memberships = await this.loadMemberships(created.id);
    return this.issueExistingUserSession(created, memberships, undefined, {
      google: true,
    });
  }

  /**
   * Reabre la sesión de una cuenta ya existente.
   * No actualiza nombre, password, membresías ni datos operativos.
   */
  private async issueExistingUserSession(
    user: {
      id: string;
      email: string;
      name: string;
      isPlatformAdmin?: boolean;
    },
    memberships: Awaited<ReturnType<typeof this.loadMemberships>>,
    preferredCompanyId?: string,
    opts?: { google?: boolean },
  ) {
    this.touchLastLogin(user.id);
    const isPlatformAdmin = await this.ensurePlatformAdminFlag(user);
    const sessionUser = { ...user, isPlatformAdmin };

    if (isPlatformAdmin) {
      // El admin siempre arranca en el panel de plataforma (empresas + menú).
      // Entra a una empresa solo cuando la elige desde ese panel.
      return this.issuePlatformSession(sessionUser, memberships);
    }

    const picked = pickActiveMembership(memberships, preferredCompanyId);
    if (!picked) {
      if (opts?.google) {
        throw new UnauthorizedException({
          code: 'GOOGLE_NO_COMPANY',
          message: 'Usuario sin empresas activas',
        });
      }
      throw new UnauthorizedException('Usuario sin empresas activas');
    }
    return this.issueSession(sessionUser, picked, memberships);
  }

  buildGoogleAuthorizeRedirect(
    returnToRaw?: string,
    companyIdRaw?: string,
    popup = false,
  ): string {
    const cfg = googleConfig();
    const returnTo = parseGoogleReturnTo(returnToRaw);
    if (!googleOAuthConfigured(cfg)) {
      return googleFrontRedirect({
        frontUrl: cfg.frontUrl,
        returnTo,
        error: 'not_configured',
        popup,
      });
    }
    const companyId = sanitizeCompanyIdHint(companyIdRaw);
    const state = this.jwt.sign(
      {
        t: 'g',
        r: returnTo,
        ...(companyId ? { c: companyId } : {}),
        ...(popup ? { p: 1 as const } : {}),
      } satisfies GoogleOAuthState,
      { expiresIn: '10m' },
    );
    return googleAuthorizeUrl({
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      state,
      popup,
    });
  }

  async handleGoogleOAuthCallback(query: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    const cfg = googleConfig();
    let returnTo = parseGoogleReturnTo(undefined);
    let preferredCompanyId: string | undefined;
    let popup = false;
    const redirect = (
      extra: { token?: string; signup?: string; error?: string } = {},
    ) =>
      googleFrontRedirect({
        frontUrl: cfg.frontUrl,
        returnTo,
        popup,
        ...extra,
      });
    if (!query.state?.trim()) {
      return redirect({ error: 'invalid_state' });
    }
    try {
      const payload = this.jwt.verify<GoogleOAuthState>(query.state);
      if (payload.t === 'g') {
        returnTo = parseGoogleReturnTo(payload.r);
        preferredCompanyId = sanitizeCompanyIdHint(payload.c);
        popup = payload.p === 1;
      } else {
        return redirect({ error: 'invalid_state' });
      }
    } catch {
      return redirect({ error: 'invalid_state' });
    }
    if (query.error) {
      const error =
        query.error === 'access_denied' ? 'access_denied' : 'oauth_failed';
      return redirect({ error });
    }
    if (!query.code?.trim()) {
      return redirect({ error: 'oauth_failed' });
    }
    if (!googleOAuthConfigured(cfg)) {
      return redirect({ error: 'not_configured' });
    }
    try {
      const idToken = await this.exchangeGoogleAuthCode(query.code.trim(), cfg);
      const result = await this.googleLogin(
        idToken,
        undefined,
        preferredCompanyId,
        { allowSignup: returnTo === 'login' },
      );
      if (result.kind === 'signup') {
        return redirect({ signup: result.signupToken });
      }
      return redirect({ token: result.accessToken });
    } catch (err) {
      return redirect({ error: googleCallbackErrorCode(err) });
    }
  }

  private async exchangeGoogleAuthCode(
    code: string,
    cfg: ReturnType<typeof googleConfig>,
  ): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: googleTokenExchangeBody({
        code,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        redirectUri: cfg.redirectUri,
      }),
    });
    if (!res.ok) {
      throw new UnauthorizedException('No se pudo canjear el código de Google');
    }
    const data = (await res.json()) as { id_token?: string };
    if (!data.id_token?.trim()) {
      throw new UnauthorizedException('Google no devolvió un id_token');
    }
    return data.id_token.trim();
  }

  async me(jwt: JwtPayload): Promise<AuthUserResponse> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: jwt.sub },
      select: { id: true, email: true, isPlatformAdmin: true },
    });
    const isPlatformAdmin = dbUser
      ? await this.ensurePlatformAdminFlag({
          id: dbUser.id,
          email: dbUser.email,
          isPlatformAdmin: dbUser.isPlatformAdmin,
        })
      : Boolean(jwt.isPlatformAdmin);

    const memberships = await this.loadMemberships(jwt.sub);
    const companies = memberships
      .filter((m) => m.company.status === 'ACTIVE')
      .map((m) => this.membershipToSummary(m));

    if (isPlatformAdmin && jwt.platformView) {
      return this.withUsage(
        this.withSystemSettings({
          ...this.buildPlatformPayload({
            id: jwt.sub,
            email: jwt.email,
            name: jwt.name,
          }),
          companies,
        }),
      );
    }

    const current =
      memberships.find((m) => m.company.id === jwt.companyId) ?? memberships[0];

    if (current) {
      const payload = this.buildPayload(
        {
          id: jwt.sub,
          email: jwt.email,
          name: jwt.name,
          isPlatformAdmin,
        },
        current,
      );
      if (isPlatformAdmin && !jwt.platformView) {
        return this.withUsage(
          this.withSystemSettings({
            ...payload,
            isPlatformAdmin: true,
            platformView: false,
            role: 'platform-admin',
            permissions: await this.loadAllPermissions(),
            companies,
          }),
        );
      }
      return this.withUsage(this.withSystemSettings({ ...payload, companies }));
    }

    if (isPlatformAdmin) {
      return this.withUsage(
        this.withSystemSettings({
          ...this.buildPlatformPayload({
            id: jwt.sub,
            email: jwt.email,
            name: jwt.name,
          }),
          companies,
        }),
      );
    }

    return this.withUsage(this.withSystemSettings({ ...jwt, companies }));
  }

  async switchCompany(userId: string, companyId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        isPlatformAdmin: true,
      },
    });
    if (!user?.active) {
      throw new UnauthorizedException('Usuario inactivo');
    }

    const isAdmin = await this.ensurePlatformAdminFlag(user);
    // Platform admin usa /auth/platform/enter-company, no este endpoint.
    if (isAdmin) {
      throw new ForbiddenException(
        'Usá el panel de plataforma para entrar a una empresa',
      );
    }

    const membership = await this.loadMemberships(userId);
    const ownedActive = membership.filter(
      (m) =>
        m.company.status === 'ACTIVE' &&
        m.memberRoles.some((mr) => mr.role.slug === 'owner'),
    );

    if (ownedActive.length < 2) {
      throw new ForbiddenException(
        'Solo cuentas propietarias con varias empresas pueden cambiar de empresa',
      );
    }

    const target = ownedActive.find((m) => m.company.id === companyId);
    if (!target) {
      throw new UnauthorizedException(
        'Sin acceso de propietario a esa empresa',
      );
    }

    return this.issueSession(user, target, membership);
  }

  async enterCompanyAsPlatformAdmin(userId: string, companyId: string) {
    const user = await this.assertPlatformAdmin(userId);
    const memberships = await this.loadMemberships(userId);
    return this.issuePlatformCompanySession(user, companyId, memberships);
  }

  async exitToPlatformAdmin(userId: string) {
    const user = await this.assertPlatformAdmin(userId);
    const memberships = await this.loadMemberships(userId);
    return this.issuePlatformSession(user, memberships);
  }
}
