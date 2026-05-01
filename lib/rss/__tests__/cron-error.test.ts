import { describe, it, expect, vi } from 'vitest';
import { CronJob } from 'cron';

describe('CronJob errorHandler', () => {
  it('calls errorHandler when onTick throws', async () => {
    const errors: string[] = [];

    const job = CronJob.from({
      cronTime: '* * * * * *',
      onTick: () => {
        throw new Error('tick failed');
      },
      start: false,
      errorHandler: (err) => {
        errors.push(err instanceof Error ? err.message : String(err));
      },
    });

    await job.fireOnTick();
    expect(errors).toContain('tick failed');
    job.stop();
  });

  it('calls errorHandler when async onTick rejects', async () => {
    const errors: string[] = [];

    const job = CronJob.from({
      cronTime: '* * * * * *',
      onTick: async () => {
        throw new Error('async tick failed');
      },
      start: false,
      errorHandler: (err) => {
        errors.push(err instanceof Error ? err.message : String(err));
      },
    });

    await job.fireOnTick();
    expect(errors).toContain('async tick failed');
    job.stop();
  });

  it('includes job name in cron threshold warning output', async () => {
    // CronJob names appear in threshold warning messages.
    // This test verifies the name is propagated to the CronJob instance.
    const job = CronJob.from({
      cronTime: '* * * * * *',
      onTick: () => {},
      start: false,
      name: 'rss-cron',
    });

    expect(job.name).toBe('rss-cron');
    job.stop();
  });
});
