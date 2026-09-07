import { describe, expect, it } from 'vitest';
import { computeTrip, type TripItem, type TripLine } from '../../../src/server/domain/trip.ts';

function item(overrides: Partial<TripItem> = {}): TripItem {
  return {
    id: 1,
    productId: null,
    name: 'Lettmelk 1 l',
    quantityText: '2 stk',
    source: 'suggested',
    checked: false,
    ...overrides,
  };
}

function line(overrides: Partial<TripLine> = {}): TripLine {
  return {
    receiptId: 1,
    productId: null,
    rawText: 'TINE LETTMELK 1L',
    quantity: 1,
    unit: 'stk',
    ...overrides,
  };
}

describe('computeTrip', () => {
  it('matches a planned item to a line by productId', () => {
    const trip = computeTrip({
      items: [item({ id: 1, productId: 5, name: 'Lettmelk 1 l' })],
      lines: [line({ productId: 5, rawText: 'TINE LETTMELK 1L' })],
      productNames: new Map([[5, 'Lettmelk 1 l']]),
    });

    expect(trip.planned).toEqual([
      {
        itemId: 1,
        name: 'Lettmelk 1 l',
        quantityText: '2 stk',
        source: 'suggested',
        checked: false,
        status: 'bought',
      },
    ]);
    expect(trip.counts).toEqual({ planned: 1, bought: 1, notBought: 0, unplanned: 0 });
  });

  it('matches a manual item with no productId to a line by normalised name', () => {
    const trip = computeTrip({
      items: [item({ id: 2, productId: null, name: 'Handlenett', source: 'manual' })],
      lines: [line({ productId: null, rawText: 'Handlenett' })],
      productNames: new Map(),
    });

    expect(trip.planned[0]).toMatchObject({ itemId: 2, status: 'bought' });
  });

  it('marks a manual item spelt differently as notBought', () => {
    const trip = computeTrip({
      items: [item({ id: 2, productId: null, name: 'Handlenett' })],
      lines: [line({ productId: null, rawText: 'Handle-nett spesial' })],
      productNames: new Map(),
    });

    expect(trip.planned[0]).toMatchObject({ status: 'notBought' });
    expect(trip.counts).toMatchObject({ bought: 0, notBought: 1 });
  });

  it('matches a nameless item against a receipt line that does have a product, by the product name', () => {
    const trip = computeTrip({
      items: [item({ id: 1, productId: null, name: 'Lettmelk 1 l' })],
      lines: [line({ productId: 5, rawText: 'TINE LETTMELK 1L' })],
      productNames: new Map([[5, 'Lettmelk 1 l']]),
    });

    expect(trip.planned[0]).toMatchObject({ status: 'bought' });
  });

  it('matches an item with a product to a line whose matching failed but reads the same (F1)', () => {
    const trip = computeTrip({
      items: [item({ id: 1, productId: 7, name: 'Melk' })],
      lines: [line({ productId: null, rawText: 'MELK' })],
      productNames: new Map(),
    });

    expect(trip.planned[0]).toMatchObject({ status: 'bought' });
    expect(trip.counts).toMatchObject({ bought: 1, notBought: 0, unplanned: 0 });
  });

  it('collects lines from two receipts on one trip', () => {
    const trip = computeTrip({
      items: [
        item({ id: 1, productId: 5, name: 'Lettmelk 1 l' }),
        item({ id: 2, productId: 6, name: 'Kaffe' }),
      ],
      lines: [
        line({ receiptId: 10, productId: 5 }),
        line({ receiptId: 11, productId: 6, rawText: 'KAFFE' }),
      ],
      productNames: new Map([
        [5, 'Lettmelk 1 l'],
        [6, 'Kaffe'],
      ]),
    });

    expect(trip.planned.every((row) => row.status === 'bought')).toBe(true);
    expect(trip.receiptIds).toEqual([10, 11]);
  });

  it('groups unplanned lines and sums quantities across lines, keeping the first unit', () => {
    const trip = computeTrip({
      items: [],
      lines: [
        line({ receiptId: 1, productId: 9, rawText: 'BANAN', quantity: 3, unit: 'stk' }),
        line({ receiptId: 2, productId: 9, rawText: 'BANAN', quantity: 2, unit: 'kg' }),
      ],
      productNames: new Map([[9, 'Banan']]),
    });

    expect(trip.unplanned).toEqual([{ productId: 9, name: 'Banan', quantity: 5, unit: 'stk' }]);
    expect(trip.counts.unplanned).toBe(1);
  });

  it('sorts unplanned rows by name (nb)', () => {
    const trip = computeTrip({
      items: [],
      lines: [
        line({ receiptId: 1, productId: 1, rawText: 'YOGHURT' }),
        line({ receiptId: 1, productId: 2, rawText: 'OST' }),
      ],
      productNames: new Map([
        [1, 'Yoghurt'],
        [2, 'Ost'],
      ]),
    });

    expect(trip.unplanned.map((row) => row.name)).toEqual(['Ost', 'Yoghurt']);
  });

  it('excludes a line from unplanned once its productId is among the planned items', () => {
    const trip = computeTrip({
      items: [item({ id: 1, productId: 5, name: 'Lettmelk 1 l' })],
      lines: [line({ productId: 5 })],
      productNames: new Map([[5, 'Lettmelk 1 l']]),
    });

    expect(trip.unplanned).toEqual([]);
  });

  it('keeps checked: true and status: notBought for a checked-but-not-bought item', () => {
    const trip = computeTrip({
      items: [item({ id: 1, productId: 5, name: 'Lettmelk 1 l', checked: true })],
      lines: [],
      productNames: new Map(),
    });

    expect(trip.planned[0]).toMatchObject({ checked: true, status: 'notBought' });
    expect(trip.counts).toMatchObject({ bought: 0, notBought: 1 });
  });

  it('returns zero counts and empty arrays for an empty list and no receipts', () => {
    const trip = computeTrip({ items: [], lines: [], productNames: new Map() });

    expect(trip).toEqual({
      planned: [],
      unplanned: [],
      counts: { planned: 0, bought: 0, notBought: 0, unplanned: 0 },
      receiptIds: [],
    });
  });
});
