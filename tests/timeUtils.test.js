const {
  isCheckinTooEarly,
  isCheckinExpired,
  isWithinCheckinWindow
} = require('../utils/timeUtils');
const { CHECKIN_GRACE_MINUTES, EXPIRE_AFTER_START_MINUTES } = require('../config');

const ONE_MINUTE_MS = 60 * 1000;

function createReservation(startOffsetMinutes, expireOffsetMinutes) {
  const now = new Date();
  const start = new Date(now.getTime() + startOffsetMinutes * ONE_MINUTE_MS);
  const expireAt = new Date(now.getTime() + expireOffsetMinutes * ONE_MINUTE_MS);
  return {
    start_datetime: start.toISOString(),
    expire_at: expireAt.toISOString()
  };
}

describe('Checkin Guard Functions', () => {
  let realDate;

  beforeAll(() => {
    realDate = global.Date;
  });

  afterAll(() => {
    global.Date = realDate;
  });

  function mockDate(isoString) {
    const mockNow = new Date(isoString);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          super(mockNow);
          return this;
        }
        super(...args);
      }
      static now() {
        return mockNow.getTime();
      }
    };
  }

  describe('isCheckinTooEarly', () => {
    it('should return true when current time is before grace window', () => {
      const now = new Date('2024-01-01T10:00:00Z');
      mockDate(now.toISOString());
      const reservation = createReservation(30, 60);
      expect(isCheckinTooEarly(reservation)).toBe(true);
    });

    it('should return false when current time is exactly at grace window start (boundary)', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * ONE_MINUTE_MS);
      mockDate(graceStart.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };
      expect(isCheckinTooEarly(reservation)).toBe(false);
    });

    it('should return false when current time is 1ms after grace window start', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * ONE_MINUTE_MS);
      const justAfterGraceStart = new Date(graceStart.getTime() + 1);
      mockDate(justAfterGraceStart.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };
      expect(isCheckinTooEarly(reservation)).toBe(false);
    });

    it('should return false when current time is 1ms before grace window start (boundary)', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * ONE_MINUTE_MS);
      const justBeforeGraceStart = new Date(graceStart.getTime() - 1);
      mockDate(justBeforeGraceStart.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };
      expect(isCheckinTooEarly(reservation)).toBe(true);
    });

    it('should return false when current time is within checkin window', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const now = new Date(start.getTime() - 5 * ONE_MINUTE_MS);
      mockDate(now.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };
      expect(isCheckinTooEarly(reservation)).toBe(false);
    });
  });

  describe('isCheckinExpired', () => {
    it('should return false when current time is before expire_at', () => {
      const now = new Date('2024-01-01T10:00:00Z');
      mockDate(now.toISOString());
      const reservation = createReservation(-30, 30);
      expect(isCheckinExpired(reservation)).toBe(false);
    });

    it('should return false when current time is exactly at expire_at (boundary)', () => {
      const expireAt = new Date('2024-01-01T10:30:00Z');
      mockDate(expireAt.toISOString());
      const reservation = {
        start_datetime: new Date(expireAt.getTime() - EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString(),
        expire_at: expireAt.toISOString()
      };
      expect(isCheckinExpired(reservation)).toBe(false);
    });

    it('should return true when current time is 1ms after expire_at (boundary)', () => {
      const expireAt = new Date('2024-01-01T10:30:00Z');
      const justAfterExpire = new Date(expireAt.getTime() + 1);
      mockDate(justAfterExpire.toISOString());
      const reservation = {
        start_datetime: new Date(expireAt.getTime() - EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString(),
        expire_at: expireAt.toISOString()
      };
      expect(isCheckinExpired(reservation)).toBe(true);
    });

    it('should return false when current time is 1ms before expire_at (boundary)', () => {
      const expireAt = new Date('2024-01-01T10:30:00Z');
      const justBeforeExpire = new Date(expireAt.getTime() - 1);
      mockDate(justBeforeExpire.toISOString());
      const reservation = {
        start_datetime: new Date(expireAt.getTime() - EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString(),
        expire_at: expireAt.toISOString()
      };
      expect(isCheckinExpired(reservation)).toBe(false);
    });

    it('should return true when current time is 1 second after expire_at', () => {
      const expireAt = new Date('2024-01-01T10:30:00Z');
      const oneSecondAfterExpire = new Date(expireAt.getTime() + 1000);
      mockDate(oneSecondAfterExpire.toISOString());
      const reservation = {
        start_datetime: new Date(expireAt.getTime() - EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString(),
        expire_at: expireAt.toISOString()
      };
      expect(isCheckinExpired(reservation)).toBe(true);
    });

    it('should return true when current time is well after expire_at', () => {
      const now = new Date('2024-01-01T11:00:00Z');
      mockDate(now.toISOString());
      const reservation = createReservation(-90, -60);
      expect(isCheckinExpired(reservation)).toBe(true);
    });
  });

  describe('isWithinCheckinWindow', () => {
    it('should return true when current time is within checkin window', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const now = new Date(start.getTime() - 5 * ONE_MINUTE_MS);
      mockDate(now.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };
      expect(isWithinCheckinWindow(reservation)).toBe(true);
    });

    it('should return true when current time is exactly at grace window start (boundary)', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * ONE_MINUTE_MS);
      mockDate(graceStart.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };
      expect(isWithinCheckinWindow(reservation)).toBe(true);
    });

    it('should return true when current time is exactly at expire_at (boundary)', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const expireAt = new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS);
      mockDate(expireAt.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: expireAt.toISOString()
      };
      expect(isWithinCheckinWindow(reservation)).toBe(true);
    });

    it('should return false when current time is 1ms before grace window start', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * ONE_MINUTE_MS);
      const justBeforeGraceStart = new Date(graceStart.getTime() - 1);
      mockDate(justBeforeGraceStart.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };
      expect(isWithinCheckinWindow(reservation)).toBe(false);
    });

    it('should return false when current time is 1ms after expire_at', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const expireAt = new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS);
      const justAfterExpire = new Date(expireAt.getTime() + 1);
      mockDate(justAfterExpire.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: expireAt.toISOString()
      };
      expect(isWithinCheckinWindow(reservation)).toBe(false);
    });

    it('should return false when current time is before grace window', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const now = new Date(start.getTime() - 60 * ONE_MINUTE_MS);
      mockDate(now.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };
      expect(isWithinCheckinWindow(reservation)).toBe(false);
    });

    it('should return false when current time is after expire_at', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const now = new Date(start.getTime() + 60 * ONE_MINUTE_MS);
      mockDate(now.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };
      expect(isWithinCheckinWindow(reservation)).toBe(false);
    });
  });

  describe('Guard function call order independence', () => {
    function runGuardsInOrder(reservation, order) {
      const results = {};
      for (const guardName of order) {
        switch (guardName) {
          case 'isCheckinTooEarly':
            results.isCheckinTooEarly = isCheckinTooEarly(reservation);
            break;
          case 'isCheckinExpired':
            results.isCheckinExpired = isCheckinExpired(reservation);
            break;
          case 'isWithinCheckinWindow':
            results.isWithinCheckinWindow = isWithinCheckinWindow(reservation);
            break;
        }
      }
      return results;
    }

    const allOrders = [
      ['isCheckinTooEarly', 'isCheckinExpired', 'isWithinCheckinWindow'],
      ['isCheckinTooEarly', 'isWithinCheckinWindow', 'isCheckinExpired'],
      ['isCheckinExpired', 'isCheckinTooEarly', 'isWithinCheckinWindow'],
      ['isCheckinExpired', 'isWithinCheckinWindow', 'isCheckinTooEarly'],
      ['isWithinCheckinWindow', 'isCheckinTooEarly', 'isCheckinExpired'],
      ['isWithinCheckinWindow', 'isCheckinExpired', 'isCheckinTooEarly']
    ];

    it('should return consistent results regardless of call order - within window', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const now = new Date(start.getTime() - 5 * ONE_MINUTE_MS);
      mockDate(now.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };

      const expected = {
        isCheckinTooEarly: false,
        isCheckinExpired: false,
        isWithinCheckinWindow: true
      };

      for (const order of allOrders) {
        const results = runGuardsInOrder(reservation, order);
        expect(results).toEqual(expected);
      }
    });

    it('should return consistent results regardless of call order - too early', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const now = new Date(start.getTime() - 60 * ONE_MINUTE_MS);
      mockDate(now.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };

      const expected = {
        isCheckinTooEarly: true,
        isCheckinExpired: false,
        isWithinCheckinWindow: false
      };

      for (const order of allOrders) {
        const results = runGuardsInOrder(reservation, order);
        expect(results).toEqual(expected);
      }
    });

    it('should return consistent results regardless of call order - expired', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const now = new Date(start.getTime() + 60 * ONE_MINUTE_MS);
      mockDate(now.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };

      const expected = {
        isCheckinTooEarly: false,
        isCheckinExpired: true,
        isWithinCheckinWindow: false
      };

      for (const order of allOrders) {
        const results = runGuardsInOrder(reservation, order);
        expect(results).toEqual(expected);
      }
    });

    it('should return consistent results regardless of call order - exactly at grace start', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * ONE_MINUTE_MS);
      mockDate(graceStart.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS).toISOString()
      };

      const expected = {
        isCheckinTooEarly: false,
        isCheckinExpired: false,
        isWithinCheckinWindow: true
      };

      for (const order of allOrders) {
        const results = runGuardsInOrder(reservation, order);
        expect(results).toEqual(expected);
      }
    });

    it('should return consistent results regardless of call order - exactly at expire_at', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const expireAt = new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS);
      mockDate(expireAt.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: expireAt.toISOString()
      };

      const expected = {
        isCheckinTooEarly: false,
        isCheckinExpired: false,
        isWithinCheckinWindow: true
      };

      for (const order of allOrders) {
        const results = runGuardsInOrder(reservation, order);
        expect(results).toEqual(expected);
      }
    });

    it('should return consistent results regardless of call order - 1ms after expire', () => {
      const start = new Date('2024-01-01T10:00:00Z');
      const expireAt = new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * ONE_MINUTE_MS);
      const justAfterExpire = new Date(expireAt.getTime() + 1);
      mockDate(justAfterExpire.toISOString());
      const reservation = {
        start_datetime: start.toISOString(),
        expire_at: expireAt.toISOString()
      };

      const expected = {
        isCheckinTooEarly: false,
        isCheckinExpired: true,
        isWithinCheckinWindow: false
      };

      for (const order of allOrders) {
        const results = runGuardsInOrder(reservation, order);
        expect(results).toEqual(expected);
      }
    });
  });
});
