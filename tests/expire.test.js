jest.mock('../db');
jest.mock('../utils/audit');

const { all, run, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { RESERVATION_STATUSES } = require('../utils/approvalUtils');
const {
  processExpiredReservations,
  processCompletedReservations
} = require('../utils/expire');

describe('Expire and Complete Processors', () => {
  let realDate;
  let mockTransactionFn;

  beforeEach(() => {
    jest.clearAllMocks();

    realDate = global.Date;
    const now = new Date('2024-01-01T12:00:00Z');
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          super(now);
          return this;
        }
        super(...args);
      }
      static now() {
        return now.getTime();
      }
    };

    mockTransactionFn = jest.fn((fn) => fn);
    transaction.mockImplementation(mockTransactionFn);
  });

  afterEach(() => {
    global.Date = realDate;
  });

  describe('processExpiredReservations', () => {
    it('should return 0 when there are no expired reservations', () => {
      all.mockReturnValue([]);

      const result = processExpiredReservations();

      expect(result).toBe(0);
      expect(all).toHaveBeenCalledTimes(1);
      const sqlCall = all.mock.calls[0][0];
      expect(sqlCall).toMatch(/WHERE\s+status\s*=\s*\?/);
      expect(sqlCall).toMatch(/expire_at\s*<=\s*\?/);
      expect(all.mock.calls[0][1]).toEqual([RESERVATION_STATUSES.APPROVED, '2024-01-01T12:00:00.000Z']);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('should process expired approved reservations and transition to EXPIRED', () => {
      const expiredReservations = [
        {
          id: 1,
          user_id: 101,
          status: RESERVATION_STATUSES.APPROVED,
          expire_at: '2024-01-01T11:30:00Z',
          start_datetime: '2024-01-01T11:00:00Z',
          end_datetime: '2024-01-01T12:00:00Z'
        },
        {
          id: 2,
          user_id: 102,
          status: RESERVATION_STATUSES.APPROVED,
          expire_at: '2024-01-01T11:00:00Z',
          start_datetime: '2024-01-01T10:30:00Z',
          end_datetime: '2024-01-01T11:30:00Z'
        }
      ];

      all.mockReturnValue(expiredReservations);

      const result = processExpiredReservations();

      expect(result).toBe(2);
      expect(run).toHaveBeenCalledTimes(2);
      expect(logAudit).toHaveBeenCalledTimes(2);

      expect(run).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE reservations SET status = ?'),
        [RESERVATION_STATUSES.EXPIRED, 1]
      );
      expect(run).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE reservations SET status = ?'),
        [RESERVATION_STATUSES.EXPIRED, 2]
      );

      expect(logAudit).toHaveBeenNthCalledWith(
        1,
        101,
        ACTIONS.EXPIRE,
        {
          reservationId: 1,
          oldStatus: RESERVATION_STATUSES.APPROVED,
          newStatus: RESERVATION_STATUSES.EXPIRED,
          details: { expire_at: '2024-01-01T11:30:00Z', auto: true }
        }
      );
      expect(logAudit).toHaveBeenNthCalledWith(
        2,
        102,
        ACTIONS.EXPIRE,
        {
          reservationId: 2,
          oldStatus: RESERVATION_STATUSES.APPROVED,
          newStatus: RESERVATION_STATUSES.EXPIRED,
          details: { expire_at: '2024-01-01T11:00:00Z', auto: true }
        }
      );
    });

    it('should only process reservations with valid status transition', () => {
      const reservations = [
        {
          id: 1,
          user_id: 101,
          status: RESERVATION_STATUSES.APPROVED,
          expire_at: '2024-01-01T11:30:00Z',
          start_datetime: '2024-01-01T11:00:00Z',
          end_datetime: '2024-01-01T12:00:00Z'
        },
        {
          id: 3,
          user_id: 103,
          status: RESERVATION_STATUSES.CANCELED,
          expire_at: '2024-01-01T11:00:00Z',
          start_datetime: '2024-01-01T10:30:00Z',
          end_datetime: '2024-01-01T11:30:00Z'
        }
      ];

      all.mockReturnValue(reservations);

      const result = processExpiredReservations();

      expect(result).toBe(2);
      expect(run).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reservations SET status = ?'),
        [RESERVATION_STATUSES.EXPIRED, 1]
      );
    });

    it('should handle transaction errors and return 0', () => {
      const expiredReservations = [
        {
          id: 1,
          user_id: 101,
          status: RESERVATION_STATUSES.APPROVED,
          expire_at: '2024-01-01T11:30:00Z',
          start_datetime: '2024-01-01T11:00:00Z',
          end_datetime: '2024-01-01T12:00:00Z'
        }
      ];

      all.mockReturnValue(expiredReservations);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockTransactionFn.mockReturnValue(() => {
        throw new Error('DB transaction error');
      });

      const result = processExpiredReservations();

      expect(result).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should handle expire_at boundary - exactly equal to now', () => {
      const expiredReservation = {
        id: 1,
        user_id: 101,
        status: RESERVATION_STATUSES.APPROVED,
        expire_at: '2024-01-01T12:00:00Z',
        start_datetime: '2024-01-01T11:30:00Z',
        end_datetime: '2024-01-01T12:30:00Z'
      };

      all.mockReturnValue([expiredReservation]);

      const result = processExpiredReservations();

      expect(result).toBe(1);
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reservations SET status = ?'),
        [RESERVATION_STATUSES.EXPIRED, 1]
      );
      expect(logAudit).toHaveBeenCalledWith(
        101,
        ACTIONS.EXPIRE,
        expect.objectContaining({
          reservationId: 1,
          newStatus: RESERVATION_STATUSES.EXPIRED
        })
      );
    });
  });

  describe('processCompletedReservations', () => {
    it('should return 0 when there are no completed reservations', () => {
      all.mockReturnValue([]);

      const result = processCompletedReservations();

      expect(result).toBe(0);
      expect(all).toHaveBeenCalledTimes(1);
      const sqlCall = all.mock.calls[0][0];
      expect(sqlCall).toMatch(/WHERE\s+status\s+IN\s*\(\?,\s*\?\)/);
      expect(sqlCall).toMatch(/end_datetime\s*<=\s*\?/);
      expect(all.mock.calls[0][1]).toEqual([RESERVATION_STATUSES.APPROVED, RESERVATION_STATUSES.CHECKED_IN, '2024-01-01T12:00:00.000Z']);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('should transition CHECKED_IN reservations to COMPLETED', () => {
      const checkedInReservation = {
        id: 1,
        user_id: 101,
        status: RESERVATION_STATUSES.CHECKED_IN,
        start_datetime: '2024-01-01T10:00:00Z',
        end_datetime: '2024-01-01T11:00:00Z',
        expire_at: '2024-01-01T10:30:00Z'
      };

      all.mockReturnValue([checkedInReservation]);

      const result = processCompletedReservations();

      expect(result).toBe(1);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reservations SET status = ?'),
        [RESERVATION_STATUSES.COMPLETED, 1]
      );
      expect(logAudit).toHaveBeenCalledWith(
        101,
        'complete',
        {
          reservationId: 1,
          oldStatus: RESERVATION_STATUSES.CHECKED_IN,
          newStatus: RESERVATION_STATUSES.COMPLETED,
          details: { end_datetime: '2024-01-01T11:00:00Z', auto: true }
        }
      );
    });

    it('should transition APPROVED reservations to EXPIRED when end_datetime has passed', () => {
      const approvedReservation = {
        id: 2,
        user_id: 102,
        status: RESERVATION_STATUSES.APPROVED,
        start_datetime: '2024-01-01T10:00:00Z',
        end_datetime: '2024-01-01T11:00:00Z',
        expire_at: '2024-01-01T10:30:00Z'
      };

      all.mockReturnValue([approvedReservation]);

      const result = processCompletedReservations();

      expect(result).toBe(1);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reservations SET status = ?'),
        [RESERVATION_STATUSES.EXPIRED, 2]
      );
      expect(logAudit).toHaveBeenCalledWith(
        102,
        ACTIONS.EXPIRE,
        {
          reservationId: 2,
          oldStatus: RESERVATION_STATUSES.APPROVED,
          newStatus: RESERVATION_STATUSES.EXPIRED,
          details: { end_datetime: '2024-01-01T11:00:00Z', auto: true }
        }
      );
    });

    it('should process mixed CHECKED_IN and APPROVED reservations correctly', () => {
      const reservations = [
        {
          id: 1,
          user_id: 101,
          status: RESERVATION_STATUSES.CHECKED_IN,
          start_datetime: '2024-01-01T10:00:00Z',
          end_datetime: '2024-01-01T11:00:00Z',
          expire_at: '2024-01-01T10:30:00Z'
        },
        {
          id: 2,
          user_id: 102,
          status: RESERVATION_STATUSES.APPROVED,
          start_datetime: '2024-01-01T10:00:00Z',
          end_datetime: '2024-01-01T11:30:00Z',
          expire_at: '2024-01-01T10:30:00Z'
        }
      ];

      all.mockReturnValue(reservations);

      const result = processCompletedReservations();

      expect(result).toBe(2);
      expect(run).toHaveBeenCalledTimes(2);
      expect(logAudit).toHaveBeenCalledTimes(2);

      expect(run).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE reservations SET status = ?'),
        [RESERVATION_STATUSES.COMPLETED, 1]
      );
      expect(run).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE reservations SET status = ?'),
        [RESERVATION_STATUSES.EXPIRED, 2]
      );
    });

    it('should only process reservations with valid status transitions', () => {
      const reservations = [
        {
          id: 1,
          user_id: 101,
          status: RESERVATION_STATUSES.CHECKED_IN,
          start_datetime: '2024-01-01T10:00:00Z',
          end_datetime: '2024-01-01T11:00:00Z',
          expire_at: '2024-01-01T10:30:00Z'
        },
        {
          id: 3,
          user_id: 103,
          status: RESERVATION_STATUSES.EXPIRED,
          start_datetime: '2024-01-01T10:00:00Z',
          end_datetime: '2024-01-01T11:00:00Z',
          expire_at: '2024-01-01T10:30:00Z'
        }
      ];

      all.mockReturnValue(reservations);

      const result = processCompletedReservations();

      expect(result).toBe(2);
      expect(run).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenCalledTimes(1);
    });

    it('should handle transaction errors and return 0', () => {
      const reservations = [
        {
          id: 1,
          user_id: 101,
          status: RESERVATION_STATUSES.CHECKED_IN,
          start_datetime: '2024-01-01T10:00:00Z',
          end_datetime: '2024-01-01T11:00:00Z',
          expire_at: '2024-01-01T10:30:00Z'
        }
      ];

      all.mockReturnValue(reservations);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      mockTransactionFn.mockReturnValue(() => {
        throw new Error('DB transaction error');
      });

      const result = processCompletedReservations();

      expect(result).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should handle end_datetime boundary - exactly equal to now', () => {
      const checkedInReservation = {
        id: 1,
        user_id: 101,
        status: RESERVATION_STATUSES.CHECKED_IN,
        start_datetime: '2024-01-01T11:00:00Z',
        end_datetime: '2024-01-01T12:00:00Z',
        expire_at: '2024-01-01T11:30:00Z'
      };

      all.mockReturnValue([checkedInReservation]);

      const result = processCompletedReservations();

      expect(result).toBe(1);
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reservations SET status = ?'),
        [RESERVATION_STATUSES.COMPLETED, 1]
      );
    });
  });

  describe('No duplicate processing between scanners', () => {
    it('should not double-process an APPROVED reservation that meets both expire and complete criteria', () => {
      const originalReservation = {
        id: 1,
        user_id: 101,
        status: RESERVATION_STATUSES.APPROVED,
        start_datetime: '2024-01-01T10:00:00Z',
        end_datetime: '2024-01-01T11:00:00Z',
        expire_at: '2024-01-01T10:30:00Z'
      };

      let currentStatus = RESERVATION_STATUSES.APPROVED;

      run.mockImplementation((sql, params) => {
        if (params && params[0]) {
          currentStatus = params[0];
        }
        return { changes: 1 };
      });

      let allCallCount = 0;
      all.mockImplementation(() => {
        allCallCount++;
        const reservationAtQueryTime = {
          ...originalReservation,
          status: currentStatus
        };
        return [reservationAtQueryTime];
      });

      const expireResult = processExpiredReservations();
      expect(expireResult).toBe(1);
      expect(run).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenLastCalledWith(
        101,
        ACTIONS.EXPIRE,
        expect.objectContaining({
          reservationId: 1,
          oldStatus: RESERVATION_STATUSES.APPROVED,
          newStatus: RESERVATION_STATUSES.EXPIRED
        })
      );

      expect(currentStatus).toBe(RESERVATION_STATUSES.EXPIRED);

      const completeResult = processCompletedReservations();
      expect(completeResult).toBe(1);
      expect(run).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenCalledTimes(1);
    });

    it('should process reservations in order without conflicts - expire first then complete', () => {
      const reservation1 = {
        id: 1,
        user_id: 101,
        status: RESERVATION_STATUSES.APPROVED,
        start_datetime: '2024-01-01T10:00:00Z',
        end_datetime: '2024-01-01T12:00:00Z',
        expire_at: '2024-01-01T10:30:00Z'
      };
      const reservation2 = {
        id: 2,
        user_id: 102,
        status: RESERVATION_STATUSES.CHECKED_IN,
        start_datetime: '2024-01-01T10:00:00Z',
        end_datetime: '2024-01-01T11:00:00Z',
        expire_at: '2024-01-01T10:30:00Z'
      };

      let statuses = {
        1: reservation1.status,
        2: reservation2.status
      };

      run.mockImplementation((sql, params) => {
        if (params) {
          const [newStatus, id] = params;
          statuses[id] = newStatus;
        }
        return { changes: 1 };
      });

      let allCallCount = 0;
      all.mockImplementation((sql) => {
        allCallCount++;
        if (allCallCount === 1) {
          return [{ ...reservation1, status: statuses[1] }];
        } else {
          return [
            { ...reservation1, status: statuses[1] },
            { ...reservation2, status: statuses[2] }
          ];
        }
      });

      const expireResult = processExpiredReservations();
      expect(expireResult).toBe(1);
      expect(statuses[1]).toBe(RESERVATION_STATUSES.EXPIRED);

      const completeResult = processCompletedReservations();
      expect(completeResult).toBe(2);
      expect(statuses[1]).toBe(RESERVATION_STATUSES.EXPIRED);
      expect(statuses[2]).toBe(RESERVATION_STATUSES.COMPLETED);

      expect(run).toHaveBeenCalledTimes(2);
      expect(logAudit).toHaveBeenCalledTimes(2);
    });

    it('should process reservations in order without conflicts - complete first then expire', () => {
      const reservation1 = {
        id: 1,
        user_id: 101,
        status: RESERVATION_STATUSES.APPROVED,
        start_datetime: '2024-01-01T10:00:00Z',
        end_datetime: '2024-01-01T11:00:00Z',
        expire_at: '2024-01-01T10:30:00Z'
      };
      const reservation2 = {
        id: 2,
        user_id: 102,
        status: RESERVATION_STATUSES.CHECKED_IN,
        start_datetime: '2024-01-01T10:00:00Z',
        end_datetime: '2024-01-01T11:00:00Z',
        expire_at: '2024-01-01T10:30:00Z'
      };

      let statuses = {
        1: reservation1.status,
        2: reservation2.status
      };

      run.mockImplementation((sql, params) => {
        if (params) {
          const [newStatus, id] = params;
          statuses[id] = newStatus;
        }
        return { changes: 1 };
      });

      all.mockImplementation((sql) => {
        const isExpireQuery = /status\s*=\s*\?/.test(sql) && /expire_at/.test(sql);
        const isCompleteQuery = /status\s+IN\s*\(\?,\s*\?/.test(sql) && /end_datetime/.test(sql);

        if (isCompleteQuery) {
          return [
            { ...reservation1, status: statuses[1] },
            { ...reservation2, status: statuses[2] }
          ].filter(r =>
            r.status === RESERVATION_STATUSES.APPROVED || r.status === RESERVATION_STATUSES.CHECKED_IN
          );
        } else if (isExpireQuery) {
          const result = [{ ...reservation1, status: statuses[1] }].filter(r =>
            r.status === RESERVATION_STATUSES.APPROVED
          );
          return result;
        }
        return [];
      });

      const completeResult = processCompletedReservations();
      expect(completeResult).toBe(2);
      expect(statuses[1]).toBe(RESERVATION_STATUSES.EXPIRED);
      expect(statuses[2]).toBe(RESERVATION_STATUSES.COMPLETED);

      const expireResult = processExpiredReservations();
      expect(expireResult).toBe(0);
      expect(statuses[1]).toBe(RESERVATION_STATUSES.EXPIRED);
      expect(statuses[2]).toBe(RESERVATION_STATUSES.COMPLETED);

      expect(run).toHaveBeenCalledTimes(2);
      expect(logAudit).toHaveBeenCalledTimes(2);
    });

    it('should maintain audit log integrity when processing multiple reservations', () => {
      const reservations = [
        {
          id: 1,
          user_id: 101,
          status: RESERVATION_STATUSES.APPROVED,
          start_datetime: '2024-01-01T10:00:00Z',
          end_datetime: '2024-01-01T11:30:00Z',
          expire_at: '2024-01-01T10:30:00Z'
        },
        {
          id: 2,
          user_id: 102,
          status: RESERVATION_STATUSES.APPROVED,
          start_datetime: '2024-01-01T09:00:00Z',
          end_datetime: '2024-01-01T10:30:00Z',
          expire_at: '2024-01-01T09:30:00Z'
        }
      ];

      all.mockReturnValue(reservations);

      const result = processExpiredReservations();
      expect(result).toBe(2);

      expect(logAudit).toHaveBeenCalledTimes(2);
      expect(logAudit).toHaveBeenNthCalledWith(
        1,
        101,
        ACTIONS.EXPIRE,
        expect.objectContaining({
          reservationId: 1,
          details: expect.objectContaining({ expire_at: '2024-01-01T10:30:00Z' })
        })
      );
      expect(logAudit).toHaveBeenNthCalledWith(
        2,
        102,
        ACTIONS.EXPIRE,
        expect.objectContaining({
          reservationId: 2,
          details: expect.objectContaining({ expire_at: '2024-01-01T09:30:00Z' })
        })
      );
    });
  });
});
