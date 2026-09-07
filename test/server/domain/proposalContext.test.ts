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
    function bigHistories(count: number): ProductHistory[] {
      return Array.from({ length: count }, (_, i) => {
        const purchases = Array.from({ length: 12 }, (_, p) => ({
          date: `2026-0${(p % 8) + 1}-1${p % 9}`,
          quantity: 1,
          unit: 'stk' as const,
        }));
        return history({
          productId: i + 1,
          name: `Et ganske langt produktnavn for å blåse opp konteksten nummer ${i}`,
          purchases,
        });
      });
    }

    it('leaves a small context untouched and never warns', () => {
      const warn = vi.fn();
      const context = buildProposalContext(baseInput(), { warn });

      expect(context.products).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('narrows to a 12-week scope and caps at 250 products, warning once, when the context is too large', () => {
      const warn = vi.fn();
      const histories = bigHistories(400);

      const context = buildProposalContext(baseInput({ histories }), { warn });

      expect(context.products.length).toBeLessThanOrEqual(250);
      expect(warn).toHaveBeenCalledOnce();
      const [details] = warn.mock.calls[0] as [Record<string, unknown>];
      expect(details).toMatchObject({ finalProducts: context.products.length });
    });
  });
});
