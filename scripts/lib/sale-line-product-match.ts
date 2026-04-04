/**
 * Empareja textos históricos de `sale_lines.product_name` (y ids legacy del JSON)
 * con nombres exactos del catálogo actual en `products.name`.
 */

export function normalizeProductLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export type MatchResult = {
  productId: string;
  productName: string;
  recipeCostMultiplier: number;
};

type Rule = {
  test: RegExp;
  catalogName: string;
  recipeCostMultiplier?: number;
};

/**
 * Orden: reglas más específicas primero.
 */
const RULES: Rule[] = [
  {
    test: /media\s+aguardiente|1\s*\/\s*2.*aguardiente|mitad.*aguardiente/i,
    catalogName: 'Aguardiente Nariño o Amarillo',
    recipeCostMultiplier: 0.5,
  },
  {
    test: /1\s*\/\s*2\s*botella.*smirnoff|media.*smirnoff|vodka-smirnoff-media/i,
    catalogName: 'Vodka Smirnoff Tamarindo',
    recipeCostMultiplier: 0.5,
  },
  {
    test: /café\s*artesanal.*pastel|pastel.*café|combo.*café.*pastel/i,
    catalogName: 'Combo Martes Café',
  },
  {
    test: /acompañante|acompanante|buñuelo|^empanada$/i,
    catalogName: 'Empanadas',
  },
  {
    test: /pastel\s*del\s*d[ií]a/i,
    catalogName: 'Porción de galletas',
  },
  {
    test: /suspiros/i,
    catalogName: 'Porción de galletas',
  },
  {
    test: /hervido/i,
    catalogName: 'Hervidos',
  },
  {
    test: /moscow|moscowmule|chapil/i,
    catalogName: 'Moscow mule',
  },
  {
    test: /campari/i,
    catalogName: 'Negroni',
  },
  {
    test: /michelada/i,
    catalogName: 'Cerveza Michelada',
  },
  {
    test: /club\s*colombia/i,
    catalogName: 'Cerveza Club Colombia',
  },
  {
    test: /budweiser/i,
    catalogName: 'Cerveza Budweiser',
  },
  {
    test: /pokeron/i,
    catalogName: 'Cerveza Pokeron',
  },
  {
    test: /poker/i,
    catalogName: 'Cerveza Poker',
  },
  {
    test: /coronita/i,
    catalogName: 'Cerveza Coronita',
  },
  {
    test: /shot\s*tequila|tequila.*shot|olmeca.*shot/i,
    catalogName: 'Shot Tequila',
  },
  {
    test: /shot\s*ginebra|^ginebra|gin-?gordon|gordon'?s/i,
    catalogName: 'Shot Ginebra',
  },
  {
    test: /^vodka\s*smirnoff$/i,
    catalogName: 'Shot Vodka',
  },
  {
    test: /vodka.*tamarindo|smirnoff.*tamarindo/i,
    catalogName: 'Vodka Smirnoff Tamarindo',
  },
  {
    test: /aguardiente\s*amarillo|aguardiente\s*nari[oñ]o(?!\s*\/)/i,
    catalogName: 'Aguardiente Nariño o Amarillo',
  },
  {
    test: /^aguardiente$/i,
    catalogName: 'Aguardiente Nariño o Amarillo',
  },
  {
    test: /^soda$/i,
    catalogName: 'Soda italiana',
  },
];

export function matchSaleLineToCatalog(
  productName: string,
  nameToId: Map<string, { id: string; name: string }>,
): MatchResult | null {
  const raw = productName.trim();
  if (!raw) return null;

  const norm = normalizeProductLabel(raw);
  const direct = nameToId.get(norm);
  if (direct) {
    return {
      productId: direct.id,
      productName: direct.name,
      recipeCostMultiplier: 1,
    };
  }

  for (const r of RULES) {
    if (r.test.test(raw)) {
      const row = nameToId.get(normalizeProductLabel(r.catalogName));
      if (!row) return null;
      return {
        productId: row.id,
        productName: row.name,
        recipeCostMultiplier: r.recipeCostMultiplier ?? 1,
      };
    }
  }

  return null;
}
