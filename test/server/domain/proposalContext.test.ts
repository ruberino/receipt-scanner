import { describe, expect, it, vi } from 'vitest';
import {
  buildProposalContext,
  type BuildProposalContextInput,
  type PreviousProposal,
} from '../../../src/server/domain/proposalContext.ts';
import type { ProductHistory } from '../../../src/server/domain/productStats.ts';
import { addDays } from '../../../src/shared/dates.ts';

const TODAY = '2026-09-07';

function history(overrides: Partial<ProductHistory> = {}): ProductHistory {
  return {
    productId: 1,
    name: 'Lettmelk 1 l',
    category: 'Meieri',
    suppressed: false,
    purchases: [{ date: '2026-09-01', quantity: 1, unit: 'stk' }],
    variants: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<BuildProposalContextInput> = {}): BuildProposalContextInput {
  return {
    histories: [history()],
    list: { items: [] },
    dismissedProductIds: new Set(),
    previousProposals: [],
    today: TODAY,
    ...overrides,
  };
}

describe('buildProposalContext', () => {
  it('includes today, its Norwegian weekday, the ISO week and calendar events in range', () => {
    const context = buildProposalContext(baseInput({ today: '2026-10-15' }));

    expect(context.today).toBe('2026-10-15');
    expect(context.weekday).toBe('torsdag');
    expect(context.isoWeek).toBe('2026-W42');
    expect(context.calendarEvents.map((event) => event.name)).toContain('Halloween');
  });

  it('excludes a product with no purchase in the last 26 weeks', () => {
    const tooOld = history({
      productId: 2,
      name: 'Gammel vare',
      purchases: [{ date: '2026-01-01', quantity: 1, unit: null }],
    });

    const context = buildProposalContext(baseInput({ histories: [tooOld] }));

    expect(context.products).toEqual([]);
  });

  it('includes a product purchased exactly at the 26-week boundary', () => {
    // 26 weeks = 182 days before 2026-09-07 is 2026-03-09.
    const atBoundary = history({
      productId: 3,
      purchases: [{ date: '2026-03-09', quantity: 1, unit: null }],
    });

    const context = buildProposalContext(baseInput({ histories: [atBoundary] }));

    expect(context.products.map((p) => p.id)).toContain(3);
  });

  it('excludes a suppressed product even with recent purchases', () => {
    const suppressed = history({ suppressed: true });

    const context = buildProposalContext(baseInput({ histories: [suppressed] }));

    expect(context.products).toEqual([]);
  });

  it("sorts a product's own purchases newest first", () => {
    const threePurchases = history({
      purchases: [
        { date: '2026-08-01', quantity: 1, unit: null },
        { date: '2026-08-20', quantity: 1, unit: null },
        { date: '2026-06-10', quantity: 1, unit: null },
      ],
    });

    const context = buildProposalContext(baseInput({ histories: [threePurchases] }));

    expect(context.products[0]?.purchases).toEqual([
      '2026-08-20 x1',
      '2026-08-01 x1',
      '2026-06-10 x1',
    ]);
  });

  it('caps a product at 12 purchases, keeping the most recent', () => {
    // 20 distinct dates, 5 days apart, all well within the 26-week window.
    const purchases = Array.from({ length: 20 }, (_, i) => ({
      date: addDays(TODAY, -5 * i),
      quantity: 1,
      unit: null,
    }));
    const manyPurchases = history({ purchases });

    const context = buildProposalContext(baseInput({ histories: [manyPurchases] }));

    expect(context.products[0]?.purchases).toHaveLength(12);
    expect(context.products[0]?.purchases[0]).toBe(`${TODAY} x1`);
  });

  it('formats a purchase as "date xQuantity"', () => {
    const context = buildProposalContext(
      baseInput({
        histories: [history({ purchases: [{ date: '2026-09-04', quantity: 2, unit: 'stk' }] })],
      }),
    );

    expect(context.products[0]?.purchases).toEqual(['2026-09-04 x2']);
  });

  it('carries variants for a grouped product and omits the key for an ungrouped one (T40)', () => {
    const context = buildProposalContext(
      baseInput({
        histories: [
          history({ productId: 1, variants: ['Skyr mini jordbær', 'Skyr mini banan'] }),
          history({ productId: 2, name: 'Kaffe' }),
        ],
      }),
    );

    const grouped = context.products.find((product) => product.id === 1);
    const ungrouped = context.products.find((product) => product.id === 2);
    expect(grouped?.variants).toEqual(['Skyr mini jordbær', 'Skyr mini banan']);
    expect(JSON.stringify(ungrouped)).not.toContain('variants');
  });

  it('flags a product as onList when a list item points at it', () => {
    const context = buildProposalContext(
      baseInput({
        list: { items: [{ productId: 1, name: 'Lettmelk 1 l' }] },
      }),
    );

    expect(context.products[0]).toMatchObject({ onList: true });
    expect(context.listItems).toEqual(['Lettmelk 1 l']);
  });

  it('flags a product as dismissed from dismissedProductIds', () => {
    const context = buildProposalContext(baseInput({ dismissedProductIds: new Set([1]) }));

    expect(context.products[0]).toMatchObject({ dismissed: true });
  });

  it('flags a product as rejected only when an earlier resolved proposal did not accept it', () => {
    const resolvedNotAccepted: PreviousProposal = {
      items: [{ index: 0, productId: 1 }],
      acceptedIndexes: [],
    };
    const context = buildProposalContext(baseInput({ previousProposals: [resolvedNotAccepted] }));

    expect(context.products[0]).toMatchObject({ rejected: true });
  });

  it('does not flag a product as rejected when the earlier proposal accepted it', () => {
    const resolvedAccepted: PreviousProposal = {
      items: [{ index: 0, productId: 1 }],
      acceptedIndexes: [0],
    };
    const context = buildProposalContext(baseInput({ previousProposals: [resolvedAccepted] }));

    expect(context.products[0]).toMatchObject({ rejected: false });
  });

  it('does not flag a product as rejected when its proposal was never resolved', () => {
    const unresolved: PreviousProposal = {
      items: [{ index: 0, productId: 1 }],
      acceptedIndexes: null,
    };
    const context = buildProposalContext(baseInput({ previousProposals: [unresolved] }));

    expect(context.products[0]).toMatchObject({ rejected: false });
  });

  describe('size guard', () => {
    const GUARD_CHARS = 120_000;

    /** Purchases at the given ages in days, so a fixture can decide what the 12-week scope cut
     * removes and what survives it. */
    function purchasesAtAges(ages: number[]) {
      return ages.map((age) => ({
        date: addDays(TODAY, -age),
        quantity: 1,
        unit: 'stk' as const,
      }));
    }

    function products(count: number, name: (i: number) => string, ages: number[]) {
      return Array.from({ length: count }, (_, i) =>
        history({
          productId: i + 1,
          name: name(i),
          purchases: purchasesAtAges(ages),
        }),
      );
    }

    function logger() {
      return { info: vi.fn(), warn: vi.fn() };
    }

    function detailsOf(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
      const [details] = mock.mock.calls[0] as [Record<string, unknown>];
      return details;
    }

    const RECENT_AGES = [1, 8, 15, 22, 29, 36, 43, 50, 57, 64, 71, 78];

    it('leaves a small context untouched and logs nothing at all', () => {
      const log = logger();

      const context = buildProposalContext(baseInput(), log);

      expect(context.products).toHaveLength(1);
      expect(log.info).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('cuts products when the context is over the guard by product count', () => {
      const log = logger();
      const histories = products(
        600,
        (i) => `Et ganske langt produktnavn for å blåse opp konteksten nummer ${i}`,
        RECENT_AGES,
      );

      const context = buildProposalContext(baseInput({ histories }), log);

      expect(JSON.stringify(context).length).toBeLessThanOrEqual(GUARD_CHARS);
      expect(context.products.length).toBeLessThanOrEqual(250);
      expect(log.warn).not.toHaveBeenCalled();
      expect(detailsOf(log.info)).toMatchObject({ step: 'products-250' });
    });

    // The shape of issue #15: fewer than 250 products, every purchase inside the 12-week fallback,
    // so both of the old knobs turned without moving anything and the call went out full size.
    it('cuts purchases when neither the scope nor the product cap can reach the context', () => {
      const log = logger();
      const histories = products(240, (i) => `${'Navn '.repeat(40)}${i}`, RECENT_AGES);

      const context = buildProposalContext(baseInput({ histories }), log);

      expect(JSON.stringify(context).length).toBeLessThanOrEqual(GUARD_CHARS);
      expect(context.products).toHaveLength(240);
      expect(context.products[0]!.purchases.length).toBeLessThanOrEqual(6);
      expect(log.warn).not.toHaveBeenCalled();
      expect(detailsOf(log.info)).toMatchObject({ step: 'purchases-6' });
    });

    it('stops at the first rung that fits and leaves the later rungs alone', () => {
      const log = logger();
      // Nine of the twelve purchases are older than the 12-week fallback, so the scope cut alone
      // takes three quarters of the bulk out.
      const histories = products(
        420,
        (i) => `Et ganske langt produktnavn for å blåse opp konteksten nummer ${i}`,
        [1, 8, 15, 100, 110, 120, 130, 140, 150, 160, 170, 180],
      );

      const context = buildProposalContext(baseInput({ histories }), log);

      expect(JSON.stringify(context).length).toBeLessThanOrEqual(GUARD_CHARS);
      expect(detailsOf(log.info)).toMatchObject({ step: 'scope-12-weeks' });
      // Untouched by the purchases rungs: the three that survive the scope cut are all still there.
      expect(context.products[0]!.purchases).toHaveLength(3);
      expect(context.products).toHaveLength(420);
    });

    it('returns the context anyway, warning once, when no rung brings it under', () => {
      const log = logger();
      const histories = products(
        100,
        (i) => `${'Et absurd langt produktnavn '.repeat(80)}${i}`,
        [1],
      );

      const context = buildProposalContext(baseInput({ histories }), log);

      const length = JSON.stringify(context).length;
      expect(length).toBeGreaterThan(GUARD_CHARS);
      expect(log.info).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledOnce();
      expect(detailsOf(log.warn)).toMatchObject({ step: 'products-75', finalChars: length });
      expect(context.products).toHaveLength(75);
    });

    it('logs the lengths it actually measured, not an estimate', () => {
      const log = logger();
      const histories = products(
        600,
        (i) => `Et ganske langt produktnavn for å blåse opp konteksten nummer ${i}`,
        RECENT_AGES,
      );

      const context = buildProposalContext(baseInput({ histories }), log);

      const details = detailsOf(log.info);
      expect(details.finalChars).toBe(JSON.stringify(context).length);
      expect(details.originalChars).toBeGreaterThan(GUARD_CHARS);
      expect(details.guardChars).toBe(GUARD_CHARS);
      expect(details).toMatchObject({
        originalProducts: 600,
        finalProducts: context.products.length,
      });
    });

    it('gives the same context twice, and cuts on a total order when products share a date', () => {
      const histories = products(
        600,
        (i) => `Et ganske langt produktnavn for å blåse opp konteksten nummer ${i}`,
        [1],
      );

      const first = buildProposalContext(baseInput({ histories }), logger());
      const second = buildProposalContext(baseInput({ histories }), logger());

      expect(first).toEqual(second);
      // Every product shares one `lastPurchaseDate`, so only the id tiebreak decides which 250
      // survive; without it the comparator answers -1 in both directions and the cut is whatever
      // the sort happened to do.
      expect(first.products.map((product) => product.id)).toEqual(
        Array.from({ length: 250 }, (_, i) => i + 1),
      );
    });
  });
});
